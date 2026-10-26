// JSON-only contract; backend tests verify this against the service response.
export const adminMissionCategories = ["DAILY", "WEEKLY", "SPRINT", "SEASON", "EVENT", "ACHIEVEMENT"] as const;
export interface AdminMissionDto {
  missionId: string; title: string; description: string; category: string; periodType: string;
  active: boolean; displayOrder: number; updatedAt: string;
  startsAt: string | null; endsAt: string | null; claimDeadline: string | null; activationEffectiveAt: string;
  lifecycle: "INACTIVE" | "SCHEDULED" | "ACTIVE" | "ENDED";
  configurationIssues: string[];
  rule: { eventType: string; targetCount: number; sourceType: string | null; puzzleId: string | null; levelId: number | null; conditions: Record<string, string | number | boolean | null>; active: boolean } | null;
  rewards: { rewardType: string; amount: number; active: boolean }[];
}
export interface AdminMissionPage { missions: AdminMissionDto[]; limit: number; offset: number; hasMore: boolean }
export interface AdminMissionSnapshot {
  title: string; description: string; displayOrder: number;
  category: string; periodType: string; active: boolean; updatedAt: string;
  rule?: AdminMissionDto["rule"];
  schedule?: Pick<AdminMissionDto, "startsAt" | "endsAt" | "claimDeadline" | "activationEffectiveAt">;
  rewards?: AdminMissionDto["rewards"];
  lifecycleOperation?: MissionLifecycleResult;
  approval?: { category: "PRODUCT" | "REWARD_BUDGET"; status: "MISSING" | "APPROVED" | "REVOKED" | "INVALIDATED"; approvalId: string | null; revocationId: string | null; revision: string; digest: string; xp: number | null; synapsePoints: number | null };
}
export interface AdminMissionHistoryEntry {
  historyId: string; missionId: string; actorAdminUserId: string;
  action: "DRAFT_CREATED" | "METADATA_UPDATED" | "RULE_CONFIGURED" | "SCHEDULE_CONFIGURED" | "REWARDS_CONFIGURED" | "APPROVAL_GRANTED" | "APPROVAL_REVOKED" | "MISSION_ACTIVATED" | "MISSION_DEACTIVATED"; occurredAt: string;
  before: AdminMissionSnapshot | null; after: AdminMissionSnapshot;
}
export interface AdminMissionHistoryPage { entries: AdminMissionHistoryEntry[]; limit: number; offset: number; hasMore: boolean }
export interface AdminMissionRuleOptions { options: { eventType: string; label: string; sourceType: string }[] }
export interface AdminMissionRuleInput extends Omit<NonNullable<AdminMissionDto["rule"]>, "conditions"> { conditions: Record<string, never>; expectedUpdatedAt: string }
export interface AdminMissionScheduleInput { startsAt: string | null; endsAt: string | null; claimDeadline: string | null; expectedUpdatedAt: string }
export interface AdminMissionRewardsInput { xp: number | null; synapsePoints: number | null; expectedUpdatedAt: string }
export interface AdminMissionReadinessCheck {
  code: string; status: "PASS" | "BLOCKED" | "WARNING";
  category: "CONFIGURATION" | "SAFETY" | "PRODUCT" | "ADVISORY";
  field: string; message: string;
}
export interface AdminMissionReadinessDto {
  missionId: string; missionRevision: string; evaluatedAt: string;
  configurationStatus: "PASS" | "BLOCKED"; overallStatus: "PASS" | "BLOCKED" | "WARNING";
  activationReady: boolean; productApproval: "NOT_RECORDED" | "APPROVED";
  rewardSafety: { xp: number | null; synapsePoints: number | null; spWalletLimit: number; maximumSafeSpBalance: number | null; maximumSafeXpTotal: number | null; balancesInspected: false };
  checks: AdminMissionReadinessCheck[];
}
export interface MissionApprovalBinding { missionId: string; approvedConfigurationRevision: string; configurationDigest: string }
export interface MissionApprovalRecord extends MissionApprovalBinding {
  approvalId: string; approvalCategory: "PRODUCT" | "REWARD_BUDGET"; approverAdminUserId: string; approvedAt: string;
  xp: number; synapsePoints: number; revocationId: string | null; revokedByAdminUserId: string | null; revokedAt: string | null;
}
export type MissionApprovalStatus = "MISSING" | "APPROVED" | "REVOKED" | "INVALIDATED";
export interface MissionApprovalContractDto {
  binding: MissionApprovalBinding; evaluatedAt: string; missionInactive: boolean;
  recordingEnabled: boolean; allowsActivation: false;
  rewards: { xp: number | null; synapsePoints: number | null };
  categories: { category: "PRODUCT" | "REWARD_BUDGET"; status: MissionApprovalStatus; recordedApproval: MissionApprovalRecord | null; requiredDecisions: string[] }[];
  recordContract: { requiredFields: string[]; actorSource: "AUTHENTICATED_SERVER_SESSION"; timestampSource: "SERVER_UTC"; auditRequirement: "SAME_TRANSACTION_AS_APPROVAL"; freshnessRequirement: "REVISION_AND_DIGEST_MUST_MATCH" };
}


export interface MissionLifecycleResult {
  operationId: string; missionId: string; action: "ACTIVATE" | "DEACTIVATE";
  changed: boolean; active: boolean; missionRevision: string; activationEffectiveAt: string;
  occurredAt: string; idempotent: boolean;
  authorizedConfiguration: { revision: string; digest: string; productApprovalId: string; rewardBudgetApprovalId: string } | null;
}

export interface MissionCapacityDto {
  exceptionId: string; missionId: string; playerId: string; progressId: string; periodKey: string;
  arrivedAt: string; recordedAt: string; claimDeadline: string | null; xp: number; synapsePoints: number;
  digest: string; status: "PENDING" | "RECOVERED"; revision: string;
  history: { eventId: string; action: "OPENED" | "RECOVERY_BLOCKED" | "RECOVERED"; actorAdminUserId: string | null; occurredAt: string; reason: string; errorCode: string | null; claimId: string | null }[];
}
