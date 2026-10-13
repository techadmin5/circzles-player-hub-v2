// JSON transport contract. No database, storage SDK, or server imports belong here.
export type ReviewQueueStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "RESUBMISSION_REQUIRED";
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
  completionRewards?: { active: boolean; rewardEnabled: boolean; synapseReward: number; xpReward: number; alreadyProcessed: boolean; grantedSynapseReward: number | null; grantedXpReward: number | null };
  reviewHistory?: {
    decision: string;
    reviewNote: string | null;
    reviewerAdminUserId: string;
    reviewerName?: string;
    createdAt: string;
  }[];
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
