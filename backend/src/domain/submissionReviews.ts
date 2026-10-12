import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import {
  puzzleCompetitionSettings,
  submissionReviews,
  submissionRewardGrants,
  submissions, videoUploads, puzzles, playerPuzzles,
} from "../db/schema.js";
import type { VideoStorage } from "../storage/videoStorage.js";
import { assertSubmissionEligibility } from "./submissionEligibility.js";
import { managementLock } from "./catalog.js";
import { AppError, validationFailed } from "./errors.js";
import { creditPointsInTransaction, grantXpInTransaction } from "./gameState.js";
import { processPersonalBestInTransaction } from "./leaderboards.js";
import { insertGameEventInTransaction } from "./gameEvents.js";

export type SubmissionReviewDecision = "APPROVED" | "REJECTED" | "RESUBMISSION_REQUIRED";

export interface SubmissionReviewInput {
  reviewerAdminUserId: string;
  submissionId: string;
  decision: SubmissionReviewDecision;
  reviewNote?: string;
  idempotencyKey: string;
}

export interface SubmissionReviewResult {
  submissionReviewId: string;
  submissionId: string;
  decision: SubmissionReviewDecision;
  reviewNote?: string;
  reviewedAt: string;
  idempotent: boolean;
  firstCompletionProcessed: boolean;
  rewardGrant?: {
    submissionRewardGrantId: string;
    rewardEnabledSnapshot: boolean;
    synapseReward: number;
    xpReward: number;
    pointTransactionId?: string;
    xpTransactionId?: string;
  };
}

export interface SubmissionReviewRepository {
  review(input: SubmissionReviewInput): Promise<SubmissionReviewResult>;
}

export class SubmissionReviewService {
  constructor(private repo: SubmissionReviewRepository) {}

  review(input: SubmissionReviewInput) {
    if (!input.reviewerAdminUserId || !input.submissionId) throw validationFailed("Reviewer and submission identifiers are required.");
    if (!input.idempotencyKey?.trim()) throw validationFailed("Idempotency key is required.");
    if (!["APPROVED", "REJECTED", "RESUBMISSION_REQUIRED"].includes(input.decision)) throw validationFailed("Invalid submission review decision.");
    if (input.reviewNote !== undefined && input.reviewNote.length > 2000) throw validationFailed("Review note must be at most 2000 characters.");
    return this.repo.review({ ...input, idempotencyKey: input.idempotencyKey.trim() });
  }
}

export class DrizzleSubmissionReviewRepository implements SubmissionReviewRepository {
  constructor(private db: Database, private storage?: VideoStorage) {}

  review(input: SubmissionReviewInput) {
    return this.db.transaction(async (tx) => {
      await managementLock(tx);
      const [submission] = await tx.select().from(submissions).where(eq(submissions.submissionId, input.submissionId)).limit(1).for("update");
      if (!submission) throw new AppError("SUBMISSION_NOT_FOUND", "Submission was not found.", 404);

      // Serialize a reviewer's idempotency key even when concurrent requests target different submissions.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.reviewerAdminUserId}:${input.idempotencyKey}`}, 0))`);
      const [existingReview] = await tx.select().from(submissionReviews).where(and(
        eq(submissionReviews.reviewerAdminUserId, input.reviewerAdminUserId),
        eq(submissionReviews.idempotencyKey, input.idempotencyKey),
      )).limit(1);
      if (existingReview) {
        assertReviewIdempotencyMatch(existingReview, input);
        return reviewResult(tx, existingReview, true);
      }

      if (submission.status !== "PENDING_REVIEW") {
        throw new AppError("SUBMISSION_ALREADY_REVIEWED", "Submission has already been reviewed.", 409, { status: submission.status });
      }

      let timingProof: { maxLeaderboardTimeMs: number; verifiedVideoDurationMs: number } | undefined;
      if (input.decision === "APPROVED") {
        const [owned] = await tx.select().from(playerPuzzles).where(and(eq(playerPuzzles.playerPuzzleId, submission.playerPuzzleId), eq(playerPuzzles.playerId, submission.playerId), eq(playerPuzzles.puzzleId, submission.puzzleId), isNull(playerPuzzles.deletedAt)));
        if (!owned) throw validationFailed("This CircZles is no longer owned by the submitting player.");
        const [video] = await tx.select().from(videoUploads).where(eq(videoUploads.videoUploadId, submission.videoUploadId));
        const [puzzle] = await tx.select().from(puzzles).where(eq(puzzles.puzzleId, submission.puzzleId));
        const [policy] = await tx.select().from(puzzleCompetitionSettings).where(eq(puzzleCompetitionSettings.puzzleId, submission.puzzleId));
        if (!video || video.playerId !== submission.playerId || !puzzle || puzzle.status !== "ACTIVE" || puzzle.deletedAt) throw validationFailed("Submission media or CircZles is no longer available.");
        assertSubmissionEligibility(puzzle.name, policy?.maxLeaderboardTimeMs, submission.completionTimeMs, video);
        if (!this.storage) throw new AppError("VIDEO_STORAGE_NOT_CONFIGURED", "Video verification is unavailable.", 503);
        const verified = await this.storage.verifyUpload(video.publicId);
        if (verified.publicId !== video.publicId || verified.bytes !== video.verifiedSizeBytes || verified.durationMs !== video.durationMs) throw validationFailed("The video changed or could not be verified.");
        timingProof = { maxLeaderboardTimeMs: policy!.maxLeaderboardTimeMs!, verifiedVideoDurationMs: video.durationMs! };
      }
      const [review] = await tx.insert(submissionReviews).values({
        submissionId: submission.submissionId,
        reviewerAdminUserId: input.reviewerAdminUserId,
        decision: input.decision,
        reviewNote: input.reviewNote,
        idempotencyKey: input.idempotencyKey,
      }).returning();
      if (!review) throw new AppError("SUBMISSION_REVIEW_FAILED", "Could not record submission review.", 500);

      await tx.update(submissions).set({ status: input.decision, updatedAt: new Date() }).where(eq(submissions.submissionId, submission.submissionId));

      const reviewEventType = input.decision === "APPROVED" ? "submission.approved" : input.decision === "REJECTED" ? "submission.rejected" : "submission.resubmission_required";
      await insertGameEventInTransaction(tx, {
        playerId: submission.playerId, eventType: reviewEventType, sourceType: "SUBMISSION_REVIEW", sourceId: review.submissionReviewId,
        idempotencyKey: `${reviewEventType}:${submission.submissionId}`,
        payload: { submissionId: submission.submissionId, puzzleId: submission.puzzleId, levelId: Number(submission.levelId), completionTimeMs: submission.completionTimeMs, decision: input.decision, ...timingProof },
      });

      if (input.decision === "APPROVED") {
        const [setting] = await tx.select().from(puzzleCompetitionSettings).where(and(
          eq(puzzleCompetitionSettings.puzzleId, submission.puzzleId),
          eq(puzzleCompetitionSettings.active, true),
        )).limit(1);
        const rewardEnabled = setting?.rewardEnabled === true;
        const synapseReward = rewardEnabled ? setting.synapseReward : 0;
        const xpReward = rewardEnabled ? setting.xpReward : 0;
        const [grant] = await tx.insert(submissionRewardGrants).values({
          playerId: submission.playerId,
          puzzleId: submission.puzzleId,
          submissionId: submission.submissionId,
          rewardEnabledSnapshot: rewardEnabled,
          synapseReward,
          xpReward,
        }).onConflictDoNothing({ target: [submissionRewardGrants.playerId, submissionRewardGrants.puzzleId] }).returning();

        if (grant) {
          const metadata = { puzzleId: submission.puzzleId };
          const pointResult = synapseReward > 0 ? await creditPointsInTransaction(tx, {
            playerId: submission.playerId,
            amount: synapseReward,
            reason: "First approved puzzle completion",
            sourceType: "submission.first_completion",
            sourceId: submission.submissionId,
            idempotencyKey: `submission:first-completion:${submission.playerId}:${submission.puzzleId}:sp`,
            metadata,
          }) : undefined;
          const xpResult = xpReward > 0 ? await grantXpInTransaction(tx, {
            playerId: submission.playerId,
            amount: xpReward,
            reason: "First approved puzzle completion",
            sourceType: "submission.first_completion",
            sourceId: submission.submissionId,
            idempotencyKey: `submission:first-completion:${submission.playerId}:${submission.puzzleId}:xp`,
            metadata,
          }) : undefined;
          if (pointResult || xpResult) await tx.update(submissionRewardGrants).set({
            pointTransactionId: pointResult?.transactionId,
            xpTransactionId: xpResult?.transactionId,
          }).where(eq(submissionRewardGrants.submissionRewardGrantId, grant.submissionRewardGrantId));
        }

        const personalBest = await processPersonalBestInTransaction(tx, {
          playerId: submission.playerId,
          puzzleId: submission.puzzleId,
          submissionId: submission.submissionId,
          completionTimeMs: submission.completionTimeMs,
          approvedAt: review.createdAt,
          submittedAt: submission.submittedAt,
        });
        if (personalBest.improved) {
          await insertGameEventInTransaction(tx, {
            playerId: submission.playerId, eventType: "personal_best.improved", sourceType: "SUBMISSION", sourceId: submission.submissionId,
            idempotencyKey: `personal_best.improved:${submission.submissionId}`,
            payload: { submissionId: submission.submissionId, puzzleId: submission.puzzleId, levelId: Number(submission.levelId), completionTimeMs: submission.completionTimeMs, previousBestTimeMs: personalBest.previousBestTimeMs, newBestTimeMs: personalBest.newBestTimeMs },
          });
        }
      }

      return reviewResult(tx, review, false);
    });
  }
}

type ReviewRow = typeof submissionReviews.$inferSelect;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function assertReviewIdempotencyMatch(existing: ReviewRow, input: SubmissionReviewInput) {
  if (existing.submissionId !== input.submissionId || existing.decision !== input.decision || existing.reviewNote !== (input.reviewNote ?? null)) {
    throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different submission review.", 409, { idempotencyKey: input.idempotencyKey });
  }
}

async function reviewResult(tx: Transaction, review: ReviewRow, idempotent: boolean): Promise<SubmissionReviewResult> {
  const [grant] = await tx.select().from(submissionRewardGrants).where(eq(submissionRewardGrants.submissionId, review.submissionId)).limit(1);
  return {
    submissionReviewId: review.submissionReviewId,
    submissionId: review.submissionId,
    decision: review.decision,
    reviewNote: review.reviewNote ?? undefined,
    reviewedAt: review.createdAt.toISOString(),
    idempotent,
    firstCompletionProcessed: Boolean(grant),
    rewardGrant: grant ? {
      submissionRewardGrantId: grant.submissionRewardGrantId,
      rewardEnabledSnapshot: grant.rewardEnabledSnapshot,
      synapseReward: grant.synapseReward,
      xpReward: grant.xpReward,
      pointTransactionId: grant.pointTransactionId ?? undefined,
      xpTransactionId: grant.xpTransactionId ?? undefined,
    } : undefined,
  };
}
