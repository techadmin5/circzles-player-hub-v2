import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createDb } from "../src/db/client.js";
import * as s from "../src/db/schema.js";
import { buildApp, type AppDeps } from "../src/http/app.js";
import { AdminMissionService, type AdminMissionDto } from "../src/domain/adminMissions.js";
import { AdminAuthorizationService, DrizzleAdminAuthorizationRepository } from "../src/domain/adminAuth.js";
import { IdentityService, DrizzleIdentityRepository } from "../src/domain/identity.js";
import { DrizzleGameStateRepository, GameStateService, debitPointsInTransaction } from "../src/domain/gameState.js";
import { DrizzleMissionRepository, DrizzleMissionClaimRepository, PlayerMissionService, MissionClaimService, type MissionDto } from "../src/domain/missions.js";
import { GameEventService, DrizzleGameEventRepository } from "../src/domain/gameEvents.js";
import { hashSessionToken, SESSION_COOKIE_NAME } from "../src/domain/sessions.js";
import { localMissionPostgresUrl } from "./helpers/localMissionPostgres.js";

// Explicit opt-in; never load .env, start a server/worker, reset a database or use external services.
const url = process.env.MISSION_E2E_TEST_DATABASE_URL;
describe.skipIf(!url)("isolated PostgreSQL admin-to-player HTTP rehearsal", () => {
  let connection: ReturnType<typeof createDb>, app: ReturnType<typeof buildApp>;
  let adminCookie: string, playerCookie: string, playerId: string;
  const secret = "synthetic-e2e-session-secret-at-least-32-characters";
  const origin = "https://hub.test.invalid";
  const pids: number[] = [];
  beforeAll(async () => {
    const expected = process.env.MISSION_E2E_TEST_DATABASE_NAME;
    const target = localMissionPostgresUrl(url, expected, process.env.MISSIONS_POSTGRES_DISPOSABLE);
    connection = createDb(target.toString(), () => {});
    const clients = await Promise.all([connection.pool.connect(), connection.pool.connect()]);
    try {
      for (const client of clients) {
        const identity = (await client.query("SELECT current_database() AS database,current_user AS role,session_user AS session_role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::int AS version,pg_backend_pid() AS pid")).rows[0];
        if (identity.database !== expected || identity.role !== "circzles_test" || identity.session_role !== "circzles_test" || identity.host !== "127.0.0.1" || identity.port !== 5432 || identity.version !== 180006) throw new Error("STOP: local disposable PostgreSQL 18.6 identity mismatch before writes");
        pids.push(identity.pid);
      }
      expect(new Set(pids).size).toBe(2);
      if ((await clients[0].query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema IN ('public','drizzle')")).rows[0].count !== 0) throw new Error("STOP: database must be empty; existing databases must never be reset");
    } finally { clients.forEach(client => client.release()); }
    const migrationsFolder = fileURLToPath(new URL("../drizzle/", import.meta.url));
    const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: { idx: number }[] };
    if (journal.entries.length !== 36 || journal.entries.at(-1)?.idx !== 35) throw new Error("STOP: rehearsal authorizes only migrations 0000-0035");
    await migrate(connection.db, { migrationsFolder });
    await connection.db.insert(s.progressionLevels).values({ progressionLevel: 1, rankName: "Synthetic", xpRequired: 0, rewards: [] });
    const identity = new IdentityService(new DrizzleIdentityRepository(connection.db), secret);
    const missionRepo = new DrizzleMissionRepository(connection.db);
    // Non-mission dependencies are fail-closed, not live integrations or permissive mocks.
    function unused<K extends keyof AppDeps>(name: K): AppDeps[K] {
      return new Proxy({}, { get() { throw new Error(`Unexpected non-mission service: ${name}`); } }) as AppDeps[K];
    }
    app = buildApp({
      env: { NODE_ENV: "test", PORT: 4000, DATABASE_URL: target.toString(), FRONTEND_ORIGIN: origin, SESSION_SECRET: secret, COOKIE_SECURE: false, SESSION_COOKIE_SAME_SITE: "lax", AUTH_SESSION_DIAGNOSTICS: false, MISSION_PROCESSOR_ENABLED: false, MISSION_CLAIMS_ENABLED: true, MISSION_PROCESSOR_INTERVAL_MS: 5000, MISSION_PROCESSOR_BATCH_SIZE: 50, BACKEND_SHUTDOWN_TIMEOUT_MS: 25000 },
      identity, gameState: new GameStateService(new DrizzleGameStateRepository(connection.db)),
      adminAuth: new AdminAuthorizationService(new DrizzleAdminAuthorizationRepository(connection.db), secret),
      adminMissions: new AdminMissionService(connection.db), missions: new PlayerMissionService(missionRepo),
      missionClaims: new MissionClaimService(new DrizzleMissionClaimRepository(connection.db)),
      puzzles: unused("puzzles"), submissions: unused("submissions"), adminSubmissions: unused("adminSubmissions"), leaderboards: unused("leaderboards"), submissionReviews: unused("submissionReviews"), publicProfiles: unused("publicProfiles"), rewardCatalog: unused("rewardCatalog"), storePurchases: unused("storePurchases"), inventory: unused("inventory"), coupons: unused("coupons"), playerIdentityActions: unused("playerIdentityActions"), rewardWheel: unused("rewardWheel"), checkDb: async () => { await connection.pool.query("SELECT 1"); },
    });
    adminCookie = (await account(true)).cookie;
    const player = await account(false); playerCookie = player.cookie; playerId = player.id;
  }, 60000);
  afterAll(async () => { await app?.close(); await connection?.pool.end(); console.info("MISSION_E2E_LOCAL_EVIDENCE", JSON.stringify({ pids, database: process.env.MISSION_E2E_TEST_DATABASE_NAME })); });
  async function account(admin: boolean) {
    const [user] = await connection.db.insert(s.users).values({ verifiedEmail: `${crypto.randomUUID()}@test.invalid` }).returning();
    const [player] = await connection.db.insert(s.players).values({ userId: user.userId, displayName: admin ? "Synthetic admin" : "Synthetic player" }).returning();
    if (admin) await connection.db.insert(s.adminUsers).values({ userId: user.userId, role: "SUPER_ADMIN" });
    const token = crypto.randomUUID();
    await connection.db.insert(s.authSessions).values({ userId: user.userId, tokenHash: hashSessionToken(token, secret), expiresAt: new Date(Date.now() + 3600000) });
    await new GameStateService(new DrizzleGameStateRepository(connection.db)).ensurePlayerGameState(player.playerId);
    return { id: player.playerId, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }
  async function request<T>(method: "GET" | "POST" | "PATCH", path: string, payload?: object, cookie = adminCookie, status = 200, key?: string): Promise<T> {
    const response = await app.inject({ method, url: path, headers: { cookie, origin, ...(key ? { "Idempotency-Key": key } : {}) }, ...(payload ? { payload } : {}) });
    expect({ status: response.statusCode, body: response.statusCode === status ? undefined : response.json() }).toEqual({ status, body: undefined });
    return response.json<T>();
  }
  async function binding(id: string) {
    const c = await request<Awaited<ReturnType<AdminMissionService["approvalContract"]>>>("GET", `/api/admin/missions/${id}/approval-contract`);
    return { expectedUpdatedAt: c.binding.approvedConfigurationRevision, configurationDigest: c.binding.configurationDigest };
  }
  async function lifecycle(id: string, action: "activate" | "deactivate") { return request("POST", `/api/admin/missions/${id}/${action}`, { ...await binding(id), idempotencyKey: crypto.randomUUID() }); }
  async function configured(category = "DAILY") {
    let mission = await request<AdminMissionDto>("POST", "/api/admin/missions", { title: "Synthetic HTTP rehearsal", description: "Local fixtures only", category, displayOrder: 0 }, adminCookie, 201);
    expect(mission.active).toBe(false); expect(mission.rewards).toEqual([]);
    expect((await request<{ missions: MissionDto[] }>("GET", "/api/missions/periods", undefined, playerCookie)).missions.some(row => row.missionId === mission.missionId)).toBe(false);
    const path = `/api/admin/missions/${mission.missionId}`;
    mission = await request("PATCH", path + "/rule", { eventType: "puzzle.added", targetCount: 1, sourceType: "PUZZLE_CLAIM", puzzleId: null, levelId: null, conditions: {}, active: true, expectedUpdatedAt: mission.updatedAt });
    const end = Date.now() + 6500;
    mission = await request("PATCH", path + "/schedule", { startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: new Date(category === "DAILY" ? end + 3600000 : end).toISOString(), claimDeadline: category === "DAILY" ? null : new Date(end + 500).toISOString(), expectedUpdatedAt: mission.updatedAt });
    mission = await request("PATCH", path + "/rewards", { xp: 7, synapsePoints: 3, expectedUpdatedAt: mission.updatedAt });
    for (const category of ["PRODUCT", "REWARD_BUDGET"]) await request("POST", path + `/approvals/${category}`, { ...await binding(mission.missionId), expectedApprovalId: null, expectedRevocationId: null });
    expect((await request<{ activationReady: boolean }>("GET", path + "/readiness")).activationReady).toBe(true);
    await lifecycle(mission.missionId, "activate");
    return mission;
  }
  async function complete(id: string, owner: string) {
    const events = new GameEventService(new DrizzleGameEventRepository(connection.db));
    const input = { playerId: owner, eventType: "puzzle.added" as const, sourceType: "PUZZLE_CLAIM", sourceId: crypto.randomUUID(), payload: { puzzleId: crypto.randomUUID(), levelId: 1 }, idempotencyKey: crypto.randomUUID() };
    await events.append(input); expect((await events.append(input)).idempotent).toBe(true);
    const processor = new DrizzleMissionRepository(connection.db);
    for (let n = 0; n < 10 && await processor.processBatch(100); n++) { /* Explicit bounded processing, no background runner. */ }
    const [progress] = await connection.db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.missionId, id));
    expect(progress).toMatchObject({ playerId: owner, status: "CLAIMABLE", currentCount: 1, rewardSnapshot: { version: 1, rewards: [{ type: "XP", amount: 7 }, { type: "SYNAPSE_POINTS", amount: 3 }] } });
    return progress;
  }
  it("migrates only the fresh database through 0035", async () => { expect((await connection.pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count).toBe(36); });
  it("requires authenticated SUPER_ADMIN for real admin APIs", async () => {
    await request("POST", "/api/admin/missions", { title: "Forbidden" }, playerCookie, 403);
    const response = await app.inject({ method: "GET", url: "/api/admin/missions" }); expect(response.statusCode).toBe(401);
  });
  it("draft → audited configuration/approvals → activation → event → frozen completion → deactivation → player HTTP claim/replay", async () => {
    const mission = await configured(), progress = await complete(mission.missionId, playerId);
    expect((await request<{ missions: MissionDto[] }>("GET", "/api/missions/periods", undefined, playerCookie)).missions.find(row => row.missionId === mission.missionId)).toMatchObject({ status: "CLAIMABLE", progress: { current: 1, target: 1 } });
    const key = crypto.randomUUID(), claimPath = `/api/missions/${mission.missionId}/periods/${progress.periodKey}/claim`;
    await lifecycle(mission.missionId, "deactivate");
    const periods = await request<{ missions: MissionDto[] }>("GET", "/api/missions/periods", undefined, playerCookie);
    expect(periods.missions.find(row => row.missionId === mission.missionId)).toMatchObject({ periodKey: progress.periodKey, claimable: true });
    const result = await request<{ awarded: object }>("POST", claimPath, {}, playerCookie, 200, key);
    expect(result.awarded).toEqual({ xp: 7, synapsePoints: 3 });
    expect(await request("POST", claimPath, {}, playerCookie, 200, key)).toMatchObject({ idempotent: true });
    await request("POST", claimPath, {}, playerCookie, 409, crypto.randomUUID());
    const [wallet] = await connection.db.select().from(s.wallets).where(eq(s.wallets.playerId, playerId));
    const [xp] = await connection.db.select().from(s.playerProgression).where(eq(s.playerProgression.playerId, playerId));
    expect(wallet.balance).toBe(3); expect(xp.totalXp).toBe(7);
    for (const table of [s.pointTransactions, s.xpTransactions, s.missionClaims]) expect(await connection.db.select().from(table).where(eq(table.playerId, playerId))).toHaveLength(1);
    expect((await connection.db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.playerMissionProgressId, progress.playerMissionProgressId)))[0]).toMatchObject({ status: "CLAIMED", rewardSnapshot: progress.rewardSnapshot, claimDeadline: progress.claimDeadline });
    expect(await request("GET", "/api/me", undefined, playerCookie)).toMatchObject({ xp: 7, synapsePoints: 3 });
    const history = await request<{ entries: { action: string; actorAdminUserId: string; occurredAt: string }[] }>("GET", `/api/admin/missions/${mission.missionId}/history`);
    expect(history.entries.map(row => row.action)).toEqual(expect.arrayContaining(["DRAFT_CREATED", "RULE_CONFIGURED", "SCHEDULE_CONFIGURED", "REWARDS_CONFIGURED", "APPROVAL_GRANTED", "MISSION_ACTIVATED", "MISSION_DEACTIVATED"]));
    expect(new Set(history.entries.map(row => row.actorAdminUserId)).size).toBe(1);
    expect(history.entries.every(row => row.occurredAt.endsWith("Z"))).toBe(true);
  }, 20000);
  it("HTTP capacity failure is durable; SUPER_ADMIN recovery after unchanged deadline pays once following a ledger-backed synthetic spend", async () => {
    const owner = await account(false);
    // Synthetic initial balance only; recovery never manipulates balances to make a payout fit.
    await connection.db.update(s.wallets).set({ balance: 2147483647 }).where(eq(s.wallets.playerId, owner.id));
    const mission = await configured("EVENT"), progress = await complete(mission.missionId, owner.id);
    const path = `/api/missions/${mission.missionId}/periods/${encodeURIComponent(progress.periodKey)}/claim`, key = crypto.randomUUID();
    const failure = await request<{ code: string; details: { exceptionId: string } }>("POST", path, {}, owner.cookie, 409, key);
    expect(failure.code).toBe("MISSION_CAPACITY_PENDING");
    for (const table of [s.pointTransactions, s.xpTransactions, s.missionClaims]) expect(await connection.db.select().from(table).where(eq(table.playerId, owner.id))).toEqual([]);
    const list = await request<Awaited<ReturnType<ReturnType<AdminMissionService["capacity"]>["list"]>>>("GET", `/api/admin/missions/${mission.missionId}/capacity-exceptions`);
    let row = list.entries[0]; expect(row).toMatchObject({ status: "PENDING", xp: 7, synapsePoints: 3 });
    const recoveryPath = `/api/admin/mission-capacity-exceptions/${row.exceptionId}/recover`;
    const input = () => ({ expectedEventId: row.revision, digest: row.digest, reason: "Explicit synthetic exact reward recovery", idempotencyKey: crypto.randomUUID() });
    await request("POST", recoveryPath, input(), owner.cookie, 403);
    row = await request("POST", recoveryPath, input()); expect(row.status).toBe("PENDING");
    await connection.db.transaction(tx => debitPointsInTransaction(tx, { playerId: owner.id, amount: 10, sourceType: "SYNTHETIC_REHEARSAL", reason: "Synthetic legitimate spend creates headroom", idempotencyKey: crypto.randomUUID() }));
    while (Date.now() <= progress.claimDeadline!.getTime()) await new Promise(resolve => setTimeout(resolve, 30));
    const recovery = input();
    expect(await request("POST", recoveryPath, recovery)).toMatchObject({ status: "RECOVERED" });
    expect(await request("POST", recoveryPath, recovery)).toMatchObject({ status: "RECOVERED", idempotent: true });
    expect(await request("POST", path, {}, owner.cookie, 200, key)).toMatchObject({ idempotent: true, awarded: { xp: 7, synapsePoints: 3 } });
    expect((await connection.db.select().from(s.wallets).where(eq(s.wallets.playerId, owner.id)))[0].balance).toBe(2147483640);
    expect(await connection.db.select().from(s.pointTransactions).where(eq(s.pointTransactions.playerId, owner.id))).toHaveLength(2);
    for (const table of [s.xpTransactions, s.missionClaims]) expect(await connection.db.select().from(table).where(eq(table.playerId, owner.id))).toHaveLength(1);
    const [earned] = await connection.db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.playerMissionProgressId, progress.playerMissionProgressId));
    expect(earned.rewardSnapshot).toEqual(progress.rewardSnapshot); expect(earned.claimDeadline).toEqual(progress.claimDeadline);
    await lifecycle(mission.missionId, "deactivate");
  }, 20000);
});
