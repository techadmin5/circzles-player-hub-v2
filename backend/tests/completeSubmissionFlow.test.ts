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
  it.each(["long-video", "long-completion", "missing-limit", "unverified-duration", "oversize", "foreign-asset", "foreign-player"])("blocks %s without pending/audit/reward/leaderboard writes", async mode => {
    const f = await fixture(mode === "missing-limit" ? null : 300000), input = await f.input();
    if (mode === "long-video") { f.storage.duration = 300001; await db.update(s.videoUploads).set({ durationMs: 300001 }).where(eq(s.videoUploads.videoUploadId, input.videoUploadId)); }
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
    try { expect((await storage.verifyUpload("owned")).durationMs).toBe(300001); expect(spy).toHaveBeenCalledWith("owned", { resource_type: "video", type: "authenticated" }); } finally { spy.mockRestore(); }
  });
  it.each([{ duration: undefined }, { duration: 0 }, { video: undefined }, { format: "mp3" }, { public_id: "forged" }, { type: "upload" }, { bytes: NaN }])("fails safely on missing/broken/audio/public/forged media %j", async patch => {
    const storage = new CloudinaryVideoStorage({ cloudName: "test", apiKey: "test", apiSecret: "test-secret" });
    const spy = vi.spyOn(cloudinary.api, "resource").mockResolvedValue({ ...asset, ...patch });
    try { await expect(storage.verifyUpload("owned")).rejects.toMatchObject({ code: "VIDEO_UPLOAD_VERIFICATION_FAILED" }); } finally { spy.mockRestore(); }
  });
});
