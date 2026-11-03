import { readFile, readdir } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import type { Database } from "../src/db/client.js";
import * as s from "../src/db/schema.js";
import * as t from "../src/db/missionStarterSchema.js";
import { missionAdminHistory } from "../src/db/missionAdminSchema.js";
import { AdminMissionService, starterManifestDigest } from "../src/domain/adminMissions.js";
import { starterBatchKey, starterMissionManifest } from "../src/domain/missionStarterManifest.js";
import { DrizzleMissionRepository, DrizzleMissionClaimRepository } from "../src/domain/missions.js";
import { contributionKey, isFirstAction, validateTracking, type MissionTracking } from "../src/domain/missionTracking.js";
import { insertGameEventInTransaction } from "../src/domain/gameEvents.js";
import { DrizzleGameStateRepository } from "../src/domain/gameState.js";
import { readMissionApprovalContract } from "../src/domain/missionApprovalContract.js";
import { registerAdminMissionRoutes } from "../src/http/adminMissionRoutes.js";
import { AdminAuthorizationService, DrizzleAdminAuthorizationRepository } from "../src/domain/adminAuth.js";
import type { Env } from "../src/config/env.js";
import { DrizzleRewardWheelRepository, RewardWheelService } from "../src/domain/rewardWheel.js";
import { DrizzlePuzzleRepository, PuzzleOwnershipService, developmentPuzzleCatalog } from "../src/domain/puzzles.js";
import { DrizzleSubmissionRepository, SubmissionService } from "../src/domain/submissions.js";
import { DrizzleSubmissionReviewRepository } from "../src/domain/submissionReviews.js";
import { FakeVideoStorage } from "./fakes.js";

let pg: PGlite, db: Database, admin: AdminMissionService, engine: DrizzleMissionRepository, playerId: string, actor: string;
const now = new Date("2030-02-10T12:00:00Z"), cutoff = new Date("2020-01-01Z");
const plain: MissionTracking = { mode: "EVENT_COUNT", firstEver: false, eligibleMissionIds: [], collectibleId: null };
beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql")).sort()) await pg.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  db = drizzle(pg, { schema: s }) as unknown as Database;
  admin = new AdminMissionService(db); engine = new DrizzleMissionRepository(db);
  const [user] = await db.insert(s.users).values({ verifiedEmail: "starter-admin@test.invalid" }).returning();
  actor = (await db.insert(s.adminUsers).values({ userId: user.userId, role: "SUPER_ADMIN" }).returning())[0].adminUserId;
  await new DrizzleGameStateRepository(db).seedProgressionLevels([{ progressionLevel: 1, rankName: "Test", xpRequired: 0, rewards: [] }]);
}, 60000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  // In-memory PGlite only. No URL, shared schema, TRUNCATE or retained database.
  await db.update(s.missions).set({ active: false });
  await db.update(s.gameEvents).set({ processedAt: now });
  const [user] = await db.insert(s.users).values({ verifiedEmail: `${crypto.randomUUID()}@test.invalid` }).returning();
  playerId = (await db.insert(s.players).values({ userId: user.userId, displayName: "Synthetic starter" }).returning())[0].playerId;
});
async function definition(eventType = "reward_wheel.spun", periodType = "WEEKLY", target = 3, tracking = plain) {
  const [mission] = await db.insert(s.missions).values({ title: "Synthetic starter", description: "", active: true, periodType, category: periodType === "LIFETIME" ? "ACHIEVEMENT" : periodType, activationEffectiveAt: cutoff }).returning();
  await db.insert(s.missionRules).values({ missionId: mission.missionId, eventType, targetCount: target, conditions: {} });
  await db.insert(s.missionRewards).values([{ missionId: mission.missionId, rewardType: "XP", amount: 2 }, { missionId: mission.missionId, rewardType: "SYNAPSE_POINTS", amount: 3 }]);
  await db.insert(t.missionTrackingConfigs).values({ missionId: mission.missionId, ...tracking });
  return mission;
}
async function event(eventType: string, at: string, payload: Record<string, unknown> = {}, sourceId: string = crypto.randomUUID(), key: string = crypto.randomUUID()) {
  return db.transaction(tx => insertGameEventInTransaction(tx, { playerId, eventType: eventType as "reward_wheel.spun", sourceType: eventType === "mission.completed" ? "MISSION" : "SYNTHETIC", sourceId, payload, idempotencyKey: key }, new Date(at)));
}
async function progress(id: string) { return db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.missionId, id)); }
async function ownership() {
  const [design] = await db.insert(s.puzzleDesigns).values({ name: "Synthetic" }).returning();
  const [puzzle] = await db.insert(s.puzzles).values({ name: "Synthetic", puzzleDesignId: design.puzzleDesignId, levelId: 1 }).returning();
  const [owned] = await db.insert(s.playerPuzzles).values({ playerId, puzzleId: puzzle.puzzleId, createdAt: new Date("2029-01-01Z") }).returning();
  return { puzzle, owned };
}

it("keeps the reviewed 14-concept manifest, no achievement currency defaults and no chest edits", async () => {
  expect(starterMissionManifest).toHaveLength(14);
  expect(new Set(starterMissionManifest.map(row => row.key)).size).toBe(14);
  expect(starterMissionManifest.map(row => row.key)).toEqual(["daily-check-in", "one-more-spin", "take-your-shot", "puzzle-explorer", "weekly-puzzle-quest", "spin-streak", "puzzle-challenger", "circle-explorer", "weekly-comeback", "puzzle-pro", "first-puzzle", "first-submission", "first-approved-solve", "puzzle-milestone"]);
  expect(starterMissionManifest.filter(row => row.category === "DAILY")).toHaveLength(4);
  expect(starterMissionManifest.filter(row => row.category === "WEEKLY")).toHaveLength(6);
  expect(starterMissionManifest.filter(row => row.category === "ACHIEVEMENT")).toHaveLength(4);
  expect(starterMissionManifest.some(row => row.key === "circle-collector" || row.title === "Start Your Circle")).toBe(false);
  expect(starterMissionManifest.filter(row => row.requiresLiveWheelAvailabilityConfirmation).map(row => row.key)).toEqual(["one-more-spin", "spin-streak"]);
  const explorer = starterMissionManifest.find(row => row.key === "circle-explorer")!;
  expect(explorer).toMatchObject({ eventType: "mission.completed", mode: "DISTINCT_MISSIONS", target: 4 });
  expect(explorer.eligibleKeys).toEqual(["daily-check-in", "one-more-spin", "take-your-shot", "puzzle-explorer", "existing-start-your-circle"]);
  expect(explorer.externalMissionReferences).toEqual([expect.objectContaining({ missionId: null, key: "existing-start-your-circle", policy: "REFERENCE_ONLY_NEVER_MUTATE" })]);
  expect(starterMissionManifest.filter(row => row.category === "ACHIEVEMENT").every(row => row.xp === null && row.sp === null)).toBe(true);
  const local = JSON.parse(await readFile(new URL("../../docs/missions-starter/manifest.json", import.meta.url), "utf8"));
  expect(local.manifestDigest).toBe(starterManifestDigest()); expect(local.missions).toEqual(starterMissionManifest);
});
it("atomically creates inactive/unapproved drafts and replays stable IDs without duplicate audit or catalogs", async () => {
  const input = { batchKey: starterBatchKey, manifestDigest: starterManifestDigest() };
  const first = await admin.createStarterBatch(input, actor, now);
  expect(first.missions).toHaveLength(14); expect(first.missions.every(row => row.created)).toBe(true);
  const historyCount = (await db.select().from(missionAdminHistory)).length;
  const second = await admin.createStarterBatch(input, actor, now);
  expect(second.missions.map(row => row.missionId)).toEqual(first.missions.map(row => row.missionId));
  expect(second.missions.every(row => !row.created)).toBe(true); expect((await db.select().from(missionAdminHistory)).length).toBe(historyCount);
  for (const row of first.missions) {
    expect((await admin.detail(row.missionId)).active).toBe(false);
    expect((await admin.approvalContract(row.missionId)).categories.every(category => category.status === "MISSING")).toBe(true);
  }
  const achievement = first.missions.find(row => row.key === "first-puzzle")!;
  expect((await admin.readiness(achievement.missionId, now)).checks).toContainEqual(expect.objectContaining({ code: "REWARDS_VALID", status: "BLOCKED" }));
}, 30000);
it("does not recreate or alter Start Your Circle and keeps Circle Explorer blocked until exact 4-of-5 binding", async () => {
  const [existing] = await db.insert(s.missions).values({ title: "Start Your Circle", description: "Synthetic existing live definition", active: true, category: "DAILY", periodType: "DAILY", updatedAt: now }).returning();
  const [rule] = await db.insert(s.missionRules).values({ missionId: existing.missionId, eventType: "puzzle.added", targetCount: 1, conditions: {} }).returning();
  const rewards = await db.insert(s.missionRewards).values([{ missionId: existing.missionId, rewardType: "XP", amount: 50 }, { missionId: existing.missionId, rewardType: "SYNAPSE_POINTS", amount: 100 }]).returning();
  const result = await admin.createStarterBatch({ batchKey: starterBatchKey, manifestDigest: starterManifestDigest() }, actor, now);
  expect(result.missions).toHaveLength(14);
  expect(result.missions.some(row => row.missionId === existing.missionId || row.key === "circle-collector")).toBe(false);
  const entry = result.missions.find(row => row.key === "circle-explorer")!;
  let explorer = await admin.detail(entry.missionId);
  expect(explorer.active).toBe(false); expect(explorer.rule).toMatchObject({ eventType: "mission.completed", targetCount: 4 });
  expect(await admin.tracking(entry.missionId)).toBeNull();
  expect((await admin.readiness(entry.missionId, now)).checks).toContainEqual(expect.objectContaining({ code: "TRACKING_VALID", status: "BLOCKED" }));
  const keys = ["daily-check-in", "one-more-spin", "take-your-shot", "puzzle-explorer"];
  const ids = keys.map(key => result.missions.find(row => row.key === key)!.missionId).concat(existing.missionId);
  explorer = await admin.updateTracking(entry.missionId, { ...plain, mode: "DISTINCT_MISSIONS", eligibleMissionIds: ids, expectedUpdatedAt: explorer.updatedAt }, actor, now);
  expect((await admin.tracking(entry.missionId))?.eligibleMissionIds).toEqual(ids);
  expect(explorer.rule).toMatchObject({ eventType: "mission.completed", targetCount: 4, conditions: {} });
  expect((await admin.readiness(entry.missionId, now)).checks).toContainEqual(expect.objectContaining({ code: "TRACKING_VALID", status: "PASS" }));
  expect((await db.select().from(s.missions).where(eq(s.missions.missionId, existing.missionId)))[0]).toEqual(existing);
  expect((await db.select().from(s.missionRules).where(eq(s.missionRules.missionId, existing.missionId)))[0]).toEqual(rule);
  expect(await db.select().from(s.missionRewards).where(eq(s.missionRewards.missionId, existing.missionId))).toEqual(rewards);
});
it("rejects changed manifests and client activation fields without writes", async () => {
  const count = (await db.select().from(s.missions)).length;
  await expect(admin.createStarterBatch({ batchKey: starterBatchKey, manifestDigest: "0".repeat(64) }, actor)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(admin.createStarterBatch({ batchKey: starterBatchKey, manifestDigest: starterManifestDigest(), active: true }, actor)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  expect((await db.select().from(s.missions)).length).toBe(count);
});
it("batch audit failure rolls back newly created drafts, correlations and catalog assets", async () => {
  const fresh = new PGlite();
  try {
    for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql")).sort()) await fresh.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
    const local = drizzle(fresh, { schema: s }) as unknown as Database;
    await expect(new AdminMissionService(local).createStarterBatch({ batchKey: starterBatchKey, manifestDigest: starterManifestDigest() }, crypto.randomUUID())).rejects.toThrow();
    expect(await local.select().from(s.missions)).toEqual([]); expect(await local.select().from(t.missionStarterBatchItems)).toEqual([]); expect(await local.select().from(s.rewardDefinitions)).toEqual([]);
  } finally { await fresh.close(); }
}, 60000);
it("requires actual SUPER_ADMIN sessions for batch and tracking routes", async () => {
  const app = Fastify(); await app.register(cookie);
  const auth = new AdminAuthorizationService(new DrizzleAdminAuthorizationRepository(db), "synthetic-secret-at-least-32-characters");
  registerAdminMissionRoutes(app, { env: { NODE_ENV: "test", FRONTEND_ORIGIN: "https://test.invalid" } as Env, adminAuth: auth, adminMissions: admin });
  try {
    for (const path of ["starter-manifest", "starter-batch", `${crypto.randomUUID()}/tracking`]) {
      const result = await app.inject({ method: path === "starter-batch" ? "POST" : "GET", url: `/api/admin/missions/${path}`, payload: path === "starter-batch" ? {} : undefined });
      expect([401, 403]).toContain(result.statusCode);
    }
  } finally { await app.close(); }
});
it("check-in is explicit, server-dated and idempotent across retries", async () => {
  const first = await engine.checkIn(playerId), second = await engine.checkIn(playerId);
  expect(first.idempotent).toBe(false); expect(second).toEqual({ ...first, idempotent: true });
  const events = await db.select().from(s.gameEvents).where(eq(s.gameEvents.playerId, playerId));
  expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ eventType: "player.checked_in", payload: { utcDate: first.utcDate }, sourceType: "PLAYER_CHECK_IN" });
});
it("real puzzle claiming, submission and official review emit distinct, retry-safe events", async () => {
  const ownership = new PuzzleOwnershipService(new DrizzlePuzzleRepository(db));
  await ownership.seedDevelopmentCatalog([developmentPuzzleCatalog[0]]);
  const owned = (await ownership.claimByCode(playerId, "DEV-MM-R1-0001")).puzzle;
  await expect(ownership.claimByCode(playerId, "DEV-MM-R1-0001")).rejects.toThrow();
  await db.insert(s.puzzleCompetitionSettings).values({ puzzleId: owned.id, category: "MAIN_LEVEL", displayOrder: 0, leaderboardEnabled: true, maxLeaderboardTimeMs: 300000, rewardEnabled: false });
  const storage = new FakeVideoStorage();
  const submissions = new SubmissionService(new DrizzleSubmissionRepository(db, storage), storage);
  const signed = await submissions.signVideoUpload(playerId, { filename: "synthetic.mp4", mimeType: "video/mp4", sizeBytes: 100 });
  await submissions.completeVideoUpload(playerId, signed.videoUploadId);
  const input = { playerPuzzleId: owned.playerPuzzleId, videoUploadId: signed.videoUploadId, completionTimeMs: 120000 };
  const submission = await submissions.createSubmission(playerId, input, "starter-submission");
  expect((await submissions.createSubmission(playerId, input, "starter-submission")).id).toBe(submission.id);
  let events = await db.select().from(s.gameEvents).where(eq(s.gameEvents.playerId, playerId));
  expect(events.filter(row => row.eventType === "puzzle.added")).toHaveLength(1);
  expect(events.filter(row => row.eventType === "submission.created")).toHaveLength(1);
  expect(events.filter(row => row.eventType === "submission.approved")).toHaveLength(0);
  const reviews = new DrizzleSubmissionReviewRepository(db, storage);
  const review = { submissionId: submission.id, reviewerAdminUserId: actor, decision: "APPROVED" as const, reviewNote: "Synthetic verified recording", idempotencyKey: "starter-review" };
  await reviews.review(review); await reviews.review(review);
  events = await db.select().from(s.gameEvents).where(eq(s.gameEvents.playerId, playerId));
  expect(events.filter(row => row.eventType === "submission.approved")).toHaveLength(1);
  expect(events.filter(row => row.eventType === "personal_best.improved")).toHaveLength(1);
});
it("real wheel views do not count, successful persisted spins count once and failed spins emit nothing", async () => {
  const [reward] = await db.insert(s.rewardDefinitions).values({ code: crypto.randomUUID(), name: "Synthetic wheel SP", description: "", rewardType: "SYNAPSE_POINTS" }).returning();
  const [wheel] = await db.insert(s.rewardWheels).values({ code: "STARTER-SYNTHETIC", name: "Synthetic wheel", active: true }).returning();
  await db.insert(s.rewardWheelSpinTiers).values([0, 10, 20, 30].map((cost, index) => ({ rewardWheelId: wheel.rewardWheelId, spinNumber: index + 1, costSynapsePoints: cost })));
  await db.insert(s.rewardWheelSegments).values({ rewardWheelId: wheel.rewardWheelId, position: 0, displayLabel: "Synthetic 1 SP", weight: 1, rewardDefinitionId: reward.rewardDefinitionId, rewardQuantity: 1 });
  const service = new RewardWheelService(new DrizzleRewardWheelRepository(db), () => 0);
  const count = async () => (await db.select().from(s.gameEvents).where(eq(s.gameEvents.playerId, playerId))).filter(row => row.eventType === "reward_wheel.spun").length;
  await service.getStatus(playerId); expect(await count()).toBe(0);
  const input = { playerId, idempotencyKey: "starter-spin" };
  const first = await service.spin(input), retry = await service.spin(input);
  expect(retry.spinId).toBe(first.spinId); expect(retry.idempotent).toBe(true); expect(await count()).toBe(1);
  await expect(service.spin({ playerId, idempotencyKey: "unaffordable-spin" })).rejects.toThrow(); expect(await count()).toBe(1);
  expect(await db.select().from(s.rewardWheelSpins).where(eq(s.rewardWheelSpins.playerId, playerId))).toHaveLength(1);
});
it("counts three distinct UTC dates, not spins, and starts a new ISO week", async () => {
  const m = await definition("reward_wheel.spun", "WEEKLY", 3, { ...plain, mode: "DISTINCT_UTC_DAYS" });
  for (const at of ["2030-02-04T00:00Z", "2030-02-04T12:00Z", "2030-02-05T00:00Z", "2030-02-10T23:59:59Z", "2030-02-11T00:00Z"]) await event("reward_wheel.spun", at);
  await engine.processBatch(100);
  expect((await progress(m.missionId)).map(row => [row.periodKey, row.currentCount, row.status]).sort()).toEqual([["2030-W06", 3, "CLAIMABLE"], ["2030-W07", 1, "IN_PROGRESS"]]);
});
it("deduplicates same recorded action and preserves existing daily counting", async () => {
  const m = await definition("submission.created", "DAILY", 1);
  const key = crypto.randomUUID(); await event("submission.created", "2030-02-10T00:00Z", {}, undefined, key); await event("submission.created", "2030-02-10T12:00Z", {}, undefined, key);
  await event("submission.created", "2030-02-11T00:00Z"); await engine.processBatch(100);
  expect(await progress(m.missionId)).toHaveLength(2);
  expect((await db.select().from(t.missionEventContributions).where(eq(t.missionEventContributions.missionId, m.missionId)))).toHaveLength(2);
});
it("first-ever ownership includes legacy and soft-deleted records without backfill", async () => {
  const m = await definition("puzzle.added", "LIFETIME", 1, { ...plain, firstEver: true });
  const { owned } = await ownership(); await db.update(s.playerPuzzles).set({ deletedAt: now }).where(eq(s.playerPuzzles.playerPuzzleId, owned.playerPuzzleId));
  await event("puzzle.added", "2030-02-10T00:00Z"); await engine.processBatch(100);
  expect(await progress(m.missionId)).toEqual([]);
});
it("a first genuine action earns once; earlier events exclude later first-ever eligibility", async () => {
  const m = await definition("submission.created", "LIFETIME", 1, { ...plain, firstEver: true });
  const first = await event("submission.created", "2030-02-10T00:00Z");
  expect(await db.transaction(tx => isFirstAction(tx, first.event))).toBe(true);
  const later = await event("submission.created", "2030-02-10T12:00Z");
  expect(await db.transaction(tx => isFirstAction(tx, later.event))).toBe(false);
  await engine.processBatch(100); expect((await progress(m.missionId))[0].currentCount).toBe(1);
});
it("legacy submissions and legacy approved solves exclude first-ever rewards without event history", async () => {
  const { puzzle, owned } = await ownership();
  const [video] = await db.insert(s.videoUploads).values({ playerId, storageProvider: "SYNTHETIC", publicId: crypto.randomUUID(), mimeType: "video/mp4", declaredSizeBytes: 10, expiresAt: now }).returning();
  await db.insert(s.submissions).values({ playerId, playerPuzzleId: owned.playerPuzzleId, puzzleId: puzzle.puzzleId, levelId: 1, completionTimeMs: 123000, videoUploadId: video.videoUploadId, status: "APPROVED", submittedAt: new Date("2029-01-01Z"), updatedAt: new Date("2029-01-02Z") });
  const first = await event("submission.created", "2030-02-10T01:00Z");
  const approved = await event("submission.approved", "2030-02-10T01:00Z");
  expect(await db.transaction(tx => isFirstAction(tx, first.event))).toBe(false);
  expect(await db.transaction(tx => isFirstAction(tx, approved.event))).toBe(false);
});
it("excludes the current genuine ownership when determining first-ever eligibility", async () => {
  const { puzzle, owned } = await ownership();
  const [prefix] = await db.insert(s.puzzleClaimPrefixes).values({ puzzleId: puzzle.puzzleId, prefix: "SYNTHETIC-STARTER", normalizedPrefix: "SYNTHETIC-STARTER" }).returning();
  const [claim] = await db.insert(s.puzzleClaims).values({ playerId, puzzleId: puzzle.puzzleId, puzzleClaimPrefixId: prefix.puzzleClaimPrefixId, normalizedCode: "SYNTHETIC-STARTER-0001", serialNumber: 1n }).returning();
  await db.update(s.playerPuzzles).set({ puzzleClaimId: claim.puzzleClaimId }).where(eq(s.playerPuzzles.playerPuzzleId, owned.playerPuzzleId));
  const current = await event("puzzle.added", "2030-02-10T01:00Z", { puzzleId: puzzle.puzzleId }, claim.puzzleClaimId);
  expect(await db.transaction(tx => isFirstAction(tx, current.event))).toBe(true);
});
it("does not backfill a first-ever event from before activation", async () => {
  const m = await definition("submission.created", "LIFETIME", 1, { ...plain, firstEver: true });
  await db.update(s.missions).set({ activationEffectiveAt: new Date("2030-02-10Z") }).where(eq(s.missions.missionId, m.missionId));
  await event("submission.created", "2030-02-09T23:59Z"); await event("submission.created", "2030-02-10T12:00Z");
  await engine.processBatch(100); expect(await progress(m.missionId)).toEqual([]);
});
it("distinct mission completion counts unique definitions across days and rejects invented payloads", async () => {
  const one = await definition("submission.created", "DAILY", 1), two = await definition("puzzle.added", "DAILY", 1);
  const aggregate = await definition("mission.completed", "WEEKLY", 2, { ...plain, mode: "DISTINCT_MISSIONS", eligibleMissionIds: [one.missionId, two.missionId] });
  await event("mission.completed", "2030-02-04T00:00Z", { missionId: two.missionId });
  await event("submission.created", "2030-02-04T01:00Z"); await event("submission.created", "2030-02-05T01:00Z");
  await engine.processBatch(100); expect((await progress(aggregate.missionId))[0].currentCount).toBe(1);
  await event("puzzle.added", "2030-02-06T01:00Z"); await engine.processBatch(100);
  expect((await progress(aggregate.missionId))[0]).toMatchObject({ status: "CLAIMABLE", currentCount: 2, periodKey: "2030-W06" });
});
it("rejects recursive lists, duplicate eligible IDs and unsupported distinct-day goals", async () => {
  const m = await definition();
  await expect(db.transaction(tx => validateTracking(tx, m, { eventType: "mission.completed", targetCount: 1 }, { ...plain, mode: "DISTINCT_MISSIONS", eligibleMissionIds: [m.missionId] }))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(db.transaction(tx => validateTracking(tx, m, { eventType: "submission.created", targetCount: 3 }, { ...plain, mode: "DISTINCT_UTC_DAYS" }))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});
it("tracking changes bind a new digest/revision and audit failures roll back", async () => {
  const m = await definition(); await db.update(s.missions).set({ active: false }).where(eq(s.missions.missionId, m.missionId));
  const loaded = await admin.detail(m.missionId), before = await readMissionApprovalContract(db, m.missionId);
  await expect(admin.updateTracking(m.missionId, { ...plain, mode: "DISTINCT_UTC_DAYS", expectedUpdatedAt: loaded.updatedAt }, crypto.randomUUID(), now)).rejects.toThrow();
  expect((await admin.detail(m.missionId)).updatedAt).toBe(loaded.updatedAt);
  const saved = await admin.updateTracking(m.missionId, { ...plain, mode: "DISTINCT_UTC_DAYS", expectedUpdatedAt: loaded.updatedAt }, actor, now);
  expect((await readMissionApprovalContract(db, m.missionId)).binding.configurationDigest).not.toBe(before.binding.configurationDigest);
  await expect(admin.updateTracking(m.missionId, { ...plain, expectedUpdatedAt: loaded.updatedAt }, actor)).rejects.toMatchObject({ code: "MISSION_REVISION_CONFLICT" });
  expect(saved.active).toBe(false);
});
it.each(["BADGE", "FRAME"] as const)("freezes %s entitlement, delivers through inventory once and preserves XP/SP claims", async rewardType => {
  const [asset] = await db.insert(s.rewardDefinitions).values({ code: crypto.randomUUID(), name: "Synthetic collectible", description: "", rewardType, active: true }).returning();
  const m = await definition("submission.approved", "LIFETIME", 1, { ...plain, collectibleId: asset.rewardDefinitionId });
  await event("submission.approved", "2030-02-10T01:00Z"); await engine.processBatch(100);
  const p = (await progress(m.missionId))[0];
  await db.update(t.missionTrackingConfigs).set({ collectibleId: null }).where(eq(t.missionTrackingConfigs.missionId, m.missionId));
  const claims = new DrizzleMissionClaimRepository(db), key = crypto.randomUUID();
  const input = { playerId, missionId: m.missionId, periodKey: "lifetime", idempotencyKey: key, now };
  expect((await claims.claim(input)).awarded).toEqual({ xp: 2, synapsePoints: 3 }); expect((await claims.claim(input)).idempotent).toBe(true);
  expect(await db.select().from(s.inventoryGrants).where(eq(s.inventoryGrants.playerId, playerId))).toHaveLength(1);
  expect((await db.select().from(t.missionEarnedCollectibles).where(eq(t.missionEarnedCollectibles.progressId, p.playerMissionProgressId)))[0].disposition).toBe("GRANTED");
  await expect(db.update(t.missionEarnedCollectibles).set({ disposition: "PENDING" }).where(eq(t.missionEarnedCollectibles.progressId, p.playerMissionProgressId))).rejects.toThrow();
});
it("already-owned collectibles never duplicate ownership or block earned XP/SP", async () => {
  const [asset] = await db.insert(s.rewardDefinitions).values({ code: crypto.randomUUID(), name: "Synthetic owned badge", description: "", rewardType: "BADGE" }).returning();
  await db.insert(s.playerInventoryItems).values({ playerId, rewardDefinitionId: asset.rewardDefinitionId, quantity: 1 });
  const m = await definition("submission.approved", "LIFETIME", 1, { ...plain, collectibleId: asset.rewardDefinitionId });
  await event("submission.approved", "2030-02-10T01:00Z"); await engine.processBatch(100);
  const result = await new DrizzleMissionClaimRepository(db).claim({ playerId, missionId: m.missionId, idempotencyKey: crypto.randomUUID(), now });
  expect(result.awarded).toEqual({ xp: 2, synapsePoints: 3 });
  expect(await db.select().from(s.inventoryGrants).where(eq(s.inventoryGrants.playerId, playerId))).toEqual([]);
  expect((await db.select().from(t.missionEarnedCollectibles).where(eq(t.missionEarnedCollectibles.progressId, (await progress(m.missionId))[0].playerMissionProgressId)))[0].disposition).toBe("ALREADY_OWNED");
});
it("unsafe capacity rolls back both currency and collectible, retaining earned entitlement", async () => {
  const [asset] = await db.insert(s.rewardDefinitions).values({ code: crypto.randomUUID(), name: "Synthetic", description: "", rewardType: "BADGE" }).returning();
  const m = await definition("submission.approved", "LIFETIME", 1, { ...plain, collectibleId: asset.rewardDefinitionId });
  await event("submission.approved", "2030-02-10T01:00Z"); await engine.processBatch(100);
  await db.insert(s.wallets).values({ playerId, balance: 2147483647 });
  await expect(new DrizzleMissionClaimRepository(db).claim({ playerId, missionId: m.missionId, idempotencyKey: crypto.randomUUID(), now })).rejects.toMatchObject({ code: "MISSION_CAPACITY_PENDING" });
  expect(await db.select().from(s.missionClaims).where(eq(s.missionClaims.playerId, playerId))).toEqual([]);
  expect(await db.select().from(s.inventoryGrants).where(eq(s.inventoryGrants.playerId, playerId))).toEqual([]);
  expect((await progress(m.missionId))[0].status).toBe("CLAIMABLE");
});
it.each(["2030-02-10T00:00Z", "2030-02-10T23:59:59.999Z", "2030-02-11T00:00Z"])("derives UTC day keys from trusted event timestamps %s", timestamp => {
  expect(contributionKey({ ...plain, mode: "DISTINCT_UTC_DAYS" }, { gameEventId: crypto.randomUUID(), createdAt: new Date(timestamp), payload: {} })).toBe(timestamp.slice(0, 10));
});
