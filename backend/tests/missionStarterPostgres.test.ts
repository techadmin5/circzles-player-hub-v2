import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile, readdir, mkdir, mkdtemp, copyFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { and, eq } from "drizzle-orm";
import { createDb, type Database } from "../src/db/client.js";
import * as s from "../src/db/schema.js";
import * as t from "../src/db/missionStarterSchema.js";
import { missionAdminHistory, missionApprovals } from "../src/db/missionAdminSchema.js";
import { localMissionPostgresUrl } from "./helpers/localMissionPostgres.js";
import { AdminMissionService, starterManifestDigest } from "../src/domain/adminMissions.js";
import { starterBatchKey } from "../src/domain/missionStarterManifest.js";
import { DrizzleMissionRepository, DrizzleMissionClaimRepository } from "../src/domain/missions.js";
import { insertGameEventInTransaction } from "../src/domain/gameEvents.js";
import { DrizzleInventoryRepository } from "../src/domain/inventory.js";
import { MissionCapacityService } from "../src/domain/missionCapacityExceptions.js";
import { freezeRewards, periodKeyFor } from "../src/domain/missionLifecycle.js";
import { creditPointsInTransaction, grantXpInTransaction } from "../src/domain/gameState.js";
import type { MissionTracking } from "../src/domain/missionTracking.js";
import { DrizzlePuzzleRepository, PuzzleOwnershipService, developmentPuzzleCatalog } from "../src/domain/puzzles.js";
import { DrizzleSubmissionRepository, SubmissionService } from "../src/domain/submissions.js";
import { DrizzleSubmissionReviewRepository } from "../src/domain/submissionReviews.js";
import { FakeVideoStorage } from "./fakes.js";

// Opt-in only. Never loads dotenv or uses DATABASE_URL / any other suite's target.
const raw = process.env.MISSION_STARTER_TEST_DATABASE_URL;
describe.skipIf(!raw)("fresh local PostgreSQL starter mission integrity", () => {
  let first: ReturnType<typeof createDb>, second: ReturnType<typeof createDb>, actor: string;
  let legacy: Awaited<ReturnType<typeof seedLegacy>>;
  const pids: number[] = [], contention: number[] = [];
  const name = process.env.MISSION_STARTER_TEST_DATABASE_NAME;
  const tracking: MissionTracking = { mode: "EVENT_COUNT", firstEver: false, eligibleMissionIds: [], collectibleId: null };
  const batch = () => ({ batchKey: starterBatchKey, manifestDigest: starterManifestDigest() });
  beforeAll(async () => {
    const url = localMissionPostgresUrl(raw, name, process.env.MISSIONS_POSTGRES_DISPOSABLE);
    first = createDb(url.toString(), () => {}); second = createDb(url.toString(), () => {});
    const connections = await Promise.all([first.pool.connect(), second.pool.connect()]);
    try {
      for (const connection of connections) {
        const id = (await connection.query("SELECT current_database() AS database,current_user AS role,session_user AS session_role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::int AS version,pg_backend_pid() AS pid")).rows[0];
        if (id.database !== name || id.role !== "circzles_test" || id.session_role !== "circzles_test" || id.host !== "127.0.0.1" || id.port !== 5432 || id.version !== 180006) throw new Error("STOP: local starter database identity mismatch before writes");
        pids.push(id.pid);
      }
      expect(new Set(pids).size).toBe(2);
      if ((await connections[0].query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema IN ('public','drizzle')")).rows[0].count !== 0) throw new Error("STOP: starter verification refuses a populated database");
    } finally { connections.forEach(connection => connection.release()); }
    const folder = fileURLToPath(new URL("../drizzle/", import.meta.url));
    const baseline = await mkdtemp(join(tmpdir(), "circzles-starter-baseline-"));
    await mkdir(join(baseline, "meta"));
    const journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    await writeFile(join(baseline, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.filter((entry: { idx: number }) => entry.idx <= 35) }));
    for (const file of await readdir(folder)) if (/^00[0-3][0-9]_.*\.sql$/.test(file) && Number(file.slice(0, 4)) <= 35) await copyFile(join(folder, file), join(baseline, file));
    await migrate(first.db, { migrationsFolder: baseline });
    expect((await first.pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count).toBe(36);
    await first.db.insert(s.progressionLevels).values({ progressionLevel: 1, rankName: "Synthetic", xpRequired: 0, rewards: [] });
    const [user] = await first.db.insert(s.users).values({ verifiedEmail: "starter-pg-admin@test.invalid" }).returning();
    actor = (await first.db.insert(s.adminUsers).values({ userId: user.userId, role: "SUPER_ADMIN" }).returning())[0].adminUserId;
    legacy = await seedLegacy(first.db);
    await migrate(first.db, { migrationsFolder: folder });
  }, 60000);
  afterAll(async () => {
    if (first) console.info("STARTER_LOCAL_EVIDENCE", JSON.stringify({ database: name, pids, observedLockWaiters: contention, version: 180006, journal: (await first.pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count }));
    await first?.pool.end(); await second?.pool.end();
  });

  async function player() {
    const [user] = await first.db.insert(s.users).values({ verifiedEmail: `${crypto.randomUUID()}@test.invalid` }).returning();
    return (await first.db.insert(s.players).values({ userId: user.userId, displayName: "Synthetic starter PostgreSQL" }).returning())[0].playerId;
  }
  async function seedLegacy(db: Database) {
    const id = await player(), now = new Date(), key = periodKeyFor("DAILY", now, "unused");
    const [mission] = await db.insert(s.missions).values({ title: "Start Your Circle", description: "Synthetic existing daily mission", category: "DAILY", periodType: "DAILY", active: true, activationEffectiveAt: new Date(0) }).returning();
    await db.insert(s.missionRules).values({ missionId: mission.missionId, eventType: "puzzle.added", targetCount: 1, conditions: {} });
    await db.insert(s.missionRewards).values([{ missionId: mission.missionId, rewardType: "XP", amount: 50 }, { missionId: mission.missionId, rewardType: "SYNAPSE_POINTS", amount: 100 }]);
    const [earned] = await db.insert(s.playerMissionProgress).values({ playerId: id, missionId: mission.missionId, periodKey: key, currentCount: 1, targetCountSnapshot: 1, status: "CLAIMABLE", completedAt: now, rewardSnapshot: freezeRewards([{ rewardType: "XP", amount: 50 }, { rewardType: "SYNAPSE_POINTS", amount: 100 }]), claimDeadline: new Date(now.getTime() + 86400000) }).returning();
    await db.transaction(async tx => {
      await creditPointsInTransaction(tx, { playerId: id, amount: 250, reason: "Synthetic prior earned SP", sourceType: "SYNTHETIC", sourceId: id, idempotencyKey: "prior-sp", metadata: {} });
      await grantXpInTransaction(tx, { playerId: id, amount: 123, reason: "Synthetic prior earned XP", sourceType: "SYNTHETIC", sourceId: id, idempotencyKey: "prior-xp", metadata: {} });
    });
    return { id, mission, earned, before: await legacyState(db, id, mission.missionId) };
  }
  async function legacyState(db: Database, id: string, missionId: string) {
    return {
      mission: await db.select().from(s.missions).where(eq(s.missions.missionId, missionId)),
      progress: await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.playerId, id)),
      points: await db.select().from(s.pointTransactions).where(eq(s.pointTransactions.playerId, id)),
      xp: await db.select().from(s.xpTransactions).where(eq(s.xpTransactions.playerId, id)),
      wallet: await db.select().from(s.wallets).where(eq(s.wallets.playerId, id)),
      progression: await db.select().from(s.playerProgression).where(eq(s.playerProgression.playerId, id)),
    };
  }
  async function fixture(eventType = "submission.approved", period = "LIFETIME", target = 1, config = tracking, id?: string) {
    const playerId = id ?? await player();
    const [mission] = await first.db.insert(s.missions).values({ title: "Synthetic starter verification", description: "", category: period === "LIFETIME" ? "ACHIEVEMENT" : period, periodType: period, active: true, activationEffectiveAt: new Date(0) }).returning();
    await first.db.insert(s.missionRules).values({ missionId: mission.missionId, eventType, targetCount: target, conditions: eventType === "mission.completed" ? {} : { syntheticMission: mission.missionId } });
    await first.db.insert(s.missionRewards).values([{ missionId: mission.missionId, rewardType: "XP", amount: 2 }, { missionId: mission.missionId, rewardType: "SYNAPSE_POINTS", amount: 3 }]);
    await first.db.insert(t.missionTrackingConfigs).values({ missionId: mission.missionId, ...config });
    return { playerId, mission, eventType };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function append(f: Fixture, at = new Date(), key = crypto.randomUUID()) {
    return first.db.transaction(tx => insertGameEventInTransaction(tx, { playerId: f.playerId, eventType: f.eventType as "submission.approved", sourceType: "SYNTHETIC_STARTER", sourceId: crypto.randomUUID(), payload: { syntheticMission: f.mission.missionId }, idempotencyKey: key }, at));
  }
  async function drain() { await new DrizzleMissionRepository(first.db).processBatch(100); }
  async function earned(f: Fixture) { return (await first.db.select().from(s.playerMissionProgress).where(and(eq(s.playerMissionProgress.missionId, f.mission.missionId), eq(s.playerMissionProgress.playerId, f.playerId))))[0]; }
  const claim = (db: Database, f: Fixture, key = crypto.randomUUID()) => new DrizzleMissionClaimRepository(db).claim({ playerId: f.playerId, missionId: f.mission.missionId, idempotencyKey: key });
  async function contested<T>(query: string, params: unknown[], calls: Array<() => Promise<T>>) {
    const lock = await first.pool.connect(); await lock.query("BEGIN"); await lock.query(query, params);
    const pending = Promise.allSettled(calls.map(call => call()));
    const blockerPid = (await lock.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    let waiters = 0;
    try {
      for (let attempt = 0; attempt < 150; attempt++) {
        waiters = (await first.pool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>$1", [blockerPid])).rows[0].count;
        if (waiters >= calls.length) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      contention.push(waiters);
    } finally { await lock.query("ROLLBACK"); lock.release(); }
    const results = await pending;
    expect(waiters).toBeGreaterThanOrEqual(calls.length);
    return results;
  }

  it("0036 upgrades 0035 without changing existing mission, entitlement, wallets or ledgers", async () => {
    expect((await first.pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count).toBe(37);
    expect(await legacyState(first.db, legacy.id, legacy.mission.missionId)).toEqual(legacy.before);
    const triggers = await first.pool.query("SELECT count(*)::int AS count FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('mission_collectible_frozen','mission_collectible_no_truncate','mission_contributions_immutable','mission_contributions_no_truncate','mission_batch_items_immutable','mission_batch_items_no_truncate') AND tgenabled='O'");
    expect(triggers.rows[0].count).toBe(6);
  });
  it("simultaneous batch submissions serialize to the same 14 inactive IDs with zero approvals/grants", async () => {
    const results = await contested("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [starterBatchKey], [() => new AdminMissionService(first.db).createStarterBatch(batch(), actor), () => new AdminMissionService(second.db).createStarterBatch(batch(), actor)]);
    expect(results.every(row => row.status === "fulfilled")).toBe(true);
    const a = results[0].status === "fulfilled" ? results[0].value : null, b = results[1].status === "fulfilled" ? results[1].value : null;
    expect(a!.missions.map(row => row.missionId)).toEqual(b!.missions.map(row => row.missionId));
    expect([a,b].flatMap(row => row!.missions).filter(row => row.created)).toHaveLength(14);
    expect(a!.allInactive && b!.allInactive).toBe(true);
    expect(await first.db.select().from(missionApprovals)).toEqual([]);
    expect(await first.db.select().from(s.inventoryGrants)).toEqual([]);
    expect(await legacyState(first.db, legacy.id, legacy.mission.missionId)).toEqual(legacy.before);
    const auditCount = (await first.db.select().from(missionAdminHistory)).length;
    await new AdminMissionService(first.db).createStarterBatch(batch(), actor);
    expect((await first.db.select().from(missionAdminHistory)).length).toBe(auditCount);
    for (const row of a!.missions) {
      const report = await new AdminMissionService(first.db).readiness(row.missionId);
      expect(report.activationReady).toBe(false);
      expect(report.checks.filter(check => check.status === "BLOCKED" && check.category !== "PRODUCT").map(check => check.code)).toEqual(row.key === "circle-explorer" ? ["RULE_M1_VALID", "RULE_EVENT_SUPPORTED", "TRACKING_VALID"] : row.key.startsWith("first-") || row.key === "puzzle-milestone" ? ["REWARDS_VALID"] : []);
    }
  });
  it("parallel authenticated check-ins persist one server-UTC event, not a claim or reward", async () => {
    const id = await player();
    const results = await contested("LOCK TABLE game_events IN SHARE MODE", [], [() => new DrizzleMissionRepository(first.db).checkIn(id), () => new DrizzleMissionRepository(second.db).checkIn(id)]);
    expect(results.every(row => row.status === "fulfilled")).toBe(true);
    expect(results.filter(row => row.status === "fulfilled" && row.value.idempotent)).toHaveLength(1);
    const events = await first.db.select().from(s.gameEvents).where(eq(s.gameEvents.playerId, id)); expect(events).toHaveLength(1);
    expect(events[0].payload.utcDate).toBe(events[0].createdAt.toISOString().slice(0,10));
    expect(await first.db.select().from(s.missionClaims).where(eq(s.missionClaims.playerId, id))).toEqual([]);
  });
  it("two real workers count three distinct UTC dates once and reset at ISO Monday", async () => {
    const f = await fixture("reward_wheel.spun", "WEEKLY", 3, { ...tracking, mode: "DISTINCT_UTC_DAYS" });
    for (const date of ["2026-10-26T12:00Z", "2026-10-26T14:00Z", "2026-10-27T00:00Z", "2026-11-01T23:59:59Z", "2026-11-02T00:00Z"]) await append(f, new Date(date));
    const results = await contested("SELECT pg_advisory_xact_lock(hashtextextended('mission-processor',0))", [], [() => new DrizzleMissionRepository(first.db).processBatch(100), () => new DrizzleMissionRepository(second.db).processBatch(100)]);
    expect(results.every(row => row.status === "fulfilled")).toBe(true);
    const periods = await first.db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.missionId, f.mission.missionId));
    expect(periods.map(row => [row.periodKey,row.currentCount]).sort()).toEqual([["2026-W44",3],["2026-W45",1]]);
    expect(await first.db.select().from(t.missionEventContributions).where(eq(t.missionEventContributions.missionId,f.mission.missionId))).toHaveLength(4);
  });
  it("distinct mission aggregation counts definitions rather than retries/days under concurrent workers", async () => {
    const id = await player(), a = await fixture("submission.created","DAILY",1,tracking,id), b = await fixture("personal_best.improved","DAILY",1,tracking,id);
    const aggregate = await fixture("mission.completed","WEEKLY",2,{ ...tracking, mode:"DISTINCT_MISSIONS",eligibleMissionIds:[a.mission.missionId,b.mission.missionId] },id);
    await append(a,new Date("2026-11-02T12:00Z")); await append(a,new Date("2026-11-03T12:00Z"));
    await Promise.all([new DrizzleMissionRepository(first.db).processBatch(100), new DrizzleMissionRepository(second.db).processBatch(100)]);
    expect((await earned(aggregate)).currentCount).toBe(1);
    await append(b,new Date("2026-11-03T13:00Z")); await drain(); expect((await earned(aggregate)).status).toBe("CLAIMABLE");
    expect(await first.db.select().from(t.missionEventContributions).where(eq(t.missionEventContributions.missionId,aggregate.mission.missionId))).toHaveLength(2);
  });
  it.each(["submission.created","submission.approved"])("first-ever %s excludes pre-cutoff events and never backfills", async eventType => {
    const f = await fixture(eventType,"LIFETIME",1,{...tracking,firstEver:true});
    await first.db.update(s.missions).set({activationEffectiveAt:new Date("2026-11-01Z")}).where(eq(s.missions.missionId,f.mission.missionId));
    await append(f,new Date("2026-10-31T23:59Z")); await append(f,new Date("2026-11-02T12:00Z")); await drain(); expect(await earned(f)).toBeUndefined();
  });
  it("genuine first submission and first official approval earn separate lifetime entitlements once", async () => {
    const id=await player(),[badge]=await first.db.select().from(s.rewardDefinitions).where(eq(s.rewardDefinitions.code,"mission-puzzle-solver"));
    const submitted=await fixture("submission.created","LIFETIME",1,{...tracking,firstEver:true},id),approved=await fixture("submission.approved","LIFETIME",1,{...tracking,firstEver:true,collectibleId:badge.rewardDefinitionId},id);
    for(const f of [submitted,approved])await first.db.update(s.missionRules).set({conditions:{}}).where(eq(s.missionRules.missionId,f.mission.missionId));
    const ownership=new PuzzleOwnershipService(new DrizzlePuzzleRepository(first.db));
    await ownership.seedDevelopmentCatalog([{...developmentPuzzleCatalog[0],levelId:1}]);
    const owned=(await ownership.claimByCode(id,"DEV-MM-R1-0001")).puzzle;
    await first.db.insert(s.puzzleCompetitionSettings).values({puzzleId:owned.id,category:"MAIN_LEVEL",displayOrder:0,maxLeaderboardTimeMs:300000,rewardEnabled:false});
    const storage=new FakeVideoStorage(),submissions=new SubmissionService(new DrizzleSubmissionRepository(first.db,storage),storage);
    const upload=await submissions.signVideoUpload(id,{filename:"synthetic.mp4",mimeType:"video/mp4",sizeBytes:1024});await submissions.completeVideoUpload(id,upload.videoUploadId);
    const request={playerPuzzleId:owned.playerPuzzleId,videoUploadId:upload.videoUploadId,completionTimeMs:120000},submission=await submissions.createSubmission(id,request,"first-submission");
    await submissions.createSubmission(id,request,"first-submission");await drain();
    expect((await earned(submitted)).status).toBe("CLAIMABLE");expect(await earned(approved)).toBeUndefined();
    const reviews=new DrizzleSubmissionReviewRepository(second.db,storage),review={submissionId:submission.id,reviewerAdminUserId:actor,decision:"APPROVED" as const,reviewNote:"Synthetic official approval",idempotencyKey:"first-approval"};
    await reviews.review(review);await reviews.review(review);await drain();
    expect((await earned(approved)).status).toBe("CLAIMABLE");expect((await earned(submitted)).periodKey).toBe("lifetime");
    await claim(first.db,approved);
    expect(await first.db.select().from(s.inventoryGrants).where(eq(s.inventoryGrants.playerId,id))).toHaveLength(1);
    expect((await first.db.select().from(s.wallets).where(eq(s.wallets.playerId,id)))[0].balance).toBe(3);
  });
  it.each(["BADGE","FRAME"] as const)("concurrent same-key %s claims grant frozen inventory and XP/SP exactly once", async rewardType => {
    const [asset] = await first.db.insert(s.rewardDefinitions).values({code:crypto.randomUUID(),name:"Synthetic starter collectible",description:"",rewardType}).returning();
    const f = await fixture("submission.approved","LIFETIME",1,{...tracking,collectibleId:asset.rewardDefinitionId}); await append(f); await drain(); const progress = await earned(f);
    await first.db.update(t.missionTrackingConfigs).set({collectibleId:null}).where(eq(t.missionTrackingConfigs.missionId,f.mission.missionId));
    const key=crypto.randomUUID(), results=await contested("SELECT player_mission_progress_id FROM player_mission_progress WHERE player_mission_progress_id=$1 FOR UPDATE",[progress.playerMissionProgressId],[()=>claim(first.db,f,key),()=>claim(second.db,f,key)]);
    expect(results.every(row=>row.status==="fulfilled")).toBe(true);
    expect(results.filter(row=>row.status==="fulfilled"&&row.value.idempotent)).toHaveLength(1);
    expect(await first.db.select().from(s.inventoryGrants).where(eq(s.inventoryGrants.playerId,f.playerId))).toHaveLength(1);
    expect(await first.db.select().from(s.pointTransactions).where(eq(s.pointTransactions.playerId,f.playerId))).toHaveLength(1);
    expect(await first.db.select().from(s.xpTransactions).where(eq(s.xpTransactions.playerId,f.playerId))).toHaveLength(1);
    const item=(await first.db.select().from(s.playerInventoryItems).where(eq(s.playerInventoryItems.playerId,f.playerId)))[0]; expect(item.quantity).toBe(1);
    const inventory=new DrizzleInventoryRepository(second.db), slot=rewardType==="FRAME"?"FRAME":"BADGE_1";
    const equipped=await inventory.equip(f.playerId,item.playerInventoryItemId,slot); expect(equipped.equipment[slot]).toBe(item.playerInventoryItemId);
    await expect(inventory.equip(f.playerId,item.playerInventoryItemId,rewardType==="FRAME"?"BADGE_1":"FRAME")).rejects.toMatchObject({code:"EQUIPMENT_SLOT_INCOMPATIBLE"});
    await expect(inventory.equip(await player(),item.playerInventoryItemId,slot)).rejects.toMatchObject({code:"INVENTORY_ITEM_NOT_FOUND"});
    await inventory.unequip(f.playerId,slot); expect((await inventory.list(f.playerId)).items[0].quantity).toBe(1);
  });
  it("different claim keys cannot double-grant XP/SP or collectibles", async () => {
    const [asset]=await first.db.insert(s.rewardDefinitions).values({code:crypto.randomUUID(),name:"Synthetic badge",description:"",rewardType:"BADGE"}).returning();
    const f=await fixture("submission.approved","LIFETIME",1,{...tracking,collectibleId:asset.rewardDefinitionId}); await append(f); await drain();
    const results=await contested("SELECT player_mission_progress_id FROM player_mission_progress WHERE player_mission_progress_id=$1 FOR UPDATE",[(await earned(f)).playerMissionProgressId],[()=>claim(first.db,f),()=>claim(second.db,f)]);
    expect(results.filter(row=>row.status==="fulfilled")).toHaveLength(1); expect(await first.db.select().from(s.missionClaims).where(eq(s.missionClaims.playerId,f.playerId))).toHaveLength(1);
    expect(await first.db.select().from(s.inventoryGrants).where(eq(s.inventoryGrants.playerId,f.playerId))).toHaveLength(1);
  });
  it("two entitlements for the same badge preserve unique ownership without dropping earned XP/SP", async () => {
    const id=await player(),[asset]=await first.db.insert(s.rewardDefinitions).values({code:crypto.randomUUID(),name:"Synthetic shared badge",description:"",rewardType:"BADGE"}).returning();
    const a=await fixture("submission.approved","LIFETIME",1,{...tracking,collectibleId:asset.rewardDefinitionId},id),b=await fixture("submission.approved","LIFETIME",1,{...tracking,collectibleId:asset.rewardDefinitionId},id);
    await append(a);await append(b);await drain();
    await Promise.all([claim(first.db,a),claim(second.db,b)]);
    expect(await first.db.select().from(s.inventoryGrants).where(eq(s.inventoryGrants.playerId,id))).toHaveLength(1);
    expect(await first.db.select().from(s.missionClaims).where(eq(s.missionClaims.playerId,id))).toHaveLength(2);
    expect((await first.db.select().from(s.wallets).where(eq(s.wallets.playerId,id)))[0].balance).toBe(6);
    expect((await first.db.select().from(s.playerProgression).where(eq(s.playerProgression.playerId,id)))[0].totalXp).toBe(4);
  });
  it("collectible failure rolls back currency, claim and delivery atomically", async () => {
    const [asset]=await first.db.insert(s.rewardDefinitions).values({code:crypto.randomUUID(),name:"Synthetic fault badge",description:"",rewardType:"BADGE"}).returning();
    const f=await fixture("submission.approved","LIFETIME",1,{...tracking,collectibleId:asset.rewardDefinitionId});await append(f);await drain();
    await first.pool.query("CREATE FUNCTION starter_test_delivery_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic delivery failure'; END $$; CREATE TRIGGER starter_test_delivery_failure BEFORE INSERT ON inventory_grants FOR EACH ROW EXECUTE FUNCTION starter_test_delivery_failure()");
    try { await expect(claim(first.db,f)).rejects.toThrow(); } finally { await first.pool.query("DROP TRIGGER starter_test_delivery_failure ON inventory_grants; DROP FUNCTION starter_test_delivery_failure()"); }
    expect(await first.db.select().from(s.missionClaims).where(eq(s.missionClaims.playerId,f.playerId))).toEqual([]);
    expect(await first.db.select().from(s.pointTransactions).where(eq(s.pointTransactions.playerId,f.playerId))).toEqual([]);
    expect(await first.db.select().from(s.xpTransactions).where(eq(s.xpTransactions.playerId,f.playerId))).toEqual([]);
    expect((await earned(f)).status).toBe("CLAIMABLE"); expect((await claim(second.db,f)).awarded).toEqual({xp:2,synapsePoints:3});
  });
  it("capacity failure preserves the collectible and concurrent authorized recovery grants it once", async () => {
    const [asset]=await first.db.insert(s.rewardDefinitions).values({code:crypto.randomUUID(),name:"Synthetic recovery frame",description:"",rewardType:"FRAME"}).returning();
    const f=await fixture("submission.approved","LIFETIME",1,{...tracking,collectibleId:asset.rewardDefinitionId});await append(f);await drain();
    await first.db.insert(s.wallets).values({playerId:f.playerId,balance:2147483647});
    await expect(claim(first.db,f)).rejects.toMatchObject({code:"MISSION_CAPACITY_PENDING"});
    expect(await first.db.select().from(s.inventoryGrants).where(eq(s.inventoryGrants.playerId,f.playerId))).toEqual([]);
    const capacity=new MissionCapacityService(first.db),page=await capacity.list(f.mission.missionId,actor,25,0),head=page.entries[0];
    // Synthetic fixture capacity is restored explicitly; no application balance-mutation endpoint.
    await first.db.update(s.wallets).set({balance:0}).where(eq(s.wallets.playerId,f.playerId));
    const request={expectedEventId:head.revision,digest:head.digest,reason:"Synthetic explicit recovery verification",idempotencyKey:crypto.randomUUID()};
    const results=await contested("SELECT player_mission_progress_id FROM player_mission_progress WHERE player_mission_progress_id=$1 FOR UPDATE",[(await earned(f)).playerMissionProgressId],[()=>capacity.recover(head.exceptionId,request,actor),()=>new MissionCapacityService(second.db).recover(head.exceptionId,request,actor)]);
    expect(results.every(row=>row.status==="fulfilled")).toBe(true);
    expect(await first.db.select().from(s.inventoryGrants).where(eq(s.inventoryGrants.playerId,f.playerId))).toHaveLength(1);
    expect(await first.db.select().from(s.missionClaims).where(eq(s.missionClaims.playerId,f.playerId))).toHaveLength(1);
  });
  it("new collectible and contribution snapshots retain database immutability", async () => {
    await expect(first.pool.query("DELETE FROM mission_event_contributions")).rejects.toThrow(/append-only/);
    await expect(first.pool.query("UPDATE mission_earned_collectibles SET disposition='PENDING'")).rejects.toThrow(/immutable/);
    await expect(first.pool.query("TRUNCATE mission_starter_batch_items")).rejects.toThrow(/append-only/);
  });
  it("Start Your Circle retains the original 50 XP/100 SP snapshot and prior earned ledger entries", async () => {
    expect(await legacyState(first.db,legacy.id,legacy.mission.missionId)).toEqual(legacy.before);
    const input={playerId:legacy.id,missionId:legacy.mission.missionId,periodKey:legacy.earned.periodKey,idempotencyKey:crypto.randomUUID()};
    const result=await new DrizzleMissionClaimRepository(second.db).claim(input); expect(result.awarded).toEqual({xp:50,synapsePoints:100});
    expect((await new DrizzleMissionClaimRepository(first.db).claim(input)).idempotent).toBe(true);
    const after=await legacyState(first.db,legacy.id,legacy.mission.missionId);
    expect(after.points).toContainEqual(legacy.before.points[0]);expect(after.xp).toContainEqual(legacy.before.xp[0]);
    expect(after.wallet[0].balance).toBe(350);expect(after.progression[0].totalXp).toBe(173);
    expect(after.mission).toEqual(legacy.before.mission);
  });
});
