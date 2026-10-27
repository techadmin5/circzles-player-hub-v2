import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "../src/db/client.js";
import * as s from "../src/db/schema.js";
import { missionAdminHistory } from "../src/db/missionAdminSchema.js";
import { AdminMissionService } from "../src/domain/adminMissions.js";

import { localMissionPostgresUrl } from "./helpers/localMissionPostgres.js";

import { AppError } from "../src/domain/errors.js";
import { capacityCases, capacityFixture, openCapacity, recoveryRequest } from "./helpers/missionCapacityCases.js";
import { missionCapacityExceptions } from "../src/db/missionAdminSchema.js";

// Separate opt-in from the M1 suite: never reuse its populated database or an
// application URL, load .env, or reset any database to satisfy the empty guard.
const url = process.env.MISSION_CAPACITY_TEST_DATABASE_URL;
describe.skipIf(!url)("Slice 10 real PostgreSQL capacity integrity", () => {
  let a: ReturnType<typeof createDb>, b: ReturnType<typeof createDb>;
  let first: AdminMissionService, actor: string, sentinel: string;
  const now = new Date("2030-02-10T12:00:00Z");
  const folder = fileURLToPath(new URL("../drizzle/", import.meta.url));
  const names = ["circzles_s10_a", "circzles_s10_b"];
  const evidence: { name: string; blockerPid: number; waiters: { pid: number; wait_event: string }[] }[] = [];
  const verifiedPids: number[] = [];

  beforeAll(async () => {
    const expected = process.env.MISSION_CAPACITY_TEST_DATABASE_NAME;
    const target = localMissionPostgresUrl(url, expected, process.env.MISSIONS_POSTGRES_DISPOSABLE);
    target.searchParams.set("application_name", names[0]); a = createDb(target.toString(), () => {});
    target.searchParams.set("application_name", names[1]); b = createDb(target.toString(), () => {});
    for (const connection of [a, b]) {
      const identity = (await connection.pool.query("SELECT current_database() AS database,current_user AS role,session_user AS session_role,host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('server_version_num')::int AS version,pg_backend_pid() AS pid")).rows[0];
      if (identity.database !== expected || identity.role !== "circzles_test" || identity.session_role !== "circzles_test" || identity.address !== "127.0.0.1" || identity.port !== 5432 || identity.version !== 180006) throw new Error("STOP: local disposable database / PostgreSQL 18.6 identity mismatch before writes");
      verifiedPids.push(identity.pid);
    }
    expect(new Set(verifiedPids).size).toBe(2);
    if ((await a.pool.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema IN ('public','drizzle')")).rows[0].count !== 0) throw new Error("Database must be empty; no existing database reset is permitted");
    first = new AdminMissionService(a.db);
    await preparedMigrations("before", path => migrate(a.db, { migrationsFolder: path }));
    for (let index = 0; index < 2; index++) {
      const [user] = await a.db.insert(s.users).values({ verifiedEmail: `s10-${index}@test.invalid` }).returning();
      const [admin] = await a.db.insert(s.adminUsers).values({ userId: user.userId, role: "SUPER_ADMIN" }).returning();
      if (index === 0) actor = admin.adminUserId;
    }
    const draft = await first.createDraft({ title: "Synthetic pre-0033 draft", description: "", category: "DAILY", displayOrder: 0 }, actor, now);
    sentinel = draft.missionId;
    const oldHistory = await a.db.select().from(missionAdminHistory);
    await expect(preparedMigrations("fail", path => migrate(a.db, { migrationsFolder: path }))).rejects.toThrow();
    expect((await a.pool.query("SELECT to_regclass('public.mission_capacity_exceptions') AS name")).rows[0].name).toBeNull();
    expect((await a.pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count).toBe(33);

    expect(await a.db.select().from(missionAdminHistory)).toEqual(oldHistory);
    await migrate(a.db, { migrationsFolder: folder });
    expect(await a.db.select().from(missionAdminHistory)).toEqual(oldHistory);
  }, 60000);
  afterAll(async () => {
    console.info("CAPACITY_POSTGRES_EVIDENCE", JSON.stringify({ verifiedPids, observedLockRaces: evidence }));
    await Promise.all([a?.pool.end(), b?.pool.end()]);
  });
  async function preparedMigrations(mode: "before" | "fail", run: (path: string) => Promise<void>) {
    const temporary = await mkdtemp(resolve(tmpdir(), "circzles-s10-migrations-"));
    try {
      const journal = JSON.parse(await readFile(resolve(folder, "meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
      if (mode === "before") journal.entries = journal.entries.filter(entry => entry.idx < 33);
      await mkdir(resolve(temporary, "meta")); await writeFile(resolve(temporary, "meta/_journal.json"), JSON.stringify(journal));
      for (const entry of journal.entries) await copyFile(resolve(folder, entry.tag + ".sql"), resolve(temporary, entry.tag + ".sql"));
      if (mode === "fail") { const path = resolve(temporary, "0033_mission_capacity_exceptions.sql"); await writeFile(path, await readFile(path, "utf8") + "\n--> statement-breakpoint\nSELECT 1/0;"); }
      await run(temporary);
    } finally {
      if (!resolve(temporary).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary migration directory");
      await rm(temporary, { recursive: true });
    }
  }
  async function waiters(blockerPid: number, count: number) {
    let rows: { pid: number; wait_event: string; query: string }[] = [];
    for (let attempt = 0; attempt < 200; attempt++) {
      rows = (await b.pool.query("SELECT pid,wait_event,query FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND application_name=ANY($1::text[]) AND pid<>$2 AND wait_event_type='Lock'", [names, blockerPid])).rows;
      if (rows.length >= count) return rows;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Expected ${count} independent PostgreSQL lock waiters; observed ${rows.length}`);
  }
  async function race(name: string, id: string, left: () => Promise<unknown>, right: () => Promise<unknown>) {
    const blocker = await a.pool.connect(); let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      await blocker.query("BEGIN");
      const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await blocker.query("SELECT player_mission_progress_id FROM player_mission_progress WHERE player_mission_progress_id=$1 FOR UPDATE", [id]);
      pending = Promise.allSettled([left(), right()]);
      const rows = await waiters(pid, 2);
      expect(rows.every(row => (/for update/i.test(row.query) && row.query.includes('"player_mission_progress"')) || row.query.includes("pg_advisory_xact_lock"))).toBe(true);
      expect(new Set(rows.map(row => row.pid)).size).toBe(2);
      evidence.push({ name, blockerPid: pid, waiters: rows.map(({ pid, wait_event }) => ({ pid, wait_event })) });
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
    return pending!;
  }
  const audit = (id: string) => a.db.select().from(missionAdminHistory).where(eq(missionAdminHistory.missionId, id));

  capacityCases(() => a.db);
  it("0033 rollback/retry preserves the existing audit and creates all immutable exception tables", async () => {
    expect((await a.pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count).toBe(36);
    expect(await audit(sentinel)).toHaveLength(1);
  });
  it.each(["same", "different"])("concurrent %s-key failed claims record one exception without grants", async kind => {
    const f = await capacityFixture(a.db);
    const other = new (await import("../src/domain/missions.js")).DrizzleMissionClaimRepository(b.db);
    const outcomes = await race("capacity claim " + kind, f.progress.playerMissionProgressId, () => f.claims.claim(f.input), () => other.claim({ ...f.input, idempotencyKey: kind === "same" ? f.input.idempotencyKey : crypto.randomUUID() }));
    expect(outcomes.every(r => r.status === "rejected" && (r.reason as AppError).code === "MISSION_CAPACITY_PENDING")).toBe(true);
    expect(await a.db.select().from(missionCapacityExceptions).where(eq(missionCapacityExceptions.progressId, f.progress.playerMissionProgressId))).toHaveLength(1);
    expect(await a.db.select().from(s.missionClaims).where(eq(s.missionClaims.playerId, f.input.playerId))).toEqual([]);
  }, 15000);
  it("an in-time arrival remains eligible while waiting beyond the deadline on a progress lock", async () => {
    const start = new Date(), end = new Date(start.getTime() + 250);
    const f = await capacityFixture(a.db, 7, 3, 2147483647, 0, { arrival: start, deadline: end });
    const blocker = await b.pool.connect(); let pending: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN"); await blocker.query("SELECT player_mission_progress_id FROM player_mission_progress WHERE player_mission_progress_id=$1 FOR UPDATE", [f.progress.playerMissionProgressId]);
      const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      pending = f.claims.claim(f.input); void pending.catch(() => {}); await waiters(pid, 1);
      while (Date.now() <= end.getTime()) await new Promise(resolve => setTimeout(resolve, 20));
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
    await expect(pending).rejects.toMatchObject({ code: "MISSION_CAPACITY_PENDING" });
    const [row] = await a.db.select().from(missionCapacityExceptions).where(eq(missionCapacityExceptions.progressId, f.progress.playerMissionProgressId));
    expect(row.arrivedAt).toEqual(start); expect(row.claimDeadline).toEqual(end); expect(row.recordedAt >= end).toBe(true);
  }, 15000);
  it.each(["same", "different"])("concurrent %s-key authorized recoveries pay exactly once", async kind => {
    const f = await capacityFixture(a.db), row = await openCapacity(a.db, f), input = recoveryRequest(row);
    await a.db.update(s.wallets).set({ balance: 0 }).where(eq(s.wallets.playerId, f.input.playerId));
    const other = new (await import("../src/domain/missionCapacityExceptions.js")).MissionCapacityService(b.db);
    const outcomes = await race("recovery " + kind, f.progress.playerMissionProgressId, () => f.service.recover(row.exceptionId, input, f.actor), () => other.recover(row.exceptionId, kind === "same" ? input : { ...input, idempotencyKey: crypto.randomUUID() }, f.actor));
    expect(outcomes.filter(r => r.status === "fulfilled")).toHaveLength(kind === "same" ? 2 : 1);
    expect(await a.db.select().from(s.missionClaims).where(eq(s.missionClaims.playerId, f.input.playerId))).toHaveLength(1);
    for (const table of [s.pointTransactions, s.xpTransactions]) expect(await a.db.select().from(table).where(eq(table.playerId, f.input.playerId))).toHaveLength(1);
  }, 15000);
  it("normal retry racing recovery never pays twice or bypasses SUPER_ADMIN recovery", async () => {
    const f = await capacityFixture(a.db), row = await openCapacity(a.db, f);
    await a.db.update(s.wallets).set({ balance: 0 }).where(eq(s.wallets.playerId, f.input.playerId));
    const other = new (await import("../src/domain/missions.js")).DrizzleMissionClaimRepository(b.db);
    await race("normal retry versus recovery", f.progress.playerMissionProgressId, () => f.service.recover(row.exceptionId, recoveryRequest(row), f.actor), () => other.claim({ ...f.input, idempotencyKey: crypto.randomUUID() }));
    expect((await f.service.detail(row.exceptionId, f.actor)).status).toBe("RECOVERED");
    expect(await a.db.select().from(s.missionClaims).where(eq(s.missionClaims.playerId, f.input.playerId))).toHaveLength(1);
  }, 15000);
  it.each(["OPENED", "RECOVERED"])("failed %s audit rolls back the exception or all recovered payout effects", async action => {
    const f = await capacityFixture(a.db); const row = action === "RECOVERED" ? await openCapacity(a.db, f) : null;
    if (row) await a.db.update(s.wallets).set({ balance: 0 }).where(eq(s.wallets.playerId, f.input.playerId));
    await a.pool.query(`CREATE FUNCTION synthetic_capacity_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='${action}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_capacity_audit_fail BEFORE INSERT ON mission_capacity_events FOR EACH ROW EXECUTE FUNCTION synthetic_capacity_audit_fail()`);
    try { if (row) await expect(f.service.recover(row.exceptionId, recoveryRequest(row), f.actor)).rejects.toThrow(); else await expect(f.claims.claim(f.input)).rejects.toThrow(); }
    finally { await a.pool.query("DROP TRIGGER synthetic_capacity_audit_fail ON mission_capacity_events; DROP FUNCTION synthetic_capacity_audit_fail()"); }
    expect(await a.db.select().from(s.missionClaims).where(eq(s.missionClaims.playerId, f.input.playerId))).toEqual([]);
    for (const table of [s.pointTransactions, s.xpTransactions]) expect(await a.db.select().from(table).where(eq(table.playerId, f.input.playerId))).toEqual([]);
    if (row) expect((await f.service.detail(row.exceptionId, f.actor)).revision).toBe(row.revision);
    else expect(await a.db.select().from(missionCapacityExceptions).where(eq(missionCapacityExceptions.progressId, f.progress.playerMissionProgressId))).toEqual([]);
  });
  it("both exact approvals and working mission capacity safeguards permit a synthetic activation, not rewards", async () => {
    const [mission] = await a.db.insert(s.missions).values({ title: "Synthetic activation", description: "", category: "DAILY", periodType: "DAILY", active: false, activationEffectiveAt: new Date("2020-01-01Z") }).returning();
    await a.db.insert(s.missionRules).values({ missionId: mission.missionId, eventType: "puzzle.added", targetCount: 1, conditions: {} });
    await a.db.insert(s.missionRewards).values({ missionId: mission.missionId, rewardType: "XP", amount: 7 });
    for (const category of ["PRODUCT", "REWARD_BUDGET"]) {
      const c = await first.approvalContract(mission.missionId);
      await first.changeApproval(mission.missionId, category, { expectedUpdatedAt: c.binding.approvedConfigurationRevision, configurationDigest: c.binding.configurationDigest, expectedApprovalId: null, expectedRevocationId: null }, actor);
    }
    const c = await first.approvalContract(mission.missionId), stamp = new Date();
    expect((await first.readiness(mission.missionId)).activationReady).toBe(true);
    const input = { expectedUpdatedAt: c.binding.approvedConfigurationRevision, configurationDigest: c.binding.configurationDigest, idempotencyKey: crypto.randomUUID() };
    const before = (await a.pool.query("SELECT count(*)::int AS count FROM xp_transactions")).rows[0].count;
    const result = await first.changeLifecycle(mission.missionId, "ACTIVATE", input, actor);
    expect(result.active).toBe(true); expect(new Date(result.activationEffectiveAt) >= stamp).toBe(true);
    expect((await first.changeLifecycle(mission.missionId, "ACTIVATE", input, actor)).idempotent).toBe(true);
    expect((await a.pool.query("SELECT count(*)::int AS count FROM xp_transactions")).rows[0].count).toBe(before);
    const current = await first.approvalContract(mission.missionId);
    await first.changeLifecycle(mission.missionId, "DEACTIVATE", { expectedUpdatedAt: current.binding.approvedConfigurationRevision, configurationDigest: current.binding.configurationDigest, idempotencyKey: crypto.randomUUID() }, actor);
  });
});
