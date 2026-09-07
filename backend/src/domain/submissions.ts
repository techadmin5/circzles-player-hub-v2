import { and, desc, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema.js";
import { playerPuzzles, puzzles, submissions, videoUploads } from "../db/schema.js";
import type { VideoStorage, VerifiedVideoAsset } from "../storage/videoStorage.js";
import { AppError, validationFailed } from "./errors.js";

type Db = NodePgDatabase<typeof schema>;
export const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;
export const VIDEO_UPLOAD_TTL_MS = 30 * 60 * 1000;
const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"]);

export interface VideoUploadRecord {
  videoUploadId: string;
  playerId: string;
  publicId: string;
  mimeType: string;
  declaredSizeBytes: number;
  status: "SIGNED" | "COMPLETE" | "FAILED" | "EXPIRED";
  expiresAt: Date;
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
}

export interface SubmissionRepository {
  createVideoUpload(input: { playerId: string; publicId: string; filename: string; mimeType: string; sizeBytes: number; expiresAt: Date }): Promise<VideoUploadRecord>;
  getVideoUpload(videoUploadId: string): Promise<VideoUploadRecord | null>;
  completeVideoUpload(videoUploadId: string, asset: VerifiedVideoAsset): Promise<void>;
  failVideoUpload(videoUploadId: string, failureCode: string): Promise<void>;
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
      throw validationFailed(`Video size must be between 1 and ${MAX_VIDEO_SIZE_BYTES} bytes.`);
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
    if (upload.status === "COMPLETE") return { videoUploadId, status: "COMPLETE" as const };
    if (upload.status !== "SIGNED" || upload.expiresAt <= new Date()) throw new AppError("VIDEO_UPLOAD_NOT_FINALIZABLE", "Video upload cannot be finalized.", 409);
    try {
      const asset = await this.storage.verifyUpload(upload.publicId);
      if (asset.bytes <= 0 || asset.bytes > MAX_VIDEO_SIZE_BYTES) throw new AppError("VIDEO_UPLOAD_SIZE_INVALID", "Verified video size is outside the allowed limit.", 422);
      await this.repo.completeVideoUpload(videoUploadId, asset);
      return { videoUploadId, status: "COMPLETE" as const, sizeBytes: asset.bytes, durationMs: asset.durationMs };
    } catch (error) {
      await this.repo.failVideoUpload(videoUploadId, "VERIFICATION_FAILED");
      throw error;
    }
  }

  createSubmission(playerId: string, input: { playerPuzzleId: string; completionTimeMs: number; videoUploadId: string }, idempotencyKey?: string) {
    return this.repo.createSubmission({ playerId, ...input, idempotencyKey });
  }
  getSubmissions(playerId: string) { return this.repo.getSubmissions(playerId); }
  async getSubmission(playerId: string, submissionId: string) {
    const result = await this.repo.getSubmission(playerId, submissionId);
    if (!result) throw new AppError("SUBMISSION_NOT_FOUND", "Submission was not found.", 404);
    return result;
  }
}

export class DrizzleSubmissionRepository implements SubmissionRepository {
  constructor(private db: Db) {}

  async createVideoUpload(input: { playerId: string; publicId: string; filename: string; mimeType: string; sizeBytes: number; expiresAt: Date }) {
    const [row] = await this.db.insert(videoUploads).values({ playerId: input.playerId, storageProvider: "CLOUDINARY", publicId: input.publicId, originalFilename: input.filename, mimeType: input.mimeType, declaredSizeBytes: input.sizeBytes, expiresAt: input.expiresAt }).returning();
    return toVideoUploadRecord(row);
  }
  async getVideoUpload(videoUploadId: string) {
    const [row] = await this.db.select().from(videoUploads).where(eq(videoUploads.videoUploadId, videoUploadId)).limit(1);
    return row ? toVideoUploadRecord(row) : null;
  }
  async completeVideoUpload(videoUploadId: string, asset: VerifiedVideoAsset) {
    await this.db.update(videoUploads).set({ status: "COMPLETE", verifiedSizeBytes: asset.bytes, durationMs: asset.durationMs, completedAt: new Date(), failureCode: null }).where(eq(videoUploads.videoUploadId, videoUploadId));
  }
  async failVideoUpload(videoUploadId: string, failureCode: string) {
    await this.db.update(videoUploads).set({ status: "FAILED", failureCode }).where(eq(videoUploads.videoUploadId, videoUploadId));
  }

  async createSubmission(input: { playerId: string; playerPuzzleId: string; completionTimeMs: number; videoUploadId: string; idempotencyKey?: string }) {
    try {
      return await this.db.transaction(async (tx) => {
        if (input.idempotencyKey) {
          const existing = await selectSubmissions(tx).where(and(eq(submissions.playerId, input.playerId), eq(submissions.idempotencyKey, input.idempotencyKey))).limit(1);
          if (existing[0]) {
            if (existing[0].submission.playerPuzzleId !== input.playerPuzzleId || existing[0].submission.completionTimeMs !== input.completionTimeMs || existing[0].submission.videoUploadId !== input.videoUploadId) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different submission.", 409);
            return toSubmissionDto(existing[0]);
          }
        }
        const [owned] = await tx.select({ playerPuzzle: playerPuzzles, puzzle: puzzles }).from(playerPuzzles).innerJoin(puzzles, eq(playerPuzzles.puzzleId, puzzles.puzzleId)).where(and(eq(playerPuzzles.playerPuzzleId, input.playerPuzzleId), eq(playerPuzzles.playerId, input.playerId), isNull(playerPuzzles.deletedAt), eq(puzzles.status, "ACTIVE"), isNull(puzzles.deletedAt))).limit(1);
        if (!owned) throw new AppError("PLAYER_PUZZLE_NOT_FOUND", "Owned puzzle was not found.", 404);
        const [upload] = await tx.select().from(videoUploads).where(and(eq(videoUploads.videoUploadId, input.videoUploadId), eq(videoUploads.playerId, input.playerId))).limit(1);
        if (!upload) throw new AppError("VIDEO_UPLOAD_NOT_FOUND", "Video upload was not found.", 404);
        if (upload.status !== "COMPLETE") throw new AppError("VIDEO_UPLOAD_NOT_COMPLETE", "Video upload has not been verified.", 409);
        const [created] = await tx.insert(submissions).values({ playerId: input.playerId, playerPuzzleId: owned.playerPuzzle.playerPuzzleId, puzzleId: owned.puzzle.puzzleId, levelId: owned.puzzle.levelId, completionTimeMs: input.completionTimeMs, videoUploadId: input.videoUploadId, idempotencyKey: input.idempotencyKey, status: "PENDING_REVIEW" }).returning();
        return toSubmissionDto({ submission: created, puzzle: owned.puzzle });
      });
    } catch (error) {
      const pgError = error as { code?: string; constraint?: string };
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
  return db.select({ submission: submissions, puzzle: puzzles }).from(submissions).innerJoin(puzzles, eq(submissions.puzzleId, puzzles.puzzleId));
}
function toVideoUploadRecord(row: typeof videoUploads.$inferSelect): VideoUploadRecord {
  return { videoUploadId: row.videoUploadId, playerId: row.playerId, publicId: row.publicId, mimeType: row.mimeType, declaredSizeBytes: row.declaredSizeBytes, status: row.status, expiresAt: row.expiresAt };
}
function toSubmissionDto(row: { submission: typeof submissions.$inferSelect; puzzle: typeof puzzles.$inferSelect }): SubmissionDto {
  const ms = row.submission.completionTimeMs;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000) % 60;
  const seconds = Math.floor(ms / 1000) % 60;
  const millis = ms % 1000;
  const base = hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return { id: row.submission.submissionId, playerPuzzleId: row.submission.playerPuzzleId, puzzleId: row.submission.puzzleId, puzzleName: row.puzzle.name, levelId: row.submission.levelId, completionTimeMs: ms, completionTime: millis ? `${base}.${String(millis).padStart(3, "0")}` : base, status: row.submission.status, createdAt: row.submission.createdAt.toISOString(), videoUploadId: row.submission.videoUploadId };
}
