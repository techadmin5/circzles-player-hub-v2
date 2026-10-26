import { and, eq, sql } from "drizzle-orm";
import { missionChests, missionChestEligibility } from "../db/missionChestSchema.js";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { adminUsers, missions } from "../db/schema.js";
import { missionAdminHistory, missionLifecycleOperations, type MissionAdminSnapshot } from "../db/missionAdminSchema.js";
import { AppError, forbidden, validationFailed } from "./errors.js";
import { evaluateMissionReadiness } from "./adminMissionReadiness.js";
import { readMissionApprovalContractInTransaction } from "./missionApprovalContract.js";
import { validateAdminMissionSchedule } from "./adminMissionScheduling.js";

export interface MissionLifecycleResult {
  operationId: string; missionId: string; action: "ACTIVATE" | "DEACTIVATE";
  changed: boolean; active: boolean; missionRevision: string; activationEffectiveAt: string;
  occurredAt: string; idempotent: boolean;
  authorizedConfiguration: { revision: string; digest: string; productApprovalId: string; rewardBudgetApprovalId: string } | null;
}
const schema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  configurationDigest: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().uuid(),
}).strict();

export async function changeMissionLifecycle(db: Database, id: string, action: "ACTIVATE" | "DEACTIVATE", input: unknown, actorId: string, clock = () => new Date()): Promise<MissionLifecycleResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw validationFailed("Provide the loaded mission revision, configuration digest and a unique UUID idempotency key only.");
  const request = { ...parsed.data, expectedUpdatedAt: new Date(parsed.data.expectedUpdatedAt).toISOString() };
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('mission-chest-lifecycle',0))`);
    // Same parent lock as configuration/approval writes; M1 processing holds FOR SHARE.
    const [mission] = await tx.select().from(missions).where(eq(missions.missionId, id)).for("update");
    if (!mission) throw new AppError("MISSION_NOT_FOUND", "Mission was not found.", 404);
    const [actor] = await tx.select().from(adminUsers).where(eq(adminUsers.adminUserId, actorId)).for("share");
    if (!actor?.active || actor.role !== "SUPER_ADMIN") throw forbidden("Only an active SUPER_ADMIN may change mission lifecycle.");
    const [previous] = await tx.select().from(missionLifecycleOperations).where(and(eq(missionLifecycleOperations.missionId, id), eq(missionLifecycleOperations.idempotencyKey, request.idempotencyKey)));
    if (previous) {
      if (previous.actorAdminUserId !== actorId || previous.action !== action || previous.request.expectedUpdatedAt !== request.expectedUpdatedAt || previous.request.configurationDigest !== request.configurationDigest) throw new AppError("MISSION_LIFECYCLE_KEY_CONFLICT", "This operation key belongs to a different request. Reload mission details.", 409);
      // Replay the original receipt, never reapply an old activation after deactivation.
      return { ...previous.result, idempotent: true };
    }
    // Read time after acquiring the lock, so waiting requests cannot use an expired window.
    const now = clock();
    const contract = await readMissionApprovalContractInTransaction(tx, id, now);
    if (request.expectedUpdatedAt !== mission.updatedAt.toISOString() || request.configurationDigest !== contract.binding.configurationDigest) throw new AppError("MISSION_REVISION_CONFLICT", "Mission configuration changed. Reload details and review readiness and approvals.", 409);
    let authorizedConfiguration: MissionLifecycleResult["authorizedConfiguration"] = null;
    let cutoff = mission.activationEffectiveAt;
    if (action === "ACTIVATE") {
      // Already-active requests need their original operation key; new keys cannot bypass review.
      if (mission.active) throw new AppError("MISSION_ALREADY_ACTIVE", "Mission is already active. Reload details; retry only with the original operation key.", 409);
      const readiness = await evaluateMissionReadiness(tx, id, now);
      if (!readiness.activationReady) throw new AppError("MISSION_ACTIVATION_BLOCKED", `Activation blocked: ${readiness.checks.filter(check => check.status === "BLOCKED").map(check => check.code).join(", ")}.`, 409);
      const product = contract.categories.find(item => item.category === "PRODUCT"), budget = contract.categories.find(item => item.category === "REWARD_BUDGET");
      if (product?.status !== "APPROVED" || budget?.status !== "APPROVED" || !product.recordedApproval || !budget.recordedApproval) throw new AppError("MISSION_APPROVAL_REQUIRED", "Two current revision/digest-bound approvals are required.", 409);
      for (const approval of [product.recordedApproval, budget.recordedApproval]) {
        if (approval.xp !== contract.rewards.xp || approval.synapsePoints !== contract.rewards.synapsePoints) throw new AppError("MISSION_APPROVAL_REQUIRED", "Recorded approval amounts do not match the configured reward.", 409);
      }
      authorizedConfiguration = { revision: contract.binding.approvedConfigurationRevision, digest: contract.binding.configurationDigest, productApprovalId: product.recordedApproval.approvalId, rewardBudgetApprovalId: budget.recordedApproval.approvalId };
      cutoff = new Date(Math.max(mission.activationEffectiveAt.getTime(), now.getTime()));
      validateAdminMissionSchedule({ ...mission, activationEffectiveAt: cutoff }, mission);
    }
    if(action === "DEACTIVATE" && mission.active) {
      const [linked] = await tx.select({ id: missionChests.chestId }).from(missionChestEligibility).innerJoin(missionChests,eq(missionChests.chestId,missionChestEligibility.chestId)).where(and(eq(missionChestEligibility.missionId,id),eq(missionChestEligibility.active,true),eq(missionChests.active,true)));
      if(linked) throw new AppError("MISSION_ACTIVE_CHEST_DEPENDENCY","Deactivate the linked chest before deactivating this mission. Earned rewards are retained.",409);
    }
    const active = action === "ACTIVATE", changed = mission.active !== active;
    const updatedAt = changed ? new Date(Math.max(now.getTime(), mission.updatedAt.getTime() + 1)) : mission.updatedAt;
    const operationId = crypto.randomUUID();
    const result: MissionLifecycleResult = { operationId, missionId: id, action, changed, active, missionRevision: updatedAt.toISOString(), activationEffectiveAt: cutoff.toISOString(), occurredAt: now.toISOString(), idempotent: false, authorizedConfiguration };
    if (changed) await tx.update(missions).set({ active, updatedAt, activationEffectiveAt: cutoff }).where(eq(missions.missionId, id));
    await tx.insert(missionLifecycleOperations).values({ operationId, missionId: id, actorAdminUserId: actorId, action, idempotencyKey: request.idempotencyKey, request, result, occurredAt: now });
    const before: MissionAdminSnapshot = { title: mission.title, description: mission.description, category: mission.category, periodType: mission.periodType, displayOrder: mission.displayOrder, active: mission.active, updatedAt: mission.updatedAt.toISOString(), schedule: { startsAt: mission.startsAt?.toISOString() ?? null, endsAt: mission.endsAt?.toISOString() ?? null, claimDeadline: mission.claimDeadline?.toISOString() ?? null, activationEffectiveAt: mission.activationEffectiveAt.toISOString() } };
    await tx.insert(missionAdminHistory).values({ missionId: id, actorAdminUserId: actorId, occurredAt: now, action: active ? "MISSION_ACTIVATED" : "MISSION_DEACTIVATED", before, after: { ...before, active, updatedAt: updatedAt.toISOString(), schedule: { ...before.schedule!, activationEffectiveAt: cutoff.toISOString() }, lifecycleOperation: result } });
    return result;
  });
}
