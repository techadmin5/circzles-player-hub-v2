// Player-owned read-only API contract; checked against the backend in its test environment.
export interface PlayerMissionHistoryEntry {
  entitlementId: string; missionId: string; title: string; titleSource: "CURRENT_DEFINITION"; periodKey: string;
  state: "IN_PROGRESS" | "UNCLAIMED" | "EXPIRED" | "CAPACITY_PENDING" | "CAPACITY_BLOCKED" | "RECOVERED" | "PAID" | "REVIEW_REQUIRED";
  completionState: "IN_PROGRESS" | "CLAIMABLE" | "CLAIMED";
  claimState: "UNCLAIMED" | "PAID" | "UNKNOWN";
  progress: { current: number; target: number };
  rewards: { xp: number; synapsePoints: number } | null;
  rewardSource: "CLAIM_SNAPSHOT" | "EARNED_SNAPSHOT" | "CAPACITY_SNAPSHOT" | "UNAVAILABLE";
  recordedAt: string; completedAt: string | null; claimedAt: string | null;
  periodStartsAt: string | null; periodEndsAt: string | null; claimDeadline: string | null;
  capacity: { status: "PENDING" | "BLOCKED" | "RECOVERED"; arrivedAt: string; recordedAt: string; updatedAt: string | null } | null;
}
export interface PlayerMissionHistoryPage { entries: PlayerMissionHistoryEntry[]; nextCursor: string | null }
