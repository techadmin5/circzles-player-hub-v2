import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema.js";
import { players, puzzles, submissions, videoUploads, puzzleCompetitionSettings, submissionReviews, adminUsers, users } from "../db/schema.js";
import type { VideoStorage } from "../storage/videoStorage.js";
import { AppError } from "./errors.js";

type Db = NodePgDatabase<typeof schema>;
export type ReviewQueueStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "RESUBMISSION_REQUIRED";

export interface AdminSubmissionFilter {
  status: ReviewQueueStatus;
  puzzleId?: string;
  levelId?: number;
  limit: number;
}

export interface AdminSubmissionDto {
  submissionId: string;
  status: ReviewQueueStatus;
  submittedAt: string;
  completionTimeMs: number;
  levelId: number;
  puzzleId: string;
  puzzleName: string;
  runCode?: string;
  player: { publicPlayerId: string; displayName: string };
  playerPuzzleId: string;
  maxLeaderboardTimeMs?: number | null;
  reviewHistory?: { decision: string; reviewNote: string | null; reviewerAdminUserId: string; reviewerName?: string; createdAt: Date }[];
  video: {
    videoUploadId: string;
    storageProvider: string;
    publicId: string;
    mimeType: string;
    declaredSizeBytes: number;
    verifiedSizeBytes?: number;
    durationMs?: number;
    status: "SIGNED" | "COMPLETE" | "FAILED" | "EXPIRED";
    completedAt?: string;
  };
}

export interface AdminSubmissionRepository {
  list(filter: AdminSubmissionFilter): Promise<AdminSubmissionDto[]>;
  get(submissionId: string): Promise<AdminSubmissionDto | null>;
}

export class AdminSubmissionService {
  constructor(private repo: AdminSubmissionRepository, private storage?: VideoStorage) {}
  async video(submissionId: string) {
    const submission = await this.get(submissionId);
    if (!this.storage?.viewingUrl) throw new AppError("VIDEO_STORAGE_NOT_CONFIGURED", "Protected video viewing is unavailable.", 503);
    return { url: await this.storage.viewingUrl(submission.video.publicId), expiresInSeconds: 300 };
  }
  list(filter: AdminSubmissionFilter) { return this.repo.list(filter); }
  async get(submissionId: string) {
    const submission = await this.repo.get(submissionId);
    if (!submission) throw new AppError("SUBMISSION_NOT_FOUND", "Submission was not found.", 404);
    return submission;
  }
}

export class DrizzleAdminSubmissionRepository implements AdminSubmissionRepository {
  constructor(private db: Db) {}

  async list(filter: AdminSubmissionFilter) {
    const conditions = [eq(submissions.status, filter.status)];
    if (filter.puzzleId) conditions.push(eq(submissions.puzzleId, filter.puzzleId));
    if (filter.levelId !== undefined) conditions.push(eq(submissions.levelId, filter.levelId));
    const rows = await selectAdminSubmissions(this.db).where(and(...conditions)).orderBy(asc(submissions.submittedAt), asc(submissions.submissionId)).limit(filter.limit);
    return rows.map(toAdminSubmissionDto);
  }

  async get(submissionId: string) {
    const [row] = await selectAdminSubmissions(this.db).where(eq(submissions.submissionId, submissionId)).limit(1);
    return row ? { ...toAdminSubmissionDto(row), reviewHistory: await this.db.select({ decision: submissionReviews.decision, reviewNote: submissionReviews.reviewNote, reviewerAdminUserId: submissionReviews.reviewerAdminUserId, reviewerName: sql<string>`coalesce(${players.displayName}, ${users.verifiedEmail})`, createdAt: submissionReviews.createdAt }).from(submissionReviews).innerJoin(adminUsers, eq(adminUsers.adminUserId, submissionReviews.reviewerAdminUserId)).innerJoin(users, eq(users.userId, adminUsers.userId)).leftJoin(players, eq(players.userId, users.userId)).where(eq(submissionReviews.submissionId, submissionId)) } : null;
  }
}

function selectAdminSubmissions(db: Pick<Db, "select">) {
  return db.select({ submission: submissions, puzzle: puzzles, player: players, video: videoUploads, maximum: puzzleCompetitionSettings.maxLeaderboardTimeMs })
    .from(submissions)
    .innerJoin(puzzles, eq(puzzles.puzzleId, submissions.puzzleId))
    .innerJoin(players, eq(players.playerId, submissions.playerId))
    .innerJoin(videoUploads, eq(videoUploads.videoUploadId, submissions.videoUploadId))
    .leftJoin(puzzleCompetitionSettings, eq(puzzleCompetitionSettings.puzzleId, submissions.puzzleId));
}

function toAdminSubmissionDto(row: { submission: typeof submissions.$inferSelect; puzzle: typeof puzzles.$inferSelect; player: typeof players.$inferSelect; video: typeof videoUploads.$inferSelect; maximum: number | null }): AdminSubmissionDto {
  return {
    maxLeaderboardTimeMs: row.maximum,
    submissionId: row.submission.submissionId,
    status: row.submission.status,
    submittedAt: row.submission.submittedAt.toISOString(),
    completionTimeMs: row.submission.completionTimeMs,
    levelId: Number(row.submission.levelId),
    puzzleId: row.submission.puzzleId,
    puzzleName: row.puzzle.name,
    runCode: row.puzzle.runCode ?? undefined,
    player: { publicPlayerId: row.player.publicPlayerId, displayName: row.player.displayName },
    playerPuzzleId: row.submission.playerPuzzleId,
    video: {
      videoUploadId: row.video.videoUploadId,
      storageProvider: row.video.storageProvider,
      publicId: row.video.publicId,
      mimeType: row.video.mimeType,
      declaredSizeBytes: row.video.declaredSizeBytes,
      verifiedSizeBytes: row.video.verifiedSizeBytes ?? undefined,
      durationMs: row.video.durationMs ?? undefined,
      status: row.video.status,
      completedAt: row.video.completedAt?.toISOString(),
    },
  };
}
