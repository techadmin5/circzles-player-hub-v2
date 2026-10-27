import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile, readdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema.js";
import * as c from "../src/db/missionChestSchema.js";
import type { Database } from "../src/db/client.js";
import { DrizzleMissionClaimRepository, DrizzleMissionRepository, validateMissionDefinition, validateMissionRule } from "../src/domain/missions.js";
import { MissionChestService, validateChestEligibility } from "../src/domain/missionChests.js";
import { claimDeadlineFor, freezeRewards, periodBounds } from "../src/domain/missionLifecycle.js";
import { DrizzleGameStateRepository, grantXpInTransaction } from "../src/domain/gameState.js";

let pg: PGlite, db: Database, playerId: string, engine: DrizzleMissionRepository, claims: DrizzleMissionClaimRepository, chests: MissionChestService;
const date = (value: string) => new Date(value);
const origin = date("2025-01-01T00:00:00Z");
const reward = freezeRewards([{ rewardType: "XP", amount: 20 }, { rewardType: "SYNAPSE_POINTS", amount: 25 }]);
beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql")).sort()) await pg.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  db = drizzle(pg, { schema: s }) as unknown as Database;
  await new DrizzleGameStateRepository(db).seedProgressionLevels([{ progressionLevel: 1, rankName: "Test", xpRequired: 0, rewards: [] }, { progressionLevel: 2, rankName: "Next", xpRequired: 10, rewards: [] }]);
  engine = new DrizzleMissionRepository(db); claims = new DrizzleMissionClaimRepository(db); chests = new MissionChestService(db);
}, 60_000);
afterAll(async () => { await pg.close(); });
beforeEach(async () => {
  // All writes in this file target only the disposable PGlite fixture.
  await db.update(s.missions).set({ active: false }); await db.update(c.missionChests).set({ active: false });
  await db.update(s.gameEvents).set({ processedAt: new Date() });
  const [user] = await db.insert(s.users).values({ verifiedEmail: `${crypto.randomUUID()}@test.invalid`, emailVerifiedAt: new Date() }).returning();
  [ { playerId } ] = await db.insert(s.players).values({ userId: user.userId, displayName: "Mission test" }).returning();
});
async function mission(periodType: "DAILY" | "WEEKLY" | "LIFETIME" | "FIXED" = "DAILY", targetCount = 1) {
  const [definition] = await db.insert(s.missions).values({ title: "Test", description: "Test", periodType, category: periodType === "LIFETIME" ? "ACHIEVEMENT" : periodType === "FIXED" ? "EVENT" : periodType, activationEffectiveAt: origin, ...(periodType === "FIXED" ? { startsAt: date("2026-01-01Z"), endsAt: date("2026-02-01Z") } : {}) }).returning();
  await db.insert(s.missionRules).values({ missionId: definition.missionId, eventType: "puzzle.added", targetCount, conditions: { testMission: definition.missionId } });
  await db.insert(s.missionRewards).values(reward.rewards.map(row => ({ missionId: definition.missionId, rewardType: row.type, amount: row.amount })));
  return definition;
}
async function event(m: typeof s.missions.$inferSelect, at = "2026-01-01T12:00:00Z") {
  const [row] = await db.insert(s.gameEvents).values({ playerId, eventType: "puzzle.added", sourceType: "PUZZLE_CLAIM", sourceId: crypto.randomUUID(), payload: { testMission: m.missionId }, idempotencyKey: crypto.randomUUID(), createdAt: date(at) }).returning();
  return row;
}
async function complete(m: typeof s.missions.$inferSelect, at?: string) { await event(m, at); await engine.processBatch(100); return (await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.missionId, m.missionId)))[0]; }
async function chest(type: "DAILY" | "WEEKLY", definitions: Array<typeof s.missions.$inferSelect>, target: number) {
  const [definition] = await db.insert(c.missionChests).values({ title: "Test chest", periodType: type, targetCount: target, active: true, activationEffectiveAt: origin, rewards: reward }).returning();
  await db.insert(c.missionChestEligibility).values(definitions.map(m => ({ chestId: definition.chestId, missionId: m.missionId, active: true, effectiveAt: origin })));
  return definition;
}
const claim = (missionId: string, periodKey: string, now = "2026-01-02T12:00:00Z", key: string = crypto.randomUUID()) => claims.claim({ playerId, missionId, periodKey, now: date(now), idempotencyKey: key });
const chestClaim = (chestId: string, periodKey: string, now = "2026-01-02T12:00:00Z", key: string = crypto.randomUUID()) => chests.claim({ playerId, chestId, periodKey, now: date(now), idempotencyKey: key });

describe("database-backed UTC mission lifecycle", () => {
  it.each([
    ["DAILY", "2026-01-01T23:59:59.999Z", "2026-01-01"], ["DAILY", "2026-01-02T00:00:00Z", "2026-01-02"],
    ["WEEKLY", "2026-01-04T23:59:59.999Z", "2026-W01"], ["WEEKLY", "2026-01-05T00:00:00Z", "2026-W02"],
    ["WEEKLY", "2027-01-01T00:00:00Z", "2026-W53"], ["WEEKLY", "2027-01-04T00:00:00Z", "2027-W01"],
  ] as const)("attributes delayed %s event at %s to %s", async (type, timestamp, key) => {
    const m = await mission(type); const progress = await complete(m, timestamp);
    expect(progress.periodKey).toBe(key); const bounds = periodBounds(type, key, m.missionId);
    expect(progress.periodStartsAt).toEqual(bounds.start); expect(progress.periodEndsAt).toEqual(bounds.end);
    expect(progress.claimDeadline).toEqual(claimDeadlineFor(type, bounds.end, null));
  });
  it("lists and claims previous and current periods independently within grace", async () => {
    const m = await mission(); await complete(m); await complete(m, "2026-01-02T01:00:00Z");
    expect((await engine.listPeriods(playerId, date("2026-01-02T12:00:00Z"))).map(row => row.periodKey).sort()).toEqual(["2026-01-01", "2026-01-02"]);
    expect((await claim(m.missionId, "2026-01-01")).awarded).toEqual({ xp: 20, synapsePoints: 25 });
    expect((await claim(m.missionId, "2026-01-02")).awarded).toEqual({ xp: 20, synapsePoints: 25 });
  });
  it("expires exactly at grace deadline without granting ledgers", async () => {
    const m = await mission(); await complete(m);
    await expect(claim(m.missionId, "2026-01-01", "2026-01-03T00:00:00Z")).rejects.toMatchObject({ code: "MISSION_CLAIM_EXPIRED", statusCode: 410 });
    expect((await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.missionId, m.missionId)))[0].expiredAt).toEqual(date("2026-01-03Z"));
    expect(await db.select().from(s.pointTransactions).where(eq(s.pointTransactions.playerId, playerId))).toHaveLength(0);
  });
  it("freezes rewards and deadlines, including database update protection", async () => {
    const m = await mission(); const progress = await complete(m);
    await db.update(s.missionRewards).set({ amount: 999 }).where(eq(s.missionRewards.missionId, m.missionId));
    expect((await claim(m.missionId, progress.periodKey)).awarded).toEqual({ xp: 20, synapsePoints: 25 });
    await expect(db.update(s.playerMissionProgress).set({ rewardSnapshot: freezeRewards([{ rewardType: "XP", amount: 999 }]) }).where(eq(s.playerMissionProgress.playerMissionProgressId, progress.playerMissionProgressId))).rejects.toThrow();
  });
  it("retries replay and concurrent fresh keys cannot create a second reward", async () => {
    const m = await mission(); await complete(m); const key = crypto.randomUUID();
    const result = await Promise.allSettled([claim(m.missionId, "2026-01-01", undefined, key), claim(m.missionId, "2026-01-01")]);
    expect(result.filter(row => row.status === "fulfilled")).toHaveLength(1);
    const successful = result.find(row => row.status === "fulfilled")!;
    if (successful.status === "fulfilled") {
      const stored = (await db.select().from(s.missionClaims).where(eq(s.missionClaims.playerId, playerId)))[0];
      expect((await claim(m.missionId, "2026-01-01", "2026-01-05Z", stored.idempotencyKey)).idempotent).toBe(true);
    }
    expect(await db.select().from(s.xpTransactions).where(eq(s.xpTransactions.playerId, playerId))).toHaveLength(1);
    expect(await db.select().from(s.pointTransactions).where(eq(s.pointTransactions.playerId, playerId))).toHaveLength(1);
    await expect(claim(m.missionId, "2026-01-02", undefined, key)).rejects.toThrow();
  });
  it("lifetime and fixed earned rewards invent no deadline; fixed explicit deadline freezes", async () => {
    const lifetime = await mission("LIFETIME"), fixed = await mission("FIXED"); await complete(lifetime); const progress = await complete(fixed);
    expect(progress.claimDeadline).toBeNull(); expect((await claim(fixed.missionId, progress.periodKey, "2028-01-01Z")).awarded.xp).toBe(20);
    expect((await claim(lifetime.missionId, "lifetime", "2028-01-01Z")).awarded.xp).toBe(20);
    const timed = await mission("FIXED"); await db.update(s.missions).set({ claimDeadline: date("2026-02-02Z") }).where(eq(s.missions.missionId, timed.missionId)); await complete(timed);
    await expect(claim(timed.missionId, `fixed:${timed.missionId}`, "2026-02-02Z")).rejects.toMatchObject({ code: "MISSION_CLAIM_EXPIRED" });
  });
  it("does not fabricate snapshots for legacy completed rows", async () => {
    const m = await mission(); await db.insert(s.playerMissionProgress).values({ playerId, missionId: m.missionId, periodKey: "2026-01-01", targetCountSnapshot: 1, currentCount: 1, status: "CLAIMABLE" });
    await expect(claim(m.missionId, "2026-01-01")).rejects.toThrow(/snapshot/);
  });
});

describe("database-backed mission chests", () => {
  it.each([["DAILY", 5, 3], ["WEEKLY", 6, 4]] as const)("unlocks %s from any %s available / %s distinct completed missions", async (type, available, target) => {
    const definitions = await Promise.all(Array.from({ length: available }, () => mission(type))); const box = await chest(type, definitions, target);
    for (const m of definitions.slice(1, target + 1)) { await complete(m); await event(m); } await engine.processBatch(100);
    const state = (await db.select().from(c.playerMissionChests).where(eq(c.playerMissionChests.chestId, box.chestId)))[0];
    expect(state.currentCount).toBe(target); expect(state.unlockedAt).not.toBeNull();
    expect(await db.select().from(c.missionChestCompletions).where(eq(c.missionChestCompletions.playerChestId, state.playerChestId))).toHaveLength(target);
    expect(await db.select().from(s.pointTransactions).where(eq(s.pointTransactions.playerId, playerId))).toHaveLength(0);
    for (const m of definitions.slice(1, target + 1)) await claim(m.missionId, state.periodKey);
    await engine.processBatch(100);
    expect((await db.select().from(c.playerMissionChests).where(eq(c.playerMissionChests.playerChestId, state.playerChestId)))[0].currentCount).toBe(target);
  });
  it("excludes inactive, unrelated and pre-effective completions", async () => {
    const a = await mission(), b = await mission(), unrelated = await mission(); const box = await chest("DAILY", [a, b], 1);
    await db.update(c.missionChestEligibility).set({ effectiveAt: date("2026-01-02Z") }).where(eq(c.missionChestEligibility.missionId, a.missionId));
    await db.update(s.missions).set({ active: false }).where(eq(s.missions.missionId, b.missionId));
    await complete(a); await complete(b); await complete(unrelated);
    expect(await db.select().from(c.playerMissionChests).where(eq(c.playerMissionChests.chestId, box.chestId))).toHaveLength(0);
  });
  it.each([["DAILY", "2026-01-02T01:00:00Z"], ["WEEKLY", "2026-01-05T01:00:00Z"]] as const)("does not mix %s periods or cross daily/weekly associations", async (type, nextPeriod) => {
    const a = await mission(type), b = await mission(type); const box = await chest(type, [a, b], 2);
    await complete(a); await complete(b, nextPeriod);
    const states = await db.select().from(c.playerMissionChests).where(eq(c.playerMissionChests.chestId, box.chestId)); expect(states).toHaveLength(2); expect(states.every(row => row.currentCount === 1 && !row.unlockedAt)).toBe(true);
    const weekly = await mission("WEEKLY"); const invalid = await chest("DAILY", [weekly], 1);
    await expect(db.transaction(tx => validateChestEligibility(tx, invalid))).rejects.toThrow();
  });
  it("weekly mission and chest rewards remain claimable after Monday rollover until Tuesday UTC", async () => {
    const m = await mission("WEEKLY"); const box = await chest("WEEKLY", [m], 1); await complete(m);
    expect((await engine.listPeriods(playerId, date("2026-01-05T23:59:59Z"))).some(row => row.periodKey === "2026-W01" && row.claimable)).toBe(true);
    expect((await chests.list(playerId, date("2026-01-05T23:59:59Z"))).some(row => row.periodKey === "2026-W01" && row.claimable)).toBe(true);
    expect((await claim(m.missionId, "2026-W01", "2026-01-05T23:59:59Z")).awarded.xp).toBe(20);
    await expect(chestClaim(box.chestId, "2026-W01", "2026-01-06T00:00:00Z")).rejects.toMatchObject({ code: "CHEST_CLAIM_EXPIRED" });
  });
  it("freezes chest rewards, claims once with concurrent requests, and survives retry after expiry", async () => {
    const m = await mission(); const box = await chest("DAILY", [m], 1); await complete(m);
    await db.update(c.missionChests).set({ rewards: freezeRewards([{ rewardType: "XP", amount: 999 }]) }).where(eq(c.missionChests.chestId, box.chestId));
    const outcomes = await Promise.allSettled([chestClaim(box.chestId, "2026-01-01"), chestClaim(box.chestId, "2026-01-01")]); expect(outcomes.filter(row => row.status === "fulfilled")).toHaveLength(1);
    const stored = (await db.select().from(c.missionChestClaims).where(eq(c.missionChestClaims.playerId, playerId)))[0];
    const replay = await chestClaim(box.chestId, "2026-01-01", "2028-01-01Z", stored.idempotencyKey); expect(replay.idempotent).toBe(true); expect(replay.awarded).toEqual({ xp: 20, synapsePoints: 25 });
    expect(await db.select().from(s.pointTransactions).where(eq(s.pointTransactions.playerId, playerId))).toHaveLength(1); expect(await db.select().from(s.xpTransactions).where(eq(s.xpTransactions.playerId, playerId))).toHaveLength(1);
    await expect(chestClaim(box.chestId, "2026-01-02", undefined, stored.idempotencyKey)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("lists prior unlocked chest in grace and expires it exactly at deadline", async () => {
    const m = await mission(); const box = await chest("DAILY", [m], 1); await complete(m);
    expect((await chests.list(playerId, date("2026-01-02T12:00:00Z"))).map(row => row.periodKey).sort()).toEqual(["2026-01-01", "2026-01-02"]);
    await expect(chestClaim(box.chestId, "2026-01-01", "2026-01-03Z")).rejects.toMatchObject({ code: "CHEST_CLAIM_EXPIRED" });
    expect((await db.select().from(c.playerMissionChests).where(eq(c.playerMissionChests.chestId, box.chestId)))[0].expiredAt).toEqual(date("2026-01-03Z"));
  });
  it("keeps chest completion provenance immutable and prevents duplicate associations", async () => {
    const m = await mission(); const box = await chest("DAILY", [m], 1); const progress = await complete(m);
    const [state] = await db.select().from(c.playerMissionChests).where(eq(c.playerMissionChests.chestId, box.chestId));
    const [provenance] = await db.select().from(c.missionChestCompletions).where(eq(c.missionChestCompletions.playerChestId, state.playerChestId)); expect(provenance.playerMissionProgressId).toBe(progress.playerMissionProgressId); expect(provenance.completedAt).toEqual(progress.completedAt);
    await expect(db.insert(c.missionChestEligibility).values({ chestId: box.chestId, missionId: m.missionId })).rejects.toThrow();
    await expect(db.update(c.playerMissionChests).set({ claimDeadline: date("2030-01-01Z") }).where(eq(c.playerMissionChests.playerChestId, state.playerChestId))).rejects.toThrow();
    await expect(db.update(c.missionChestCompletions).set({ completedAt: date("2030-01-01Z") }).where(eq(c.missionChestCompletions.completionId, provenance.completionId))).rejects.toThrow();
  });
});

describe("database-backed processor reliability", () => {
  it("isolates invalid configuration and records a visible failure while healthy missions advance", async () => {
    const bad = await mission(), good = await mission(); await db.update(s.missionRules).set({ conditions: { nested: {} } as never }).where(eq(s.missionRules.missionId, bad.missionId));
    await event(bad); await event(good); await engine.processBatch(100);
    expect(await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.missionId, good.missionId))).toHaveLength(1);
    expect(await db.select().from(c.missionProcessingFailures).where(eq(c.missionProcessingFailures.entityId, bad.missionId))).not.toHaveLength(0);
  });
  it("persists bounded retry/quarantine across restart and proceeds past poison events", async () => {
    const bad = await mission(), good = await mission(); const poison = await event(bad);
    await pg.exec(`CREATE FUNCTION test_poison() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.mission_id = '${bad.missionId}' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_poison BEFORE INSERT ON player_mission_progress FOR EACH ROW EXECUTE FUNCTION test_poison();`);
    try {
      for (let i = 0; i < 5; i++) {
        await expect(new DrizzleMissionRepository(db).processBatch(100)).rejects.toMatchObject({ code: "MISSION_PROCESSOR_RETRY" });
        expect((await db.select().from(c.missionEventAttempts).where(eq(c.missionEventAttempts.gameEventId, poison.gameEventId)))[0].nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
        await db.update(c.missionEventAttempts).set({ nextAttemptAt: origin }).where(eq(c.missionEventAttempts.gameEventId, poison.gameEventId));
      }
      const [attempt] = await db.select().from(c.missionEventAttempts).where(eq(c.missionEventAttempts.gameEventId, poison.gameEventId)); expect(attempt.attempts).toBe(5); expect(attempt.quarantinedAt).not.toBeNull();
      await event(good); await new DrizzleMissionRepository(db).processBatch(100);
      expect(await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.missionId, good.missionId))).toHaveLength(1);
      expect((await db.select().from(s.gameEvents).where(eq(s.gameEvents.gameEventId, poison.gameEventId)))[0].processedAt).toBeNull();
    } finally { await pg.exec("DROP TRIGGER test_poison ON player_mission_progress; DROP FUNCTION test_poison();"); }
  });
  it("recovers from a temporary failure after restart without duplicate increments", async () => {
    const m = await mission(); const source = await event(m);
    await pg.exec("CREATE FUNCTION test_temporary_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'temporary test'; END $$; CREATE TRIGGER test_temporary_fail BEFORE INSERT ON player_mission_progress FOR EACH ROW EXECUTE FUNCTION test_temporary_fail();");
    try { await expect(engine.processBatch(10)).rejects.toMatchObject({ code: "MISSION_PROCESSOR_RETRY" }); }
    finally { await pg.exec("DROP TRIGGER test_temporary_fail ON player_mission_progress; DROP FUNCTION test_temporary_fail();"); }
    await db.update(c.missionEventAttempts).set({ nextAttemptAt: origin }).where(eq(c.missionEventAttempts.gameEventId, source.gameEventId));
    await new DrizzleMissionRepository(db).processBatch(100); await engine.processBatch(100);
    expect((await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.missionId, m.missionId)))[0].currentCount).toBe(1);
    expect((await db.select().from(s.gameEvents).where(eq(s.gameEvents.gameEventId, source.gameEventId)))[0].processedAt).not.toBeNull();
  });
  it("simultaneous processors and restart cannot increment the same event twice", async () => {
    const m = await mission("DAILY", 2); await event(m);
    await Promise.all([engine.processBatch(100), new DrizzleMissionRepository(db).processBatch(100)]);
    await new DrizzleMissionRepository(db).processBatch(100);
    expect((await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.missionId, m.missionId)))[0].currentCount).toBe(1);
  });
  it("does not backfill processed/pre-activation events or recursively count reward-generated events", async () => {
    const m = await mission(); await db.update(s.missions).set({ activationEffectiveAt: date("2026-01-02Z") }).where(eq(s.missions.missionId, m.missionId)); await event(m); await engine.processBatch(100);
    expect(await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.missionId, m.missionId))).toHaveLength(0);
    await db.update(s.missions).set({ activationEffectiveAt: origin }).where(eq(s.missions.missionId, m.missionId)); await engine.processBatch(100); expect(await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.missionId, m.missionId))).toHaveLength(0);
    const xpMission = await mission(); await db.update(s.missionRules).set({ eventType: "xp.earned", conditions: {} }).where(eq(s.missionRules.missionId, xpMission.missionId));
    const levelMission = await mission(); await db.update(s.missionRules).set({ eventType: "progression.level_up", conditions: {} }).where(eq(s.missionRules.missionId, levelMission.missionId));
    await db.transaction(tx => grantXpInTransaction(tx, { playerId, amount: 20, sourceType: "MISSION_CHEST_REWARD", sourceId: crypto.randomUUID(), reason: "test", idempotencyKey: crypto.randomUUID() })); await engine.processBatch(100);
    expect(await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.playerId, playerId))).toHaveLength(0);
  });
  it("rolls back mission and chest reward ledgers if final claim event fails", async () => {
    const m = await mission(); const box = await chest("DAILY", [m], 1); await complete(m);
    await pg.exec("CREATE FUNCTION test_claim_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type IN ('mission.claimed','mission.chest_claimed') THEN RAISE EXCEPTION 'claim fixture failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_claim_fail BEFORE INSERT ON game_events FOR EACH ROW EXECUTE FUNCTION test_claim_fail();");
    try { await expect(claim(m.missionId, "2026-01-01")).rejects.toThrow(); await expect(chestClaim(box.chestId, "2026-01-01")).rejects.toThrow(); } finally { await pg.exec("DROP TRIGGER test_claim_fail ON game_events; DROP FUNCTION test_claim_fail();"); }
    expect(await db.select().from(s.xpTransactions).where(eq(s.xpTransactions.playerId, playerId))).toHaveLength(0); expect(await db.select().from(s.pointTransactions).where(eq(s.pointTransactions.playerId, playerId))).toHaveLength(0);
    expect(await db.select().from(s.missionClaims).where(eq(s.missionClaims.playerId, playerId))).toHaveLength(0); expect(await db.select().from(c.missionChestClaims).where(eq(c.missionChestClaims.playerId, playerId))).toHaveLength(0);
  });
  it("validates unsupported events, recursive rules, invalid dates and category combinations", () => {
    expect(() => validateMissionRule({ eventType: "mission.completed", targetCount: 1, conditions: {} })).toThrow(); expect(() => validateMissionRule({ eventType: "login.fake", targetCount: 1, conditions: {} })).toThrow();
    expect(() => validateMissionDefinition({ category: "DAILY", periodType: "LIFETIME", displayOrder: 0 })).toThrow(); expect(() => periodBounds("WEEKLY", "2026-W54", "test")).toThrow(); expect(() => periodBounds("DAILY", "2026-02-30", "test")).toThrow();
    expect(() => validateMissionDefinition({ category: "EVENT", periodType: "FIXED", displayOrder: 0 })).toThrow();
  });
});
