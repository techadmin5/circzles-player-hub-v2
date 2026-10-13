import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v2 as cloudinary } from "cloudinary";
import * as s from "../src/db/schema.js";
import type { Database } from "../src/db/client.js";
import { DrizzleSubmissionRepository, SubmissionService, MAX_VIDEO_SIZE_BYTES } from "../src/domain/submissions.js";
import { DrizzleSubmissionReviewRepository } from "../src/domain/submissionReviews.js";
import { DrizzleAdminSubmissionRepository } from "../src/domain/adminSubmissions.js";
import { CompetitionSettingsService, DrizzleCompetitionSettingsRepository } from "../src/domain/competitionSettings.js";
import { CloudinaryVideoStorage } from "../src/storage/videoStorage.js";
import { DrizzleGameStateRepository, temporaryDevelopmentProgressionLevels } from "../src/domain/gameState.js";
import { cleanupAbandonedVideos } from "../src/operations/cleanupAbandonedVideos.js";
import { FakeVideoStorage } from "./fakes.js";
let pg: PGlite, db: Database;
class Storage extends FakeVideoStorage {
  duration = 300000; bytes = 100000000; wrongId = false; removed: string[] = [];
  async verifyUpload(publicId: string) { if (this.verificationFails) throw new Error("Provider unavailable"); return { publicId: this.wrongId ? "forged" : publicId, bytes: this.bytes, durationMs: this.duration, resourceType: "video" as const }; }
  async deleteUpload(id: string) { this.removed.push(id); }
}
beforeAll(async () => { pg = new PGlite(); for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(f => f.endsWith(".sql")).sort()) await pg.exec((await readFile(new URL("../drizzle/" + file, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", "")); db = drizzle(pg, { schema: s }) as unknown as Database; await new DrizzleGameStateRepository(db).seedProgressionLevels(temporaryDevelopmentProgressionLevels); }, 60000);
afterAll(async () => { await pg.close(); });
async function fixture(maximum: number | null = 300000, rewardEnabled = true) {
  const [user] = await db.insert(s.users).values({ verifiedEmail: crypto.randomUUID() + "@test.invalid", emailVerifiedAt: new Date() }).returning();
  const [player] = await db.insert(s.players).values({ userId: user.userId, displayName: "Player", publicPlayerId: crypto.randomUUID() }).returning();
  const [admin] = await db.insert(s.adminUsers).values({ userId: user.userId, role: "SUPER_ADMIN" }).returning();
  const [design] = await db.insert(s.puzzleDesigns).values({ name: crypto.randomUUID() }).returning();
  const [puzzle] = await db.insert(s.puzzles).values({ puzzleDesignId: design.puzzleDesignId, name: "Lion", levelId: 1 }).returning();
  const [owned] = await db.insert(s.playerPuzzles).values({ playerId: player.playerId, puzzleId: puzzle.puzzleId, source: "TEST" }).returning();
  await db.insert(s.puzzleCompetitionSettings).values({ puzzleId: puzzle.puzzleId, category: "MAIN_LEVEL", displayOrder: 0, maxLeaderboardTimeMs: maximum, rewardEnabled, synapseReward: 50, xpReward: 75 });
  const storage = new Storage(), repo = new DrizzleSubmissionRepository(db, storage), service = new SubmissionService(repo, storage), reviews = new DrizzleSubmissionReviewRepository(db, storage);
  async function upload() { const signed = await service.signVideoUpload(player.playerId, { filename: "solve.mp4", mimeType: "video/mp4", sizeBytes: MAX_VIDEO_SIZE_BYTES }); await service.completeVideoUpload(player.playerId, signed.videoUploadId); return signed.videoUploadId; }
  const input = async (completionTimeMs = 300000) => ({ playerPuzzleId: owned.playerPuzzleId, videoUploadId: await upload(), completionTimeMs });
  const review = (submissionId: string, decision: "APPROVED" | "REJECTED" | "RESUBMISSION_REQUIRED" = "APPROVED", key: string = crypto.randomUUID()) => reviews.review({ submissionId, reviewerAdminUserId: admin.adminUserId, decision, reviewNote: "Checked continuous recording", idempotencyKey: key });
  return { player, puzzle, owned, storage, repo, service, reviews, upload, input, review };
}
describe("verified competitive submission workflow", () => {
  it("accepts exactly 100 MB and 05:00, retries creation once, protects the video, and rewards first approval exactly once", async () => {
    expect(MAX_VIDEO_SIZE_BYTES).toBe(100000000);
    const f = await fixture(), input = await f.input();
    const result = await Promise.all([f.service.createSubmission(f.player.playerId, input, "retry"), f.service.createSubmission(f.player.playerId, input, "retry")]);
    expect(result[0].id).toBe(result[1].id); expect(result[0].status).toBe("PENDING_REVIEW");
    expect(await db.select().from(s.submissionRewardGrants).where(eq(s.submissionRewardGrants.puzzleId, f.puzzle.puzzleId))).toHaveLength(0);
    await expect(f.repo.abandonVideoUpload(f.player.playerId, input.videoUploadId)).rejects.toMatchObject({ code: "VIDEO_UPLOAD_ALREADY_USED" });
    await expect(f.service.createSubmission(f.player.playerId, input, "different-key")).rejects.toMatchObject({ code: "VIDEO_UPLOAD_ALREADY_USED" });
    const reviewed = await f.review(result[0].id, "APPROVED", "decision"); expect(reviewed.rewardGrant).toMatchObject({ synapseReward: 50, xpReward: 75 });
    expect((await f.review(result[0].id, "APPROVED", "decision")).idempotent).toBe(true);
    await new CompetitionSettingsService(new DrizzleCompetitionSettingsRepository(db)).upsert({ puzzleId: f.puzzle.puzzleId, xpReward: 999, synapseReward: 888 });
    expect((await new DrizzleAdminSubmissionRepository(db).get(result[0].id))?.completionRewards).toMatchObject({ alreadyProcessed: true, xpReward: 999, synapseReward: 888, grantedXpReward: 75, grantedSynapseReward: 50 });
    const next = await f.service.createSubmission(f.player.playerId, await f.input(280000), "next"); await f.review(next.id);
    expect(await db.select().from(s.submissionRewardGrants).where(eq(s.submissionRewardGrants.puzzleId, f.puzzle.puzzleId))).toHaveLength(1);
    expect((await db.select().from(s.leaderboardEntries).where(eq(s.leaderboardEntries.puzzleId, f.puzzle.puzzleId)))[0].bestCompletionTimeMs).toBe(280000);
    expect((await f.service.getSubmission(f.player.playerId, next.id)).reviewNote).toBe("Checked continuous recording");
    await expect(f.service.getSubmission(crypto.randomUUID(), next.id)).rejects.toMatchObject({ code: "SUBMISSION_NOT_FOUND" });
  });
  it("rejects 100000001 provider bytes even when the declared size passes signing", async () => {
    const f = await fixture();
    const signed = await f.service.signVideoUpload(f.player.playerId, { filename: "solve.mp4", mimeType: "video/mp4", sizeBytes: 100000000 });
    f.storage.bytes = 100000001;
    await expect(f.service.completeVideoUpload(f.player.playerId, signed.videoUploadId)).rejects.toMatchObject({ code: "VIDEO_UPLOAD_SIZE_INVALID" });
    expect((await f.repo.getVideoUpload(signed.videoUploadId))?.status).toBe("FAILED");
    expect(await db.select().from(s.submissions).where(eq(s.submissions.puzzleId, f.puzzle.puzzleId))).toHaveLength(0);
    await expect(f.service.signVideoUpload(f.player.playerId, { filename: "solve.mp4", mimeType: "video/mp4", sizeBytes: 100000001 })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
  it.each(["long-completion", "missing-limit", "unverified-duration", "oversize", "foreign-asset", "foreign-player"])("blocks %s without pending/audit/reward/leaderboard writes", async mode => {
    const f = await fixture(mode === "missing-limit" ? null : 300000), input = await f.input();
    if (mode === "long-completion") input.completionTimeMs = 300001;
    if (mode === "unverified-duration") await db.update(s.videoUploads).set({ durationMs: null }).where(eq(s.videoUploads.videoUploadId, input.videoUploadId));
    if (mode === "oversize") await db.update(s.videoUploads).set({ verifiedSizeBytes: MAX_VIDEO_SIZE_BYTES + 1 }).where(eq(s.videoUploads.videoUploadId, input.videoUploadId));
    if (mode === "foreign-asset") f.storage.wrongId = true;
    await expect(f.service.createSubmission(mode === "foreign-player" ? crypto.randomUUID() : f.player.playerId, input, mode)).rejects.toThrow();
    for (const table of [s.submissions, s.submissionRewardGrants, s.leaderboardEntries]) expect(await db.select().from(table).where(eq(table.puzzleId, f.puzzle.puzzleId))).toHaveLength(0);
  });
  it("rechecks current policy and current asset at approval, keeping pending state and rewards unchanged on failure", async () => {
    const f = await fixture(), created = await f.service.createSubmission(f.player.playerId, await f.input(), "pending");
    await db.update(s.puzzleCompetitionSettings).set({ maxLeaderboardTimeMs: 299999 }).where(eq(s.puzzleCompetitionSettings.puzzleId, f.puzzle.puzzleId));
    await expect(f.review(created.id)).rejects.toMatchObject({ code: "SUBMISSION_TIME_LIMIT_EXCEEDED" });
    await db.update(s.puzzleCompetitionSettings).set({ maxLeaderboardTimeMs: 300000 }).where(eq(s.puzzleCompetitionSettings.puzzleId, f.puzzle.puzzleId));
    f.storage.verificationFails = true; await expect(f.review(created.id)).rejects.toThrow();
    expect((await f.service.getSubmission(f.player.playerId, created.id)).status).toBe("PENDING_REVIEW");
    expect(await db.select().from(s.submissionReviews).where(eq(s.submissionReviews.submissionId, created.id))).toHaveLength(0);
    expect(await db.select().from(s.submissionRewardGrants).where(eq(s.submissionRewardGrants.puzzleId, f.puzzle.puzzleId))).toHaveLength(0);
  });
  it("keeps reject/resubmission reward-free and serializes competing decisions", async () => {
    for (const decision of ["REJECTED", "RESUBMISSION_REQUIRED"] as const) {
      const f = await fixture(), created = await f.service.createSubmission(f.player.playerId, await f.input(), "pending");
      const results = await Promise.allSettled([f.review(created.id, decision), f.review(created.id, "APPROVED")]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect((await f.service.getSubmission(f.player.playerId, created.id)).status).toBe(decision);
      expect(await db.select().from(s.submissionRewardGrants).where(eq(s.submissionRewardGrants.puzzleId, f.puzzle.puzzleId))).toHaveLength(0);
    }
  });
  it("cleans expired abandoned assets with dry-run and excludes submitted videos even after expiration", async () => {
    const f = await fixture(), input = await f.input();
    await f.service.createSubmission(f.player.playerId, input, "keep");
    const abandoned = await f.service.signVideoUpload(f.player.playerId, { filename: "old.mp4", mimeType: "video/mp4", sizeBytes: 100 });
    const old = new Date(Date.now() - 3 * 86400000);
    for (const id of [input.videoUploadId, abandoned.videoUploadId]) await db.update(s.videoUploads).set({ expiresAt: old }).where(eq(s.videoUploads.videoUploadId, id));
    const record = await f.repo.getVideoUpload(abandoned.videoUploadId), used = await f.repo.getVideoUpload(input.videoUploadId);
    const dry = await cleanupAbandonedVideos(db, f.storage); expect(dry.candidates).toBeGreaterThan(0); expect(f.storage.removed).toHaveLength(0);
    await cleanupAbandonedVideos(db, f.storage, true);
    expect(f.storage.removed).toContain(record!.publicId); expect(f.storage.removed).not.toContain(used!.publicId);
    expect((await f.repo.getVideoUpload(input.videoUploadId))?.status).toBe("COMPLETE");
    expect((await cleanupAbandonedVideos(db, f.storage)).candidates).toBe(0);
  });
  it.each([[195000, 210000], [269000, 20000], [269000, 305000], [299000, 310000]])("allows %i completion with %i recording for explicit manual review", async (completion, duration) => {
    const f = await fixture(); f.storage.duration = duration;
    const created = await f.service.createSubmission(f.player.playerId, await f.input(completion), "manual");
    expect(created.status).toBe("PENDING_REVIEW");
    expect(await db.select().from(s.submissionRewardGrants).where(eq(s.submissionRewardGrants.puzzleId, f.puzzle.puzzleId))).toHaveLength(0);
    const reader = new DrizzleAdminSubmissionRepository(db);
    expect((await reader.get(created.id))?.completionRewards).toMatchObject({ alreadyProcessed: false, xpReward: 75, synapseReward: 50 });
    await f.review(created.id);
    expect((await reader.get(created.id))?.completionRewards).toMatchObject({ alreadyProcessed: true, grantedXpReward: 75, grantedSynapseReward: 50 });
    const [event] = await db.select().from(s.gameEvents).where(eq(s.gameEvents.sourceId, (await db.select().from(s.submissionReviews).where(eq(s.submissionReviews.submissionId, created.id)))[0].submissionReviewId));
    expect(event.payload).toMatchObject({ videoDurationPolicy: "MANUAL_REVIEW", durationReviewWarning: true });
  });
  it.each([0, 300001])("rejects invalid reported completion %i independent of recording length", async completion => {
    const f = await fixture(); f.storage.duration = 310000;
    const input = await f.input(completion);
    await expect((async () => f.service.createSubmission(f.player.playerId, input, "invalid"))()).rejects.toThrow();
  });
  it("never invents rewards when disabled", async () => { const f = await fixture(300000, false), created = await f.service.createSubmission(f.player.playerId, await f.input(), "disabled"); expect((await f.review(created.id)).rewardGrant).toMatchObject({ rewardEnabledSnapshot: false, xpReward: 0, synapseReward: 0 }); });
  it("retries database finalization without poisoning an uploaded asset and rejects expired/oversized signing", async () => {
    const f = await fixture();
    await expect(f.service.signVideoUpload(f.player.playerId, { filename: "video.mp4", mimeType: "video/mp4", sizeBytes: MAX_VIDEO_SIZE_BYTES + 1 })).rejects.toThrow();
    const signed = await f.service.signVideoUpload(f.player.playerId, { filename: "video.mp4", mimeType: "video/mp4", sizeBytes: 100 });
    const spy = vi.spyOn(f.repo, "completeVideoUpload").mockRejectedValueOnce(new Error("DB unavailable"));
    await expect(f.service.completeVideoUpload(f.player.playerId, signed.videoUploadId)).rejects.toThrow(); spy.mockRestore();
    expect((await f.repo.getVideoUpload(signed.videoUploadId))?.status).toBe("SIGNED");
    await f.service.completeVideoUpload(f.player.playerId, signed.videoUploadId);
    await f.repo.abandonVideoUpload(f.player.playerId, signed.videoUploadId); expect(f.storage.removed).toHaveLength(1);
    await expect(f.service.completeVideoUpload(f.player.playerId, signed.videoUploadId)).rejects.toThrow();
    const expired = await f.service.signVideoUpload(f.player.playerId, { filename: "video.mp4", mimeType: "video/mp4", sizeBytes: 100 });
    await db.update(s.videoUploads).set({ expiresAt: new Date(0) }).where(eq(s.videoUploads.videoUploadId, expired.videoUploadId));
    await expect(f.service.completeVideoUpload(f.player.playerId, expired.videoUploadId)).rejects.toThrow();
  });
});
describe("Cloudinary metadata and protected transport", () => {
  const asset = { public_id: "owned", resource_type: "video", type: "authenticated", bytes: 100000000, format: "mp4", duration: 300, video: { codec: "h264" }, width: 1280, height: 720 };
  it("signs authenticated non-overwriting uploads and rounds duration conservatively", async () => {
    const storage = new CloudinaryVideoStorage({ cloudName: "test", apiKey: "test", apiSecret: "test-secret" });
    expect((await storage.signUpload("owned")).fields).toMatchObject({ type: "authenticated", overwrite: "false", allowedFormats: "mp4,mov,webm,m4v" });
    const spy = vi.spyOn(cloudinary.api, "resource").mockResolvedValue({ ...asset, duration: 300.000001 });
    try { expect((await storage.verifyUpload("owned")).durationMs).toBe(300001); expect(spy).toHaveBeenCalledWith("owned", { resource_type: "video", type: "authenticated", media_metadata: true, timeout: 10000 }); } finally { spy.mockRestore(); }
  });
  it.each([{ duration: undefined }, { duration: 0 }, { video: undefined }, { format: "mp3" }, { public_id: "forged" }, { type: "upload" }, { bytes: NaN }])("fails safely on missing/broken/audio/public/forged media %j", async patch => {
    const storage = new CloudinaryVideoStorage({ cloudName: "test", apiKey: "test", apiSecret: "test-secret" });
    const spy = vi.spyOn(cloudinary.api, "resource").mockResolvedValue({ ...asset, ...patch });
    try { await expect(storage.verifyUpload("owned")).rejects.toBeInstanceOf(Error); } finally { spy.mockRestore(); }
  });
});


describe("production-shaped verification", () => {
  const asset = { public_id: "owned", resource_type: "video", type: "authenticated", bytes: 4095836, format: "mp4", duration: 20.062367, codec: "h264", width: 1920, height: 1080 };
  it("accepts top-level codec from the actual authenticated Admin API response and logs no asset URL or credentials", async () => {
    const entries: Record<string, unknown>[] = [];
    const storage = new CloudinaryVideoStorage({ cloudName: "test", apiKey: "secret-key", apiSecret: "secret-secret", diagnostic: entry => entries.push(entry) });
    const spy = vi.spyOn(cloudinary.api, "resource").mockResolvedValue({ ...asset, secure_url: "https://secret-video.invalid" });
    try { expect(await storage.verifyUpload("owned", { uploadId: "upload", requestId: "request", stage: "finalization" })).toMatchObject({ durationMs: 20063, bytes: 4095836 }); }
    finally { spy.mockRestore(); }
    expect(entries[0]).toMatchObject({ uploadId: "upload", requestId: "request", codecLocation: "top_level" });
    expect(JSON.stringify(entries)).not.toMatch(/secret|secure_url|public_id/);
  });
  it("retries genuine processing responses with a bounded budget and does not retry authorization errors", async () => {
    const storage = new CloudinaryVideoStorage({ cloudName: "test", apiKey: "test", apiSecret: "test", retryDelaysMs: [0, 0], diagnostic: () => {} });
    const spy = vi.spyOn(cloudinary.api, "resource").mockRejectedValueOnce({ error: { http_code: 423 } }).mockResolvedValueOnce(asset);
    try { expect((await storage.verifyUpload("owned")).durationMs).toBe(20063); expect(spy).toHaveBeenCalledTimes(2);
      spy.mockReset().mockRejectedValue({ error: { http_code: 423 } }); await expect(storage.verifyUpload("owned")).rejects.toMatchObject({ code: "VIDEO_PROCESSING_PENDING" }); expect(spy).toHaveBeenCalledTimes(3);
      spy.mockReset().mockRejectedValue({ error: { http_code: 401 } }); await expect(storage.verifyUpload("owned")).rejects.toMatchObject({ code: "VIDEO_VERIFICATION_UNAVAILABLE" }); expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });
  it.each([[{ codec: undefined }, "VIDEO_UPLOAD_METADATA_INVALID"], [{ codec: "unknown-codec" }, "VIDEO_CODEC_UNSUPPORTED"], [{ format: "mp3" }, "VIDEO_MEDIA_UNSUPPORTED"], [{ bytes: 100000001 }, "VIDEO_UPLOAD_SIZE_INVALID"]])("rejects invalid provider evidence with a distinct safe code", async (patch, code) => {
    const storage = new CloudinaryVideoStorage({ cloudName: "test", apiKey: "test", apiSecret: "test", diagnostic: () => {} });
    const spy = vi.spyOn(cloudinary.api, "resource").mockResolvedValue({ ...asset, ...patch });
    try { await expect(storage.verifyUpload("owned")).rejects.toMatchObject({ code }); } finally { spy.mockRestore(); }
  });
});
