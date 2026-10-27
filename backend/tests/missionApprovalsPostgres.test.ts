import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "../src/db/client.js";
import * as s from "../src/db/schema.js";
import { missionApprovals, missionApprovalRevocations, missionAdminHistory } from "../src/db/missionAdminSchema.js";
import { AdminMissionService } from "../src/domain/adminMissions.js";
import type { MissionApprovalContractDto } from "../src/domain/missionApprovalContract.js";
import { localMissionPostgresUrl } from "./helpers/localMissionPostgres.js";

// Separate opt-in from the M1 suite: never reuse its populated database or an
// application URL, load .env, or reset any database to satisfy the empty guard.
const url = process.env.MISSION_APPROVALS_TEST_DATABASE_URL;
describe.skipIf(!url)("Slice 8 real PostgreSQL approval integrity", () => {
  let a: ReturnType<typeof createDb>, b: ReturnType<typeof createDb>;
  let first: AdminMissionService, second: AdminMissionService, actor: string, actorB: string, sentinel: string;
  const now = new Date("2030-02-10T12:00:00Z"), origin = new Date("2025-01-01Z");
  const folder = fileURLToPath(new URL("../drizzle/", import.meta.url));
  const names = ["circzles_s8_a", "circzles_s8_b"];
  const evidence: { name: string; blockerPid: number; waiters: { pid: number; wait_event: string }[] }[] = [];
  const verifiedPids: number[] = [];
  beforeAll(async () => {
    const expected = process.env.MISSION_APPROVALS_TEST_DATABASE_NAME;
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
      const [user] = await a.db.insert(s.users).values({ verifiedEmail: `s8-${index}@test.invalid` }).returning();
      const [admin] = await a.db.insert(s.adminUsers).values({ userId: user.userId, role: "SUPER_ADMIN" }).returning();
      if (index === 0) actor = admin.adminUserId; else actorB = admin.adminUserId;
    }
    const draft = await first.createDraft({ title: "Synthetic pre-0031 draft", description: "", category: "DAILY", displayOrder: 0 }, actor, now);
    sentinel = draft.missionId;
    const oldHistory = await a.db.select().from(missionAdminHistory);
    await expect(preparedMigrations("fail", path => migrate(a.db, { migrationsFolder: path }))).rejects.toThrow();
    expect((await a.pool.query("SELECT to_regclass('public.mission_approvals') AS name")).rows[0].name).toBeNull();
    expect((await a.pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count).toBe(31);
    expect((await a.pool.query("SELECT count(*)::int AS count FROM pg_proc WHERE proname='mission_approval_immutable'")).rows[0].count).toBe(0);
    expect(await a.db.select().from(missionAdminHistory)).toEqual(oldHistory);
    await migrate(a.db, { migrationsFolder: folder });
    expect(await a.db.select().from(missionAdminHistory)).toEqual(oldHistory);
  }, 60000);
  afterAll(async () => {
    console.info("APPROVAL_POSTGRES_EVIDENCE", JSON.stringify({ verifiedPids, observedLockRaces: evidence }));
    await Promise.all([a?.pool.end(), b?.pool.end()]);
  });
  afterEach(async () => {
    // Approval operations must never create players, progression or rewards.
    for (const table of ["players", "wallets", "player_progression", "player_mission_progress", "mission_claims", "xp_transactions", "point_transactions", "game_events"]) expect((await a.pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count).toBe(0);
    expect((await a.pool.query("SELECT count(*)::int AS count FROM missions WHERE active=true")).rows[0].count).toBe(0);
  });
  async function preparedMigrations(mode: "before" | "fail", run: (path: string) => Promise<void>) {
    const temporary = await mkdtemp(resolve(tmpdir(), "circzles-s8-migrations-"));
    try {
      const journal = JSON.parse(await readFile(resolve(folder, "meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
      if (mode === "before") journal.entries = journal.entries.filter(entry => entry.idx < 31);
      await mkdir(resolve(temporary, "meta")); await writeFile(resolve(temporary, "meta/_journal.json"), JSON.stringify(journal));
      for (const entry of journal.entries) await copyFile(resolve(folder, entry.tag + ".sql"), resolve(temporary, entry.tag + ".sql"));
      if (mode === "fail") { const path = resolve(temporary, "0031_mission_approvals.sql"); await writeFile(path, await readFile(path, "utf8") + "\n--> statement-breakpoint\nSELECT 1/0;"); }
      await run(temporary);
    } finally {
      if (!resolve(temporary).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary migration directory");
      await rm(temporary, { recursive: true });
    }
  }
  async function configured() {
    const [row] = await a.db.insert(s.missions).values({ title: "Synthetic approval race", description: "", category: "DAILY", periodType: "DAILY", active: false, activationEffectiveAt: origin, updatedAt: now }).returning();
    await a.db.insert(s.missionRules).values({ missionId: row.missionId, eventType: "puzzle.added", targetCount: 1, conditions: {} });
    await a.db.insert(s.missionRewards).values([{ missionId: row.missionId, rewardType: "XP", amount: 7 }, { missionId: row.missionId, rewardType: "SYNAPSE_POINTS", amount: 3 }]);
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
      expect(rows.every(row => /for update/i.test(row.query) && row.query.includes('"missions"'))).toBe(true);
      expect(new Set(rows.map(row => row.pid)).size).toBe(2);
      evidence.push({ name, blockerPid: pid, waiters: rows.map(({ pid, wait_event }) => ({ pid, wait_event })) });
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
    return pending!;
  }
  const audit = (id: string) => a.db.select().from(missionAdminHistory).where(eq(missionAdminHistory.missionId, id));

  it("migration 0031 rolls back completely, retries and preserves inactive definitions and immutable audit history", async () => {
    expect((await a.pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count).toBe(36);
    expect((await first.detail(sentinel, now)).active).toBe(false);
    expect(await audit(sentinel)).toHaveLength(1);
  });
  it.each(["PRODUCT", "REWARD_BUDGET"])("simultaneous duplicate %s grants commit once with the winning actor and one audit", async category => {
    const row = await configured(), input = payload(await first.approvalContract(row.missionId, now), category);
    const outcomes = await race(category + " duplicates", row.missionId,
      () => first.changeApproval(row.missionId, category, input, actor, false, now),
      () => second.changeApproval(row.missionId, category, input, actorB, false, now));
    expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find(item => item.status === "rejected")).toMatchObject({ reason: { code: "MISSION_APPROVAL_CONFLICT" } });
    const [record] = await a.db.select().from(missionApprovals).where(eq(missionApprovals.missionId, row.missionId));
    const entries = await audit(row.missionId); expect(entries).toHaveLength(1); expect(entries[0].actorAdminUserId).toBe(record.approverAdminUserId);
    expect((await first.readiness(row.missionId, now)).activationReady).toBe(false);
  }, 15000);
  it("independent grants share a revision but become ready only after both commit", async () => {
    const row = await configured(), contract = await first.approvalContract(row.missionId, now);
    const outcomes = await race("independent categories", row.missionId,
      () => first.changeApproval(row.missionId, "PRODUCT", payload(contract), actor, false, now),
      () => second.changeApproval(row.missionId, "REWARD_BUDGET", payload(contract, "REWARD_BUDGET"), actorB, false, now));
    expect(outcomes.every(item => item.status === "fulfilled")).toBe(true);
    expect(statuses(await first.approvalContract(row.missionId, now))).toEqual(["APPROVED", "APPROVED"]);
    expect((await first.readiness(row.missionId, now)).checks.filter(check => check.status === "BLOCKED").map(check => check.code)).toEqual([]);
    expect((await first.readiness(row.missionId, now)).activationReady).toBe(true); expect(await audit(row.missionId)).toHaveLength(2);
  }, 15000);
  it("simultaneous duplicate revocations commit one immutable revocation and one audit", async () => {
    const row = await configured(), contract = await grant(row.missionId), input = payload(contract);
    const outcomes = await race("duplicate revocations", row.missionId,
      () => first.changeApproval(row.missionId, "PRODUCT", input, actor, true, now),
      () => second.changeApproval(row.missionId, "PRODUCT", input, actorB, true, now));
    expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find(item => item.status === "rejected")).toMatchObject({ reason: { code: "MISSION_APPROVAL_CONFLICT" } });
    expect(await audit(row.missionId)).toHaveLength(2); expect(statuses(await first.approvalContract(row.missionId, now))).toEqual(["REVOKED", "MISSING"]);
  }, 15000);
  it("grant versus revocation cannot retain approval or let a stale revocation cancel a replacement", async () => {
    const row = await configured(); await grant(row.missionId); const contract = await grant(row.missionId, "REWARD_BUDGET"), input = payload(contract);
    const outcomes = await race("approval versus revocation", row.missionId,
      () => first.changeApproval(row.missionId, "PRODUCT", input, actor, false, now),
      () => second.changeApproval(row.missionId, "PRODUCT", input, actorB, true, now));
    expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect((await first.readiness(row.missionId, now)).activationReady).toBe(false);
    const replacement = await grant(row.missionId);
    await expect(second.changeApproval(row.missionId, "PRODUCT", input, actorB, true, now)).rejects.toMatchObject({ code: "MISSION_APPROVAL_CONFLICT" });
    expect(statuses(await first.approvalContract(row.missionId, now))).toEqual(["APPROVED", "APPROVED"]);
    expect(replacement.categories[0].recordedApproval?.approvalId).not.toBe(contract.categories[0].recordedApproval?.approvalId);
  }, 15000);
  it("a budget grant racing product revocation leaves an unapproved mission blocked", async () => {
    const row = await configured(), contract = await grant(row.missionId);
    const outcomes = await race("budget versus product revocation", row.missionId,
      () => first.changeApproval(row.missionId, "REWARD_BUDGET", payload(contract, "REWARD_BUDGET"), actor, false, now),
      () => second.changeApproval(row.missionId, "PRODUCT", payload(contract), actorB, true, now));
    expect(outcomes.every(item => item.status === "fulfilled")).toBe(true);
    expect(statuses(await first.approvalContract(row.missionId, now))).toEqual(["REVOKED", "APPROVED"]);
    expect((await first.readiness(row.missionId, now)).activationReady).toBe(false);
  }, 15000);
  it.each(["metadata", "rule", "rewards", "schedule"])("approval racing %s editing cannot approve the changed or unsafe configuration", async kind => {
    const row = await configured(), contract = await grant(row.missionId), revision = row.updatedAt.toISOString();
    const edit = () => kind === "metadata" ? second.updateMetadata(row.missionId, { title: "Changed", description: "", displayOrder: 0, expectedUpdatedAt: revision }, actorB, now)
      : kind === "rule" ? second.updateRule(row.missionId, { eventType: "puzzle.added", targetCount: 1, sourceType: null, puzzleId: null, levelId: null, conditions: {}, active: false, expectedUpdatedAt: revision }, actorB, now)
      : kind === "rewards" ? second.updateRewards(row.missionId, { xp: 8, synapsePoints: 4, expectedUpdatedAt: revision }, actorB, now)
      : second.updateSchedule(row.missionId, { startsAt: null, endsAt: "2030-02-10T11:00:00Z", claimDeadline: null, expectedUpdatedAt: revision }, actorB, now);
    const outcomes = await race(kind + " edit versus approval", row.missionId,
      () => first.changeApproval(row.missionId, "REWARD_BUDGET", payload(contract, "REWARD_BUDGET"), actor, false, now), edit);
    expect(outcomes[1].status).toBe("fulfilled");
    const after = await first.approvalContract(row.missionId, now);
    expect(after.categories.every(item => item.status !== "APPROVED")).toBe(true);
    expect((await first.readiness(row.missionId, now)).activationReady).toBe(false);
  }, 15000);
  it.each(["revision", "digest"])("rejects stale %s without approval or audit insertion", async kind => {
    const row = await configured(), input = payload(await first.approvalContract(row.missionId, now));
    if (kind === "revision") await second.updateMetadata(row.missionId, { title: "Changed", description: "", displayOrder: 0, expectedUpdatedAt: row.updatedAt.toISOString() }, actorB, now);
    else await b.db.update(s.missionRules).set({ targetCount: 2 }).where(eq(s.missionRules.missionId, row.missionId)); // Simulated legacy writer omitting revision.
    const before = await audit(row.missionId);
    await expect(first.changeApproval(row.missionId, "PRODUCT", input, actor, false, now)).rejects.toMatchObject({ code: "MISSION_REVISION_CONFLICT" });
    expect(await audit(row.missionId)).toEqual(before); expect(await a.db.select().from(missionApprovals).where(eq(missionApprovals.missionId, row.missionId))).toEqual([]);
  });
  it("edit and revert cannot revive either historical approval even when values return", async () => {
    const row = await configured(); await grant(row.missionId); const old = await grant(row.missionId, "REWARD_BUDGET");
    const edited = await second.updateMetadata(row.missionId, { title: "Temporary", description: "", displayOrder: 0, expectedUpdatedAt: row.updatedAt.toISOString() }, actorB, now);
    await first.updateMetadata(row.missionId, { title: row.title, description: "", displayOrder: 0, expectedUpdatedAt: edited.updatedAt }, actor, now);
    expect(statuses(await second.approvalContract(row.missionId, now))).toEqual(["INVALIDATED", "INVALIDATED"]);
    expect((await second.readiness(row.missionId, now)).activationReady).toBe(false);
    await expect(second.changeApproval(row.missionId, "PRODUCT", payload(old), actorB, false, now)).rejects.toMatchObject({ code: "MISSION_REVISION_CONFLICT" });
  });
  async function auditTrigger(id: string, statement: string) {
    await a.pool.query(`CREATE FUNCTION synthetic_s8_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.mission_id='${id}' AND NEW.action LIKE 'APPROVAL_%' THEN ${statement} END IF; RETURN NEW; END; $$; CREATE TRIGGER synthetic_s8_audit BEFORE INSERT ON mission_admin_history FOR EACH ROW EXECUTE FUNCTION synthetic_s8_audit();`);
  }
  async function removeAuditTrigger() { await a.pool.query("DROP TRIGGER synthetic_s8_audit ON mission_admin_history; DROP FUNCTION synthetic_s8_audit();"); }
  it.each([false, true])("approval/audit rollback is atomic across connections revoke=%s", async revoke => {
    const row = await configured(); if (revoke) await grant(row.missionId);
    const before = await first.approvalContract(row.missionId, now), history = await audit(row.missionId);
    await auditTrigger(row.missionId, "RAISE EXCEPTION 'synthetic audit failure';");
    try { await expect(second.changeApproval(row.missionId, "PRODUCT", payload(before), actorB, revoke, now)).rejects.toThrow(); }
    finally { await removeAuditTrigger(); }
    expect(await first.approvalContract(row.missionId, now)).toEqual(before); expect(await audit(row.missionId)).toEqual(history);
  });
  it("an approval and readiness stay invisible until its audit transaction commits", async () => {
    const row = await configured(), contract = await grant(row.missionId), blocker = await a.pool.connect();
    let pending: Promise<MissionApprovalContractDto> | undefined;
    await auditTrigger(row.missionId, "PERFORM pg_advisory_xact_lock(7831521);");
    try {
      await blocker.query("BEGIN; SELECT pg_advisory_xact_lock(7831521)");
      const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      pending = second.changeApproval(row.missionId, "REWARD_BUDGET", payload(contract, "REWARD_BUDGET"), actorB, false, now);
      const rows = await waiters(pid, 1); expect(rows[0].query).toContain('"mission_admin_history"');
      evidence.push({ name: "uncommitted audit visibility", blockerPid: pid, waiters: rows.map(({ pid, wait_event }) => ({ pid, wait_event })) });
      expect(statuses(await first.approvalContract(row.missionId, now))).toEqual(["APPROVED", "MISSING"]);
      expect((await first.readiness(row.missionId, now)).activationReady).toBe(false); expect(await audit(row.missionId)).toHaveLength(1);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
    try { await pending!; } finally { await removeAuditTrigger(); }
    expect((await first.readiness(row.missionId, now)).checks.filter(check => check.status === "BLOCKED").map(check => check.code)).toEqual([]);
    expect((await first.readiness(row.missionId, now)).activationReady).toBe(true); expect(await audit(row.missionId)).toHaveLength(2);
  }, 15000);
  it("database uniqueness rejects duplicate revocations from independent pools", async () => {
    const row = await configured(), approved = await grant(row.missionId), input = payload(approved);
    await first.changeApproval(row.missionId, "PRODUCT", input, actor, true, now);
    for (const pool of [a.pool, b.pool]) await expect(pool.query("INSERT INTO mission_approval_revocations(approval_id,actor_admin_user_id) VALUES($1,$2)", [input.expectedApprovalId, actorB])).rejects.toMatchObject({ code: "23505" });
    expect(await audit(row.missionId)).toHaveLength(2);
    expect(await a.db.select().from(missionApprovalRevocations).where(eq(missionApprovalRevocations.approvalId, BigInt(input.expectedApprovalId!)))).toHaveLength(1);
  });
  it("0031 and existing audit records reject UPDATE, DELETE and TRUNCATE on real PostgreSQL", async () => {
    const row = await configured(), approved = await grant(row.missionId); await first.changeApproval(row.missionId, "PRODUCT", payload(approved), actor, true, now);
    const before = await first.approvalContract(row.missionId, now), history = await audit(row.missionId);
    for (const [table, field] of [["mission_approvals", "approved_at"], ["mission_approval_revocations", "revoked_at"], ["mission_admin_history", "occurred_at"]]) for (const statement of [`UPDATE ${table} SET ${field}=now()`, `DELETE FROM ${table}`, `TRUNCATE ${table} CASCADE`]) await expect(b.pool.query(statement)).rejects.toThrow(/append-only/);
    expect(await first.approvalContract(row.missionId, now)).toEqual(before); expect(await audit(row.missionId)).toEqual(history);
  });
  it("simultaneous grants cannot make an unsafe incomplete definition ready", async () => {
    const row = await configured(); await a.db.update(s.missionRewards).set({ active: false }).where(eq(s.missionRewards.missionId, row.missionId));
    const contract = await first.approvalContract(row.missionId, now);
    const result = await race("unsafe configuration", row.missionId,
      () => first.changeApproval(row.missionId, "PRODUCT", payload(contract), actor, false, now),
      () => second.changeApproval(row.missionId, "REWARD_BUDGET", payload(contract, "REWARD_BUDGET"), actorB, false, now));
    expect(result.every(item => item.status === "rejected" && (item.reason as { code: string }).code === "MISSION_APPROVAL_NOT_READY")).toBe(true);
    expect(await audit(row.missionId)).toEqual([]); expect((await first.readiness(row.missionId, now)).activationReady).toBe(false);
  }, 15000);
});
