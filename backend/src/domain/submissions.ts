import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema.js";
import { playerPuzzles, puzzles, submissions, videoUploads, puzzleCompetitionSettings } from "../db/schema.js";
import type { VideoStorage, VerifiedVideoAsset } from "../storage/videoStorage.js";
import { AppError, validationFailed } from "./errors.js";
import { insertGameEventInTransaction } from "./gameEvents.js";

type Db = NodePgDatabase<typeof schema>;
export { MAX_VIDEO_SIZE_BYTES } from "./submissionEligibility.js";
import { MAX_VIDEO_SIZE_BYTES, VIDEO_MIME_TYPES, assertSubmissionEligibility } from "./submissionEligibility.js";
import { managementLock } from "./catalog.js";
export const VIDEO_UPLOAD_TTL_MS = 30 * 60 * 1000;
export const MAX_COMPLETION_TIME_MS = 2_147_483_647;


export interface VideoUploadRecord {
  videoUploadId: string;
  playerId: string;
  publicId: string;
  mimeType: string;
  declaredSizeBytes: number;
  status: "SIGNED" | "COMPLETE" | "FAILED" | "EXPIRED";
  expiresAt: Date;
  verifiedSizeBytes?: number | null;
  durationMs?: number | null;
}

export interface SubmissionDto {
  id: string;
  playerPuzzleId: string;
  puzzleId: string;
  puzzleName: string;
  levelId: number;
  completionTimeMs: number;
  completionTime: string;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "RESUBMISSION_REQUIRED";
  createdAt: string;
  videoUploadId: string;
  reviewNote?: string;
}

export interface SubmissionRepository {
  abandonVideoUpload?(playerId: string, videoUploadId: string): Promise<void>;
  createVideoUpload(input: { playerId: string; publicId: string; filename: string; mimeType: string; sizeBytes: number; expiresAt: Date }): Promise<VideoUploadRecord>;
  getVideoUpload(videoUploadId: string): Promise<VideoUploadRecord | null>;
  completeVideoUpload(videoUploadId: string, asset: VerifiedVideoAsset): Promise<void>;
  failVideoUpload(videoUploadId: string, failureCode: string): Promise<void>;
  expireVideoUpload(videoUploadId: string): Promise<void>;
  createSubmission(input: { playerId: string; playerPuzzleId: string; completionTimeMs: number; videoUploadId: string; idempotencyKey?: string }): Promise<SubmissionDto>;
  getSubmissions(playerId: string): Promise<SubmissionDto[]>;
  getSubmission(playerId: string, submissionId: string): Promise<SubmissionDto | null>;
}

export class SubmissionService {
  constructor(private repo: SubmissionRepository, private storage: VideoStorage) {}

  async signVideoUpload(playerId: string, input: { filename: string; mimeType: string; sizeBytes: number }) {
    if (!this.storage.configured) throw new AppError("VIDEO_STORAGE_NOT_CONFIGURED", "Video storage is not configured.", 503);
    if (!VIDEO_MIME_TYPES.has(input.mimeType.toLowerCase())) throw validationFailed("Unsupported video MIME type.");
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_VIDEO_SIZE_BYTES) {
      throw validationFailed(`Video size must be between 1 byte and 100 MB (${MAX_VIDEO_SIZE_BYTES} bytes).`);
    }
    const videoUploadId = crypto.randomUUID();
    const publicId = `circzles/submissions/${playerId}/${videoUploadId}`;
    const expiresAt = new Date(Date.now() + VIDEO_UPLOAD_TTL_MS);
    const record = await this.repo.createVideoUpload({ ...input, playerId, publicId, expiresAt });
    const signed = await this.storage.signUpload(publicId);
    return { videoUploadId: record.videoUploadId, expiresAt: expiresAt.toISOString(), ...signed };
  }

  async completeVideoUpload(playerId: string, videoUploadId: string) {
    if (!this.storage.configured) throw new AppError("VIDEO_STORAGE_NOT_CONFIGURED", "Video storage is not configured.", 503);
    const upload = await this.repo.getVideoUpload(videoUploadId);
    if (!upload || upload.playerId !== playerId) throw new AppError("VIDEO_UPLOAD_NOT_FOUND", "Video upload was not found.", 404);
    if (upload.status === "COMPLETE") return { videoUploadId, status: "COMPLETE" as const, sizeBytes: upload.verifiedSizeBytes, durationMs: upload.durationMs };
    if (upload.status === "SIGNED" && upload.expiresAt <= new Date()) {
      await this.repo.expireVideoUpload(videoUploadId);
      throw new AppError("VIDEO_UPLOAD_NOT_FINALIZABLE", "Video upload cannot be finalized.", 409);
    }
    if (upload.status !== "SIGNED") throw new AppError("VIDEO_UPLOAD_NOT_FINALIZABLE", "Video upload cannot be finalized.", 409);
    try {
      const asset = await this.storage.verifyUpload(upload.publicId);
      if (asset.publicId !== upload.publicId || asset.resourceType !== "video" || !Number.isSafeInteger(asset.durationMs) || !asset.durationMs || asset.durationMs <= 0 || asset.durationMs > MAX_COMPLETION_TIME_MS) throw new AppError("VIDEO_UPLOAD_METADATA_INVALID", "The video duration could not be verified.", 422);
      if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > MAX_VIDEO_SIZE_BYTES) throw new AppError("VIDEO_UPLOAD_SIZE_INVALID", "Verified video size must be between 1 byte and 100 MB (100,000,000 bytes).", 422);
      await this.repo.completeVideoUpload(videoUploadId, asset);
      return { videoUploadId, status: "COMPLETE" as const, sizeBytes: asset.bytes, durationMs: asset.durationMs };
    } catch (error) {
      // Keep SIGNED for retryable provider/processing/database failures; expiration still applies.
      if (error instanceof AppError && ["VIDEO_UPLOAD_SIZE_INVALID", "VIDEO_UPLOAD_METADATA_INVALID"].includes(error.code)) await this.repo.failVideoUpload(videoUploadId, "VERIFICATION_FAILED");
      throw error;
    }
  }

  createSubmission(playerId: string, input: { playerPuzzleId: string; completionTimeMs: number; videoUploadId: string }, idempotencyKey?: string) {
    if (!Number.isInteger(input.completionTimeMs) || input.completionTimeMs <= 0 || input.completionTimeMs > MAX_COMPLETION_TIME_MS) {
      throw validationFailed(`Completion time must be an integer between 1 and ${MAX_COMPLETION_TIME_MS} milliseconds.`);
    }
    return this.repo.createSubmission({ playerId, ...input, idempotencyKey });
  }
  async abandonVideoUpload(playerId: string, videoUploadId: string) {
    if (!this.repo.abandonVideoUpload) throw new AppError("VIDEO_STORAGE_NOT_CONFIGURED", "Upload cleanup is unavailable.", 503);
    await this.repo.abandonVideoUpload(playerId, videoUploadId);
    return { removed: true };
  }
  getSubmissions(playerId: string) { return this.repo.getSubmissions(playerId); }
  async getSubmission(playerId: string, submissionId: string) {
    const result = await this.repo.getSubmission(playerId, submissionId);
    if (!result) throw new AppError("SUBMISSION_NOT_FOUND", "Submission was not found.", 404);
    return result;
  }
}

export class DrizzleSubmissionRepository implements SubmissionRepository {
  constructor(private db: Db, private storage?: VideoStorage) {}

  async abandonVideoUpload(playerId: string, videoUploadId: string) {
    if (!this.storage?.deleteUpload) throw new AppError("VIDEO_STORAGE_NOT_CONFIGURED", "Upload cleanup is unavailable.", 503);
    await this.db.transaction(async tx => {
      await managementLock(tx);
      const [upload] = await tx.select().from(videoUploads).where(and(eq(videoUploads.videoUploadId, videoUploadId), eq(videoUploads.playerId, playerId))).for("update");
      if (!upload) throw new AppError("VIDEO_UPLOAD_NOT_FOUND", "Video upload was not found.", 404);
      const [used] = await tx.select().from(submissions).where(eq(submissions.videoUploadId, videoUploadId));
      if (used) throw new AppError("VIDEO_UPLOAD_ALREADY_USED", "Submitted recordings cannot be removed.", 409);
      // Mark terminal before deletion; the transaction lock excludes concurrent submission creation.
      await tx.update(videoUploads).set({ status: "EXPIRED" }).where(eq(videoUploads.videoUploadId, videoUploadId));
      await this.storage!.deleteUpload!(upload.publicId);
      await tx.update(videoUploads).set({ failureCode: "ABANDONED_REMOVED" }).where(eq(videoUploads.videoUploadId, videoUploadId));
    });
  }
  async createVideoUpload(input: { playerId: string; publicId: string; filename: string; mimeType: string; sizeBytes: number; expiresAt: Date }) {
    const [row] = await this.db.insert(videoUploads).values({ playerId: input.playerId, storageProvider: "CLOUDINARY", publicId: input.publicId, originalFilename: input.filename, mimeType: input.mimeType, declaredSizeBytes: input.sizeBytes, expiresAt: input.expiresAt }).returning();
    return toVideoUploadRecord(row);
  }
  async getVideoUpload(videoUploadId: string) {
    const [row] = await this.db.select().from(videoUploads).where(eq(videoUploads.videoUploadId, videoUploadId)).limit(1);
    return row ? toVideoUploadRecord(row) : null;
  }
  async completeVideoUpload(videoUploadId: string, asset: VerifiedVideoAsset) {
    const [updated] = await this.db.update(videoUploads).set({ status: "COMPLETE", verifiedSizeBytes: asset.bytes, durationMs: asset.durationMs, completedAt: new Date(), failureCode: null }).where(and(eq(videoUploads.videoUploadId, videoUploadId), eq(videoUploads.status, "SIGNED"), sql`${videoUploads.expiresAt} > now()`)).returning();
    if (!updated && (await this.getVideoUpload(videoUploadId))?.status !== "COMPLETE") throw new AppError("VIDEO_UPLOAD_NOT_FINALIZABLE", "Video upload expired or was abandoned.", 409);
  }
  async failVideoUpload(videoUploadId: string, failureCode: string) {
    await this.db.update(videoUploads).set({ status: "FAILED", failureCode }).where(and(eq(videoUploads.videoUploadId, videoUploadId), eq(videoUploads.status, "SIGNED")));
  }
  async expireVideoUpload(videoUploadId: string) {
    await this.db.update(videoUploads).set({ status: "EXPIRED" }).where(and(eq(videoUploads.videoUploadId, videoUploadId), eq(videoUploads.status, "SIGNED")));
  }

  async createSubmission(input: { playerId: string; playerPuzzleId: string; completionTimeMs: number; videoUploadId: string; idempotencyKey?: string }) {
    try {
      return await this.db.transaction(async (tx) => {
        await managementLock(tx);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.playerId}:${input.idempotencyKey ?? input.videoUploadId}`}, 0))`);
        if (input.idempotencyKey) {
          const existing = await selectSubmissions(tx).where(and(eq(submissions.playerId, input.playerId), eq(submissions.idempotencyKey, input.idempotencyKey))).limit(1);
          if (existing[0]) {
            if (existing[0].submission.playerPuzzleId !== input.playerPuzzleId || existing[0].submission.completionTimeMs !== input.completionTimeMs || existing[0].submission.videoUploadId !== input.videoUploadId) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different submission.", 409);
            return toSubmissionDto(existing[0]);
          }
        }
        const [owned] = await tx.select({ playerPuzzle: playerPuzzles, puzzle: puzzles }).from(playerPuzzles).innerJoin(puzzles, eq(playerPuzzles.puzzleId, puzzles.puzzleId)).where(and(eq(playerPuzzles.playerPuzzleId, input.playerPuzzleId), eq(playerPuzzles.playerId, input.playerId), isNull(playerPuzzles.deletedAt), eq(puzzles.status, "ACTIVE"), isNull(puzzles.deletedAt))).limit(1);
        if (!owned) throw new AppError("PLAYER_PUZZLE_NOT_FOUND", "Owned CircZles was not found.", 404);
        const [upload] = await tx.select().from(videoUploads).where(and(eq(videoUploads.videoUploadId, input.videoUploadId), eq(videoUploads.playerId, input.playerId))).limit(1);
        if (!upload) throw new AppError("VIDEO_UPLOAD_NOT_FOUND", "Video upload was not found.", 404);
        if (upload.status !== "COMPLETE") throw new AppError("VIDEO_UPLOAD_NOT_COMPLETE", "Video upload has not been verified.", 409);
        const [setting] = await tx.select().from(puzzleCompetitionSettings).where(eq(puzzleCompetitionSettings.puzzleId, owned.puzzle.puzzleId));
        assertSubmissionEligibility(owned.puzzle.name, setting?.maxLeaderboardTimeMs, input.completionTimeMs, upload);
        if (!this.storage) throw new AppError("VIDEO_STORAGE_NOT_CONFIGURED", "Video verification is unavailable.", 503);
        const asset = await this.storage.verifyUpload(upload.publicId);
        if (asset.publicId !== upload.publicId || asset.bytes !== upload.verifiedSizeBytes || asset.durationMs !== upload.durationMs) throw new AppError("VIDEO_UPLOAD_METADATA_INVALID", "Video metadata changed; upload a new recording.", 422);
        const [created] = await tx.insert(submissions).values({ playerId: input.playerId, playerPuzzleId: owned.playerPuzzle.playerPuzzleId, puzzleId: owned.puzzle.puzzleId, levelId: owned.puzzle.levelId, completionTimeMs: input.completionTimeMs, videoUploadId: input.videoUploadId, idempotencyKey: input.idempotencyKey, status: "PENDING_REVIEW" }).returning();
        await insertGameEventInTransaction(tx, {
          playerId: input.playerId, eventType: "submission.created", sourceType: "SUBMISSION", sourceId: created.submissionId,
          idempotencyKey: `submission.created:${created.submissionId}`,
          payload: { submissionId: created.submissionId, puzzleId: created.puzzleId, playerPuzzleId: created.playerPuzzleId, levelId: Number(created.levelId), completionTimeMs: created.completionTimeMs },
        });
        return toSubmissionDto({ submission: created, puzzle: owned.puzzle });
      });
    } catch (error) {
      const wrapped = error as { cause?: { code?: string; constraint?: string }; code?: string; constraint?: string };
      const pgError = wrapped.cause ?? wrapped;
      if (pgError.code === "23505" && input.idempotencyKey) {
        const [existing] = await selectSubmissions(this.db).where(and(eq(submissions.playerId, input.playerId), eq(submissions.idempotencyKey, input.idempotencyKey))).limit(1);
        if (existing) {
          if (existing.submission.playerPuzzleId !== input.playerPuzzleId || existing.submission.completionTimeMs !== input.completionTimeMs || existing.submission.videoUploadId !== input.videoUploadId) {
            throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different submission.", 409);
          }
          return toSubmissionDto(existing);
        }
        if (pgError.constraint === "submissions_player_id_idempotency_key_unique") throw new AppError("SUBMISSION_CREATE_FAILED", "Submission could not be created.", 409);
      }
      if (pgError.code === "23505" && pgError.constraint === "submissions_video_upload_id_unique") throw new AppError("VIDEO_UPLOAD_ALREADY_USED", "Video upload has already been used for a submission.", 409);
      throw error;
    }
  }

  async getSubmissions(playerId: string) {
    const rows = await selectSubmissions(this.db).where(eq(submissions.playerId, playerId)).orderBy(desc(submissions.createdAt));
    return rows.map(toSubmissionDto);
  }
  async getSubmission(playerId: string, submissionId: string) {
    const [row] = await selectSubmissions(this.db).where(and(eq(submissions.playerId, playerId), eq(submissions.submissionId, submissionId))).limit(1);
    return row ? toSubmissionDto(row) : null;
  }
}

function selectSubmissions(db: Pick<Db, "select">) {
  return db.select({ submission: submissions, puzzle: puzzles, reviewNote: sql<string | null>`(select review_note from submission_reviews where submission_id = ${submissions.submissionId} order by created_at desc limit 1)` }).from(submissions).innerJoin(puzzles, eq(submissions.puzzleId, puzzles.puzzleId));
}
function toVideoUploadRecord(row: typeof videoUploads.$inferSelect): VideoUploadRecord {
  return { videoUploadId: row.videoUploadId, playerId: row.playerId, publicId: row.publicId, mimeType: row.mimeType, declaredSizeBytes: row.declaredSizeBytes, status: row.status, expiresAt: row.expiresAt, verifiedSizeBytes: row.verifiedSizeBytes, durationMs: row.durationMs };
}
function toSubmissionDto(row: { submission: typeof submissions.$inferSelect; puzzle: typeof puzzles.$inferSelect; reviewNote?: string | null }): SubmissionDto {
  const ms = row.submission.completionTimeMs;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000) % 60;
  const seconds = Math.floor(ms / 1000) % 60;
  const millis = ms % 1000;
  const base = hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return { reviewNote: row.reviewNote ?? undefined, id: row.submission.submissionId, playerPuzzleId: row.submission.playerPuzzleId, puzzleId: row.submission.puzzleId, puzzleName: row.puzzle.name, levelId: Number(row.submission.levelId), completionTimeMs: ms, completionTime: millis ? `${base}.${String(millis).padStart(3, "0")}` : base, status: row.submission.status, createdAt: row.submission.createdAt.toISOString(), videoUploadId: row.submission.videoUploadId };
}
