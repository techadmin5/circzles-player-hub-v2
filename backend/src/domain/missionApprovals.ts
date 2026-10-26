import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { adminUsers, missions } from "../db/schema.js";
import { missionApprovals, missionApprovalRevocations, missionAdminHistory, type MissionAdminSnapshot } from "../db/missionAdminSchema.js";
import { AppError, forbidden, validationFailed } from "./errors.js";
import { evaluateMissionReadiness } from "./adminMissionReadiness.js";
import { missionApprovalCategories, readMissionApprovalContractInTransaction, type MissionApprovalContractDto } from "./missionApprovalContract.js";

const identifier = z.string().regex(/^[1-9]\d{0,18}$/).refine(value => BigInt(value) <= 9223372036854775807n);
const inputSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }), configurationDigest: z.string().regex(/^[a-f0-9]{64}$/),
  expectedApprovalId: identifier.nullable(), expectedRevocationId: identifier.nullable(),
}).strict();
export async function changeMissionApproval(db: Database, id: string, categoryInput: unknown, input: unknown, actorId: string, revoke: boolean, now = new Date()) {
  const category = z.enum(missionApprovalCategories).safeParse(categoryInput), parsed = inputSchema.safeParse(input);
  if (!category.success || !parsed.success) throw validationFailed("Provide an approval category, current mission revision/digest and the loaded approval/revocation IDs only.");
  const selectedCategory = category.data;
  return db.transaction(async tx => {
    // Shared parent lock serializes grants, revocations and all M2 configuration edits.
    const [mission] = await tx.select().from(missions).where(eq(missions.missionId, id)).for("update");
    if (!mission) throw new AppError("MISSION_NOT_FOUND", "Mission was not found.", 404);
    const [actor] = await tx.select().from(adminUsers).where(eq(adminUsers.adminUserId, actorId)).for("share");
    if (!actor || actor.role !== "SUPER_ADMIN" || !actor.active) throw forbidden("Only an active SUPER_ADMIN may grant or revoke approvals.");
    const before = await readMissionApprovalContractInTransaction(tx, id, now);
    if (new Date(parsed.data.expectedUpdatedAt).getTime() !== mission.updatedAt.getTime() || parsed.data.configurationDigest !== before.binding.configurationDigest) throw new AppError("MISSION_REVISION_CONFLICT", "Mission configuration changed. Reload and review before approving or revoking.", 409);
    const current = before.categories.find(item => item.category === selectedCategory)!;
    if ((current.recordedApproval?.approvalId ?? null) !== parsed.data.expectedApprovalId || (current.recordedApproval?.revocationId ?? null) !== parsed.data.expectedRevocationId) throw new AppError("MISSION_APPROVAL_CONFLICT", "Approval history changed. Reload before continuing.", 409);
    if (revoke) {
      if (!current.recordedApproval || current.recordedApproval.revocationId) throw new AppError("MISSION_APPROVAL_CONFLICT", "No unrevoked approval matches this request.", 409);
      await tx.insert(missionApprovalRevocations).values({ approvalId: BigInt(current.recordedApproval.approvalId), actorAdminUserId: actorId, revokedAt: now });
    } else {
      if (mission.active) throw new AppError("MISSION_APPROVAL_LOCKED", "Only inactive missions can receive approvals.", 409);
      if (current.status === "APPROVED") throw new AppError("MISSION_APPROVAL_CONFLICT", "This configuration already has this approval.", 409);
      const readiness = await evaluateMissionReadiness(tx, id, now);
      if (readiness.checks.some(check => check.status === "BLOCKED" && check.category !== "PRODUCT")) throw new AppError("MISSION_APPROVAL_NOT_READY", "Resolve technical configuration and safety blockers before recording approval.", 409);
      if (before.rewards.xp === null || before.rewards.synapsePoints === null) throw validationFailed("Complete the XP/SP configuration before approval.");
      await tx.insert(missionApprovals).values({ missionId: id, category: selectedCategory, configurationRevision: mission.updatedAt, configurationDigest: before.binding.configurationDigest, approverAdminUserId: actorId, approvedAt: now, xp: before.rewards.xp, synapsePoints: before.rewards.synapsePoints });
    }
    const after = await readMissionApprovalContractInTransaction(tx, id, now);
    function snapshot(contract: MissionApprovalContractDto): MissionAdminSnapshot {
      const item = contract.categories.find(item => item.category === selectedCategory)!;
      return { title: mission.title, description: mission.description, displayOrder: mission.displayOrder, category: mission.category, periodType: mission.periodType, active: mission.active, updatedAt: mission.updatedAt.toISOString(),
        approval: { category: selectedCategory, status: item.status, approvalId: item.recordedApproval?.approvalId ?? null, revocationId: item.recordedApproval?.revocationId ?? null, revision: item.recordedApproval?.approvedConfigurationRevision ?? contract.binding.approvedConfigurationRevision, digest: item.recordedApproval?.configurationDigest ?? contract.binding.configurationDigest, xp: item.recordedApproval?.xp ?? contract.rewards.xp, synapsePoints: item.recordedApproval?.synapsePoints ?? contract.rewards.synapsePoints } };
    }
    await tx.insert(missionAdminHistory).values({ missionId: id, actorAdminUserId: actorId, action: revoke ? "APPROVAL_REVOKED" : "APPROVAL_GRANTED", occurredAt: now, before: snapshot(before), after: snapshot(after) });
    return after;
  });
}
