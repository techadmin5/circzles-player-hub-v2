import { createHash } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { missions, missionRules, missionRewards } from "../db/schema.js";
import { missionApprovals, missionApprovalRevocations } from "../db/missionAdminSchema.js";
import type { GameStateTransaction } from "./gameState.js";
import { freezeRewards, snapshotTotals } from "./missionLifecycle.js";
import { AppError, validationFailed } from "./errors.js";

export const missionApprovalCategories = ["PRODUCT", "REWARD_BUDGET"] as const;
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

// Freshness equality alone does NOT authenticate an approver or constitute approval.
export function matchesMissionApprovalBinding(record: MissionApprovalBinding, current: MissionApprovalBinding) {
  return record.missionId === current.missionId && record.approvedConfigurationRevision === current.approvedConfigurationRevision && record.configurationDigest === current.configurationDigest;
}
function canonical(value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) throw validationFailed("Cannot bind non-finite mission configuration.");
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export async function readMissionApprovalContract(db: Database, id: string, now = new Date()): Promise<MissionApprovalContractDto> {
  return db.transaction(tx => readMissionApprovalContractInTransaction(tx, id, now), { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function readMissionApprovalContractInTransaction(tx: GameStateTransaction, id: string, now = new Date()): Promise<MissionApprovalContractDto> {
    const [row] = await tx.select().from(missions).where(eq(missions.missionId, id));
    if (!row) throw new AppError("MISSION_NOT_FOUND", "Mission was not found.", 404);
    const [rule] = await tx.select().from(missionRules).where(eq(missionRules.missionId, id));
    const rewards = await tx.select().from(missionRewards).where(eq(missionRewards.missionId, id)).orderBy(asc(missionRewards.displayOrder), asc(missionRewards.missionRewardId));
    const revision = row.updatedAt.toISOString();
    // Invalid legacy schedule values must remain inspectable and fail the
    // readiness validator, rather than crashing approval inspection first.
    const stamp = (date: Date | null) => date === null ? null : Number.isFinite(date.getTime()) ? date.toISOString() : "INVALID_TIMESTAMP";
    const configuration = {
      missionId: id, revision, title: row.title, description: row.description, category: row.category, periodType: row.periodType, active: row.active, displayOrder: row.displayOrder,
      startsAt: stamp(row.startsAt), endsAt: stamp(row.endsAt), claimDeadline: stamp(row.claimDeadline), activationEffectiveAt: stamp(row.activationEffectiveAt),
      rule: rule ? { eventType: rule.eventType, targetCount: rule.targetCount, sourceType: rule.sourceType, puzzleId: rule.puzzleId, levelId: rule.levelId, conditions: rule.conditions, active: rule.active } : null,
      rewards: rewards.map(reward => ({ rewardType: reward.rewardType, amount: reward.amount, active: reward.active, displayOrder: reward.displayOrder })),
    };
    const digest = createHash("sha256").update(JSON.stringify(canonical(configuration))).digest("hex");
    const binding = { missionId: id, approvedConfigurationRevision: revision, configurationDigest: digest };
    let totals: { xp: number | null; synapsePoints: number | null } = { xp: null, synapsePoints: null };
    try { totals = snapshotTotals(freezeRewards(rewards.filter(reward => reward.active))); } catch (error) { if (!(error instanceof AppError)) throw error; }
    const categories: MissionApprovalContractDto["categories"] = [];
    for (const category of missionApprovalCategories) {
      const [approval] = await tx.select().from(missionApprovals).where(and(eq(missionApprovals.missionId, id), eq(missionApprovals.category, category))).orderBy(desc(missionApprovals.approvalId)).limit(1);
      const [revocation] = approval ? await tx.select().from(missionApprovalRevocations).where(eq(missionApprovalRevocations.approvalId, approval.approvalId)) : [];
      const recordedApproval: MissionApprovalRecord | null = approval ? {
        missionId: id, approvalId: String(approval.approvalId), approvalCategory: category, approvedConfigurationRevision: approval.configurationRevision.toISOString(), configurationDigest: approval.configurationDigest,
        approverAdminUserId: approval.approverAdminUserId, approvedAt: approval.approvedAt.toISOString(), xp: approval.xp, synapsePoints: approval.synapsePoints,
        revocationId: revocation ? String(revocation.revocationId) : null, revokedByAdminUserId: revocation?.actorAdminUserId ?? null, revokedAt: revocation?.revokedAt.toISOString() ?? null,
      } : null;
      const status = !recordedApproval ? "MISSING" : revocation ? "REVOKED" : matchesMissionApprovalBinding(recordedApproval, binding) ? "APPROVED" : "INVALIDATED";
      categories.push({ category, status, recordedApproval, requiredDecisions: [] });
    }
    return {
      binding, evaluatedAt: now.toISOString(), missionInactive: !row.active, recordingEnabled: !row.active, allowsActivation: false, rewards: totals, categories,
      recordContract: { requiredFields: ["missionId", "approvedConfigurationRevision", "configurationDigest", "approvalCategory", "approverAdminUserId", "approvedAt"], actorSource: "AUTHENTICATED_SERVER_SESSION", timestampSource: "SERVER_UTC", auditRequirement: "SAME_TRANSACTION_AS_APPROVAL", freshnessRequirement: "REVISION_AND_DIGEST_MUST_MATCH" },
    };
}
