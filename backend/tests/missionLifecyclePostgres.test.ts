import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "../src/db/client.js";
import * as s from "../src/db/schema.js";
import { missionLifecycleOperations, missionAdminHistory } from "../src/db/missionAdminSchema.js";
import { AdminMissionService } from "../src/domain/adminMissions.js";
import type { MissionApprovalContractDto } from "../src/domain/missionApprovalContract.js";
import { localMissionPostgresUrl } from "./helpers/localMissionPostgres.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import type { Env } from "../src/config/env.js";
import { AdminAuthorizationService, DrizzleAdminAuthorizationRepository } from "../src/domain/adminAuth.js";
import { registerAdminMissionRoutes } from "../src/http/adminMissionRoutes.js";
import { hashSessionToken, SESSION_COOKIE_NAME } from "../src/domain/sessions.js";
import { AppError } from "../src/domain/errors.js";

// Separate opt-in from the M1 suite: never reuse its populated database or an
// application URL, load .env, or reset any database to satisfy the empty guard.
const url = process.env.MISSION_LIFECYCLE_TEST_DATABASE_URL;
describe.skipIf(!url)("Slice 9 real PostgreSQL lifecycle integrity", () => {
  let a: ReturnType<typeof createDb>, b: ReturnType<typeof createDb>;
  let first: AdminMissionService, second: AdminMissionService, actor: string, actorB: string, sentinel: string;
  const now = new Date("2030-02-10T12:00:00Z"), origin = new Date("2025-01-01Z");
  const folder = fileURLToPath(new URL("../drizzle/", import.meta.url));
  const names = ["circzles_s9_a", "circzles_s9_b"];
  const evidence: { name: string; blockerPid: number; waiters: { pid: number; wait_event: string }[] }[] = [];
  const verifiedPids: number[] = [];
  const seededActive = new Set<string>();
  beforeAll(async () => {
    const expected = process.env.MISSION_LIFECYCLE_TEST_DATABASE_NAME;
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
    first = new AdminMissionService(a.db); second = new AdminMissionService(b.db);
    await preparedMigrations("before", path => migrate(a.db, { migrationsFolder: path }));
    for (let index = 0; index < 2; index++) {
      const [user] = await a.db.insert(s.users).values({ verifiedEmail: `s9-${index}@test.invalid` }).returning();
      const [admin] = await a.db.insert(s.adminUsers).values({ userId: user.userId, role: "SUPER_ADMIN" }).returning();
      if (index === 0) actor = admin.adminUserId; else actorB = admin.adminUserId;
    }
    const draft = await first.createDraft({ title: "Synthetic pre-0032 draft", description: "", category: "DAILY", displayOrder: 0 }, actor, now);
    sentinel = draft.missionId;
    const oldHistory = await a.db.select().from(missionAdminHistory);
    await expect(preparedMigrations("fail", path => migrate(a.db, { migrationsFolder: path }))).rejects.toThrow();
    expect((await a.pool.query("SELECT to_regclass('public.mission_lifecycle_operations') AS name")).rows[0].name).toBeNull();
    expect((await a.pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count).toBe(32);
    expect((await a.pool.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='mission_admin_history_action_check'")).rows[0].definition).not.toContain("MISSION_ACTIVATED");
    expect(await a.db.select().from(missionAdminHistory)).toEqual(oldHistory);
    await migrate(a.db, { migrationsFolder: folder });
    expect(await a.db.select().from(missionAdminHistory)).toEqual(oldHistory);
  }, 60000);
  afterAll(async () => {
    console.info("LIFECYCLE_POSTGRES_EVIDENCE", JSON.stringify({ verifiedPids, observedLockRaces: evidence }));
    await Promise.all([a?.pool.end(), b?.pool.end()]);
  });
  afterEach(async () => {
    // No operation may award rewards; active rows can only be explicit synthetic seeds.
    for (const table of ["mission_claims", "xp_transactions", "point_transactions", "game_events"]) expect((await a.pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count).toBe(0);
    for (const row of (await a.pool.query("SELECT mission_id FROM missions WHERE active=true")).rows) expect(seededActive.has(row.mission_id)).toBe(true);
  });
  async function preparedMigrations(mode: "before" | "fail", run: (path: string) => Promise<void>) {
    const temporary = await mkdtemp(resolve(tmpdir(), "circzles-s9-migrations-"));
    try {
      const journal = JSON.parse(await readFile(resolve(folder, "meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
      if (mode === "before") journal.entries = journal.entries.filter(entry => entry.idx < 32);
      await mkdir(resolve(temporary, "meta")); await writeFile(resolve(temporary, "meta/_journal.json"), JSON.stringify(journal));
      for (const entry of journal.entries) await copyFile(resolve(folder, entry.tag + ".sql"), resolve(temporary, entry.tag + ".sql"));
      if (mode === "fail") { const path = resolve(temporary, "0032_mission_lifecycle_operations.sql"); await writeFile(path, await readFile(path, "utf8") + "\n--> statement-breakpoint\nSELECT 1/0;"); }
      await run(temporary);
    } finally {
      if (!resolve(temporary).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary migration directory");
      await rm(temporary, { recursive: true });
    }
  }
  async function configured(active = false) {
    const [row] = await a.db.insert(s.missions).values({ title: "Synthetic approval race", description: "", category: "DAILY", periodType: "DAILY", active, activationEffectiveAt: origin, updatedAt: now }).returning();
    await a.db.insert(s.missionRules).values({ missionId: row.missionId, eventType: "puzzle.added", targetCount: 1, conditions: {} });
    await a.db.insert(s.missionRewards).values([{ missionId: row.missionId, rewardType: "XP", amount: 7 }, { missionId: row.missionId, rewardType: "SYNAPSE_POINTS", amount: 3 }]);
    if (active) seededActive.add(row.missionId);
    return row;
  }
  function payload(contract: MissionApprovalContractDto, category = "PRODUCT") {
    const record = contract.categories.find(item => item.category === category)?.recordedApproval;
    return { expectedUpdatedAt: contract.binding.approvedConfigurationRevision, configurationDigest: contract.binding.configurationDigest, expectedApprovalId: record?.approvalId ?? null, expectedRevocationId: record?.revocationId ?? null };
  }
  const statuses = (contract: MissionApprovalContractDto) => contract.categories.map(item => item.status);
  const grant = async (id: string, category = "PRODUCT") => first.changeApproval(id, category, payload(await first.approvalContract(id, now), category), actor, false, now);
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
      await blocker.query("SELECT mission_id FROM missions WHERE mission_id=$1 FOR UPDATE", [id]);
      pending = Promise.allSettled([left(), right()]);
      const rows = await waiters(pid, 2);
      const parentWait=(row:{query:string})=>/for update/i.test(row.query)&&row.query.includes('"missions"');
      expect(rows.some(parentWait)).toBe(true);
      expect(rows.every(row=>parentWait(row)||(/pg_advisory_xact_lock/i.test(row.query)&&row.query.includes("mission-chest-lifecycle")))).toBe(true);
      expect(new Set(rows.map(row => row.pid)).size).toBe(2);
      evidence.push({ name, blockerPid: pid, waiters: rows.map(({ pid, wait_event }) => ({ pid, wait_event })) });
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
    return pending!;
  }
  const audit = (id: string) => a.db.select().from(missionAdminHistory).where(eq(missionAdminHistory.missionId, id));

  async function lifecycleInput(id: string) {
    const c = await first.approvalContract(id, now);
    return { expectedUpdatedAt: c.binding.approvedConfigurationRevision, configurationDigest: c.binding.configurationDigest, idempotencyKey: crypto.randomUUID() };
  }
  const change = (service: AdminMissionService, id: string, action: "ACTIVATE" | "DEACTIVATE", input: unknown, admin = actor) => service.changeLifecycle(id, action, input, admin, () => now);
  const receipts = (id: string) => a.db.select().from(missionLifecycleOperations).where(eq(missionLifecycleOperations.missionId, id));
  const approveBoth = async (id: string) => { await grant(id); await grant(id, "REWARD_BUDGET"); };
  it("0032 migration failure rolls back DDL, constraints and journal; unchanged retry preserves previous audit", async () => {
    expect((await a.pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count).toBe(36);
    expect(await audit(sentinel)).toHaveLength(1);
    expect((await a.pool.query("SELECT count(*)::int AS count FROM pg_trigger WHERE tgrelid='mission_lifecycle_operations'::regclass AND NOT tgisinternal AND tgenabled='O'")).rows[0].count).toBe(2);
    expect((await first.detail(sentinel, now)).active).toBe(false);
  });
  it.each(["same", "different"])("competing %s-key deactivations serialize and create one state transition/audit", async kind => {
    const row = await configured(true), input = await lifecycleInput(row.missionId);
    const outcomes = await race(kind + "-key deactivation", row.missionId,
      () => change(first, row.missionId, "DEACTIVATE", input),
      () => change(second, row.missionId, "DEACTIVATE", kind === "same" ? input : { ...input, idempotencyKey: crypto.randomUUID() }));
    expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(kind === "same" ? 2 : 1);
    if (kind === "different") expect(outcomes.find(item => item.status === "rejected")).toMatchObject({ reason: { code: "MISSION_REVISION_CONFLICT" } });
    else expect(outcomes.filter(item => item.status === "fulfilled").map(item => (item.value as { idempotent: boolean }).idempotent).sort()).toEqual([false, true]);
    expect(await audit(row.missionId)).toHaveLength(1); expect(await receipts(row.missionId)).toHaveLength(1);
    expect((await first.detail(row.missionId, now)).active).toBe(false);
  }, 15000);
  it("concurrent activation attempts with both approvals stay blocked, without receipts or lifecycle audit", async () => {
    const row = await configured(); await approveBoth(row.missionId);
    await a.db.update(s.missionRules).set({active:false}).where(eq(s.missionRules.missionId,row.missionId));
    const input = await lifecycleInput(row.missionId);
    const outcomes = await race("blocked activations", row.missionId,
      () => change(first, row.missionId, "ACTIVATE", input), () => change(second, row.missionId, "ACTIVATE", input));
    expect(outcomes.every(item => item.status === "rejected" && (item.reason as AppError).code === "MISSION_ACTIVATION_BLOCKED" && (item.reason as Error).message.includes("RULE_ENABLED"))).toBe(true);
    expect(await receipts(row.missionId)).toEqual([]); expect(await audit(row.missionId)).toHaveLength(2);
    const r = await first.readiness(row.missionId, now); expect(r.activationReady).toBe(false);
    expect(r.checks.filter(c => c.status === "BLOCKED").map(c => c.code)).toContain("RULE_ENABLED");
    expect(r.checks.find(c=>c.code==="MISSION_CAPACITY_RECOVERY_AVAILABLE")?.status).toBe("PASS");
  }, 15000);
  it.each(["grant", "revoke", "edit"])("activation versus %s cannot bypass approval/configuration serialization", async kind => {
    const row = await configured(); if (kind !== "grant") { await approveBoth(row.missionId); await a.db.update(s.missionRules).set({active:false}).where(eq(s.missionRules.missionId,row.missionId)); }
    const input = await lifecycleInput(row.missionId), contract = await first.approvalContract(row.missionId, now);
    const outcomes = await race("activation versus " + kind, row.missionId,
      () => change(first, row.missionId, "ACTIVATE", input),
      () => kind === "edit" ? second.updateMetadata(row.missionId, { title: "Concurrent change", description: "", displayOrder: 0, expectedUpdatedAt: input.expectedUpdatedAt }, actorB, now) : second.changeApproval(row.missionId, "PRODUCT", payload(contract), actorB, kind === "revoke", now));
    expect(outcomes[0].status).toBe("rejected"); expect(outcomes[1].status).toBe("fulfilled");
    expect((await first.detail(row.missionId, now)).active).toBe(false); expect(await receipts(row.missionId)).toEqual([]);
    const category = (await first.approvalContract(row.missionId, now)).categories[0];
    expect(category.status).toBe(kind === "grant" ? "APPROVED" : kind === "revoke" ? "REVOKED" : "INVALIDATED");
  }, 15000);
  it("deactivation versus editing preserves inactive-only and stale revision restrictions", async () => {
    const row = await configured(true), input = await lifecycleInput(row.missionId);
    const outcomes = await race("deactivation versus editing", row.missionId,
      () => change(first, row.missionId, "DEACTIVATE", input),
      () => second.updateMetadata(row.missionId, { title: "Must not save", description: "", displayOrder: 0, expectedUpdatedAt: input.expectedUpdatedAt }, actorB, now));
    expect(outcomes[0].status).toBe("fulfilled"); expect(outcomes[1].status).toBe("rejected");
    expect((await first.detail(row.missionId, now)).title).toBe(row.title); expect(await audit(row.missionId)).toHaveLength(1);
  }, 15000);
  it.each(["revision", "digest"])("stale %s fails before lifecycle writes", async field => {
    const row = await configured(true), input = await lifecycleInput(row.missionId);
    if (field === "revision") input.expectedUpdatedAt = "2029-01-01T00:00:00Z"; else input.configurationDigest = "0".repeat(64);
    await expect(change(first, row.missionId, "DEACTIVATE", input)).rejects.toMatchObject({ code: "MISSION_REVISION_CONFLICT" });
    expect(await audit(row.missionId)).toEqual([]); expect(await receipts(row.missionId)).toEqual([]);
  });
  it("deactivation and revert cannot revive old approvals; replay never mutates the new revision", async () => {
    const row = await configured(); await approveBoth(row.missionId);
    // Existing active definition fixture; no activation readiness bypass is invoked.
    await a.db.update(s.missions).set({ active: true }).where(eq(s.missions.missionId, row.missionId)); seededActive.add(row.missionId);
    const input = await lifecycleInput(row.missionId), result = await change(first, row.missionId, "DEACTIVATE", input);
    const edited = await first.updateMetadata(row.missionId, { title: "Edited", description: "", displayOrder: 0, expectedUpdatedAt: result.missionRevision }, actor, now);
    const reverted = await first.updateMetadata(row.missionId, { title: row.title, description: "", displayOrder: 0, expectedUpdatedAt: edited.updatedAt }, actor, now);
    expect(statuses(await second.approvalContract(row.missionId, now))).toEqual(["INVALIDATED", "INVALIDATED"]);
    expect(await change(second, row.missionId, "DEACTIVATE", input)).toEqual({ ...result, idempotent: true });
    expect((await first.detail(row.missionId, now)).updatedAt).toBe(reverted.updatedAt);
    await expect(change(first, row.missionId, "ACTIVATE", await lifecycleInput(row.missionId))).rejects.toMatchObject({ code: "MISSION_ACTIVATION_BLOCKED" });
  });
  it("audit failure rolls back state, revision and receipt; unchanged key can then retry safely", async () => {
    const row = await configured(true), input = await lifecycleInput(row.missionId), before = await first.detail(row.missionId, now);
    await a.pool.query("CREATE FUNCTION synthetic_s9_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='MISSION_DEACTIVATED' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_s9_audit_failure BEFORE INSERT ON mission_admin_history FOR EACH ROW EXECUTE FUNCTION synthetic_s9_audit_failure()");
    try { await expect(change(first, row.missionId, "DEACTIVATE", input)).rejects.toThrow(); }
    finally { await a.pool.query("DROP TRIGGER synthetic_s9_audit_failure ON mission_admin_history; DROP FUNCTION synthetic_s9_audit_failure()"); }
    expect(await second.detail(row.missionId, now)).toEqual(before); expect(await receipts(row.missionId)).toEqual([]); expect(await audit(row.missionId)).toEqual([]);
    await change(second, row.missionId, "DEACTIVATE", input); expect(await receipts(row.missionId)).toHaveLength(1); expect(await audit(row.missionId)).toHaveLength(1);
  });
  it("uncommitted lifecycle receipt/state/audit are invisible until their atomic commit", async () => {
    const row = await configured(true), input = await lifecycleInput(row.missionId), blocker = await b.pool.connect();
    const gate = 9032001; let pending: Promise<unknown> | undefined;
    await a.pool.query(`CREATE FUNCTION synthetic_s9_audit_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='MISSION_DEACTIVATED' THEN PERFORM pg_advisory_xact_lock(${gate}); END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_s9_audit_delay BEFORE INSERT ON mission_admin_history FOR EACH ROW EXECUTE FUNCTION synthetic_s9_audit_delay()`);
    try {
      await blocker.query("BEGIN"); await blocker.query("SELECT pg_advisory_xact_lock($1)", [gate]);
      const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      pending = change(first, row.missionId, "DEACTIVATE", input); void pending.catch(() => {});
      const rows = await waiters(pid, 1); expect(rows.some(row => row.wait_event === "advisory")).toBe(true);
      evidence.push({ name: "uncommitted lifecycle visibility", blockerPid: pid, waiters: rows.map(({ pid, wait_event }) => ({ pid, wait_event })) });
      expect((await b.pool.query("SELECT active FROM missions WHERE mission_id=$1", [row.missionId])).rows[0].active).toBe(true);
      expect((await b.pool.query("SELECT count(*)::int AS count FROM mission_lifecycle_operations WHERE mission_id=$1", [row.missionId])).rows[0].count).toBe(0);
      expect((await b.pool.query("SELECT count(*)::int AS count FROM mission_admin_history WHERE mission_id=$1", [row.missionId])).rows[0].count).toBe(0);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
    try { await pending; } finally { await a.pool.query("DROP TRIGGER synthetic_s9_audit_delay ON mission_admin_history; DROP FUNCTION synthetic_s9_audit_delay()"); }
    expect(await receipts(row.missionId)).toHaveLength(1); expect(await audit(row.missionId)).toHaveLength(1);
  }, 15000);
  it("deactivation waits for a processing-style FOR SHARE lock before stopping future work", async () => {
    const row = await configured(true), input = await lifecycleInput(row.missionId), blocker = await a.pool.connect(); let pending: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN"); await blocker.query("SELECT mission_id FROM missions WHERE mission_id=$1 FOR SHARE", [row.missionId]);
      const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      pending = change(second, row.missionId, "DEACTIVATE", input); void pending.catch(() => {});
      const rows = await waiters(pid, 1); expect(rows[0].query).toMatch(/for update/i);
      evidence.push({ name: "processor share lock versus deactivation", blockerPid: pid, waiters: rows.map(({ pid, wait_event }) => ({ pid, wait_event })) });
      expect((await blocker.query("SELECT active FROM missions WHERE mission_id=$1", [row.missionId])).rows[0].active).toBe(true);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
    await pending; expect((await second.detail(row.missionId, now)).active).toBe(false);
  }, 15000);
  it("deactivation preserves earned snapshots, deadlines and progress without any payout", async () => {
    const row = await configured(true);
    const [user] = await a.db.insert(s.users).values({ verifiedEmail: "s9-earned@test.invalid" }).returning();
    const [player] = await a.db.insert(s.players).values({ userId: user.userId, displayName: "Synthetic earned" }).returning();
    await a.db.insert(s.playerMissionProgress).values({ playerId: player.playerId, missionId: row.missionId, periodKey: "2030-02-10", status: "CLAIMABLE", currentCount: 1, targetCountSnapshot: 1, rewardSnapshot: { version: 1, rewards: [{ type: "XP", amount: 7 }, { type: "SYNAPSE_POINTS", amount: 3 }] }, completedAt: now, claimDeadline: new Date("2030-02-12Z") });
    const before = await a.db.select().from(s.playerMissionProgress);
    const rewards = await a.db.select().from(s.missionRewards).where(eq(s.missionRewards.missionId, row.missionId));
    await change(first, row.missionId, "DEACTIVATE", await lifecycleInput(row.missionId));
    expect(await b.db.select().from(s.playerMissionProgress)).toEqual(before);
    expect(await b.db.select().from(s.missionRewards).where(eq(s.missionRewards.missionId, row.missionId))).toEqual(rewards);
  });
  it("database unique and append-only guards protect receipts and all previous audit tables", async () => {
    const row = await configured(); await change(first, row.missionId, "DEACTIVATE", await lifecycleInput(row.missionId));
    const [receipt] = await receipts(row.missionId);
    await expect(b.db.insert(missionLifecycleOperations).values({ ...receipt, operationId: crypto.randomUUID() })).rejects.toThrow();
    for (const [table, field] of [["mission_lifecycle_operations", "occurred_at"], ["mission_admin_history", "occurred_at"], ["mission_approvals", "approved_at"], ["mission_approval_revocations", "revoked_at"]]) for (const command of [`UPDATE ${table} SET ${field}=now()`, `DELETE FROM ${table}`, `TRUNCATE ${table} CASCADE`]) await expect(b.pool.query(command)).rejects.toThrow(/append-only/);
    expect(await receipts(row.missionId)).toHaveLength(1);
  });
  it("idempotency keys cannot be reassigned to another actor/action/binding", async () => {
    const row = await configured(true), input = await lifecycleInput(row.missionId); await change(first, row.missionId, "DEACTIVATE", input);
    await expect(change(second, row.missionId, "DEACTIVATE", input, actorB)).rejects.toMatchObject({ code: "MISSION_LIFECYCLE_KEY_CONFLICT" });
    await expect(change(second, row.missionId, "ACTIVATE", input)).rejects.toMatchObject({ code: "MISSION_LIFECYCLE_KEY_CONFLICT" });
    await expect(change(second, row.missionId, "DEACTIVATE", { ...input, configurationDigest: "0".repeat(64) })).rejects.toMatchObject({ code: "MISSION_LIFECYCLE_KEY_CONFLICT" });
  });
  it.each(["REVIEWER", "INACTIVE", "MISSING"])("independent transaction authorization rejects %s", async kind => {
    const row = await configured(true); let id: string = crypto.randomUUID();
    if (kind !== "MISSING") {
      const [user] = await a.db.insert(s.users).values({ verifiedEmail: crypto.randomUUID() + "@test.invalid" }).returning();
      const [admin] = await a.db.insert(s.adminUsers).values({ userId: user.userId, role: kind === "REVIEWER" ? "REVIEWER" : "SUPER_ADMIN", active: kind !== "INACTIVE" }).returning(); id = admin.adminUserId;
    }
    for (const action of ["ACTIVATE", "DEACTIVATE"] as const) await expect(change(first, row.missionId, action, await lifecycleInput(row.missionId), id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await audit(row.missionId)).toEqual([]);
  });
  it("HTTP uses authenticated actor, rejects forged writes/origins and keeps activation blocked", async () => {
    const row = await configured(), secret = "synthetic-local-s9-session-secret-more-than-32";
    await approveBoth(row.missionId);
    // Capacity recovery now resolves the former policy blocker. Use a real
    // configuration blocker rather than assuming every approved mission fails.
    await a.db.update(s.missionRules).set({ active: false }).where(eq(s.missionRules.missionId, row.missionId));
    const [admin] = await a.db.select().from(s.adminUsers).where(eq(s.adminUsers.adminUserId, actorB));
    const token = crypto.randomUUID(); await a.db.insert(s.authSessions).values({ userId: admin.userId, tokenHash: hashSessionToken(token, secret), expiresAt: new Date(Date.now() + 60000) });
    const app = Fastify(); await app.register(cookie);
    app.setErrorHandler((error, _req, reply) => { if (error instanceof AppError) reply.code(error.statusCode).send({ code: error.code }); else reply.code(500).send({ code: "INTERNAL" }); });
    registerAdminMissionRoutes(app, { env: { NODE_ENV: "production", FRONTEND_ORIGIN: "https://hub.test.invalid", PLAYER_HUB_PROXY_SECRET: "synthetic-proxy" } as Env, adminAuth: new AdminAuthorizationService(new DrizzleAdminAuthorizationRepository(a.db), secret), adminMissions: first });
    await app.ready(); const headers = { cookie: SESSION_COOKIE_NAME + "=" + token, "x-player-hub-proxy-secret": "synthetic-proxy", origin: "https://hub.test.invalid" }, input = await lifecycleInput(row.missionId), url = `/api/admin/missions/${row.missionId}/activate`;
    try {
      expect((await app.inject({ method: "POST", url, payload: input })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url, headers: { cookie: headers.cookie }, payload: input })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url, headers: { ...headers, origin: "https://evil.test.invalid" }, payload: input })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url, headers, payload: { ...input, actorAdminUserId: actor } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url, headers, payload: input })).statusCode).toBe(409);
      const response = await app.inject({ method: "POST", url: url.replace(/activate$/, "deactivate"), headers, payload: input }); expect(response.statusCode).toBe(200);
      expect((await audit(row.missionId))[2].actorAdminUserId).toBe(actorB);
    } finally { await app.close(); }
  });
});
