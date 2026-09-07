import { describe, expect, it } from "vitest";
import { developmentPuzzleCatalog, PuzzleOwnershipService } from "../src/domain/puzzles.js";
import { MAX_VIDEO_SIZE_BYTES, SubmissionService } from "../src/domain/submissions.js";
import { FakePuzzleRepository, FakeSubmissionRepository, FakeVideoStorage } from "./fakes.js";

async function setup() {
  const puzzleRepo = new FakePuzzleRepository();
  await new PuzzleOwnershipService(puzzleRepo).seedDevelopmentCatalog();
  puzzleRepo.ownerships.push({ playerPuzzleId: "30000000-0000-4000-8000-000000000001", playerId: "player-1", puzzleId: developmentPuzzleCatalog[0].puzzleLegacyWixId, status: "OWNED" });
  puzzleRepo.ownerships.push({ playerPuzzleId: "30000000-0000-4000-8000-000000000002", playerId: "player-1", puzzleId: developmentPuzzleCatalog[1].puzzleLegacyWixId, status: "OWNED" });
  const repo = new FakeSubmissionRepository(puzzleRepo);
  const storage = new FakeVideoStorage();
  return { puzzleRepo, repo, storage, service: new SubmissionService(repo, storage) };
}

async function verifiedUpload(service: SubmissionService, playerId = "player-1") {
  const signed = await service.signVideoUpload(playerId, { filename: "solve.mp4", mimeType: "video/mp4", sizeBytes: 2048 });
  await service.completeVideoUpload(playerId, signed.videoUploadId);
  return signed.videoUploadId;
}

describe("submission pipeline", () => {
  it("keeps video operations controlled when storage is not configured", async () => {
    const { service, storage } = await setup();
    storage.configured = false;
    await expect(service.signVideoUpload("player-1", { filename: "solve.mp4", mimeType: "video/mp4", sizeBytes: 100 })).rejects.toMatchObject({ code: "VIDEO_STORAGE_NOT_CONFIGURED", statusCode: 503 });
    await expect(service.completeVideoUpload("player-1", "10000000-0000-4000-8000-000000000001")).rejects.toMatchObject({ code: "VIDEO_STORAGE_NOT_CONFIGURED", statusCode: 503 });
  });

  it("creates a backend-controlled signed upload for the current player", async () => {
    const { service, repo, storage } = await setup();
    const signed = await service.signVideoUpload("player-1", { filename: "solve.mp4", mimeType: "video/mp4", sizeBytes: 2048 });
    expect(repo.uploads.get(signed.videoUploadId)?.playerId).toBe("player-1");
    expect(storage.signedPublicIds[0]).toContain("/player-1/");
    expect(signed.fields).not.toHaveProperty("apiSecret");
  });

  it.each([
    [{ filename: "solve.txt", mimeType: "text/plain", sizeBytes: 100 }, "MIME"],
    [{ filename: "solve.mp4", mimeType: "video/mp4", sizeBytes: 0 }, "size"],
    [{ filename: "solve.mp4", mimeType: "video/mp4", sizeBytes: MAX_VIDEO_SIZE_BYTES + 1 }, "size"],
  ])("rejects invalid upload metadata %#", async (input, message) => {
    const { service } = await setup();
    await expect(service.signVideoUpload("player-1", input)).rejects.toMatchObject({ code: "VALIDATION_FAILED", message: expect.stringContaining(message) });
  });

  it("does not allow another player to finalize an upload", async () => {
    const { service } = await setup();
    const signed = await service.signVideoUpload("player-1", { filename: "solve.mp4", mimeType: "video/mp4", sizeBytes: 100 });
    await expect(service.completeVideoUpload("player-2", signed.videoUploadId)).rejects.toMatchObject({ code: "VIDEO_UPLOAD_NOT_FOUND" });
    await expect(service.completeVideoUpload("player-1", "10000000-0000-4000-8000-999999999999")).rejects.toMatchObject({ code: "VIDEO_UPLOAD_NOT_FOUND" });
  });

  it("verifies provider metadata before marking an upload complete", async () => {
    const { service, repo } = await setup();
    const signed = await service.signVideoUpload("player-1", { filename: "solve.mp4", mimeType: "video/mp4", sizeBytes: 100 });
    await expect(service.completeVideoUpload("player-1", signed.videoUploadId)).resolves.toMatchObject({ status: "COMPLETE", sizeBytes: 1024 });
    expect(repo.uploads.get(signed.videoUploadId)?.status).toBe("COMPLETE");
  });

  it("marks failed verification without completing the upload", async () => {
    const { service, repo, storage } = await setup();
    storage.verificationFails = true;
    const signed = await service.signVideoUpload("player-1", { filename: "solve.mp4", mimeType: "video/mp4", sizeBytes: 100 });
    await expect(service.completeVideoUpload("player-1", signed.videoUploadId)).rejects.toMatchObject({ code: "VIDEO_UPLOAD_VERIFICATION_FAILED" });
    expect(repo.uploads.get(signed.videoUploadId)?.status).toBe("FAILED");
  });

  it("creates PENDING_REVIEW with canonical puzzle and level ids", async () => {
    const { service } = await setup();
    const videoUploadId = await verifiedUpload(service);
    const created = await service.createSubmission("player-1", { playerPuzzleId: "30000000-0000-4000-8000-000000000002", completionTimeMs: 161234, videoUploadId });
    expect(created).toMatchObject({ status: "PENDING_REVIEW", puzzleId: "DEV-PUZZLE-METAMORPHOSIS-R2", levelId: 22, completionTimeMs: 161234 });
  });

  it("rejects foreign ownership, foreign/incomplete uploads, and video reuse", async () => {
    const { service } = await setup();
    const videoUploadId = await verifiedUpload(service);
    await expect(service.createSubmission("player-2", { playerPuzzleId: "30000000-0000-4000-8000-000000000001", completionTimeMs: 1000, videoUploadId })).rejects.toMatchObject({ code: "PLAYER_PUZZLE_NOT_FOUND" });
    const playerTwoUpload = await verifiedUpload(service, "player-2");
    await expect(service.createSubmission("player-1", { playerPuzzleId: "30000000-0000-4000-8000-000000000001", completionTimeMs: 1000, videoUploadId: playerTwoUpload })).rejects.toMatchObject({ code: "VIDEO_UPLOAD_NOT_FOUND" });
    const incomplete = await service.signVideoUpload("player-1", { filename: "x.mp4", mimeType: "video/mp4", sizeBytes: 10 });
    await expect(service.createSubmission("player-1", { playerPuzzleId: "30000000-0000-4000-8000-000000000001", completionTimeMs: 1000, videoUploadId: incomplete.videoUploadId })).rejects.toMatchObject({ code: "VIDEO_UPLOAD_NOT_COMPLETE" });
    await service.createSubmission("player-1", { playerPuzzleId: "30000000-0000-4000-8000-000000000001", completionTimeMs: 1000, videoUploadId });
    await expect(service.createSubmission("player-1", { playerPuzzleId: "30000000-0000-4000-8000-000000000002", completionTimeMs: 2000, videoUploadId })).rejects.toMatchObject({ code: "VIDEO_UPLOAD_ALREADY_USED" });
  });

  it("lists and reads only the current player's submissions and keeps same-name variants separate", async () => {
    const { service, puzzleRepo } = await setup();
    puzzleRepo.ownerships.push({ playerPuzzleId: "30000000-0000-4000-8000-000000000003", playerId: "player-2", puzzleId: developmentPuzzleCatalog[0].puzzleLegacyWixId, status: "OWNED" });
    const first = await service.createSubmission("player-1", { playerPuzzleId: "30000000-0000-4000-8000-000000000001", completionTimeMs: 1000, videoUploadId: await verifiedUpload(service) });
    const second = await service.createSubmission("player-1", { playerPuzzleId: "30000000-0000-4000-8000-000000000002", completionTimeMs: 2000, videoUploadId: await verifiedUpload(service) });
    await service.createSubmission("player-2", { playerPuzzleId: "30000000-0000-4000-8000-000000000003", completionTimeMs: 3000, videoUploadId: await verifiedUpload(service, "player-2") });
    expect((await service.getSubmissions("player-1")).map((item) => item.puzzleId)).toEqual([first.puzzleId, second.puzzleId]);
    await expect(service.getSubmission("player-2", first.id)).rejects.toMatchObject({ code: "SUBMISSION_NOT_FOUND" });
  });
});
