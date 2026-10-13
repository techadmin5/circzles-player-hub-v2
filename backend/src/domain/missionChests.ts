import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { missionChestClaims, missionChestCompletions, missionChestEligibility, missionChests, missionProcessingFailures, playerMissionChests } from "../db/missionChestSchema.js";
import { missions, playerMissionProgress } from "../db/schema.js";
import { AppError, validationFailed } from "./errors.js";
import { insertGameEventInTransaction } from "./gameEvents.js";
import { creditPointsInTransaction, getPlayerGameStateInTransaction, grantXpInTransaction, type GameStateTransaction } from "./gameState.js";
import { claimDeadlineFor, periodBounds, periodKeyFor, snapshotTotals } from "./missionLifecycle.js";

export function validateChest(definition: typeof missionChests.$inferSelect) {
  if (!["DAILY", "WEEKLY"].includes(definition.periodType) || !Number.isInteger(definition.targetCount) || definition.targetCount <= 0) throw validationFailed("Invalid chest period or target.");
  if ([definition.activationEffectiveAt, definition.startsAt, definition.endsAt].some(at => at && !Number.isFinite(at.getTime())) || (definition.startsAt && definition.endsAt && definition.endsAt <= definition.startsAt)) throw validationFailed("Invalid chest date window.");
  snapshotTotals(definition.rewards);
}
export async function validateChestEligibility(tx: GameStateTransaction, chest: typeof missionChests.$inferSelect) {
  validateChest(chest);
  const associations = await tx.select({ eligibility: missionChestEligibility, mission: missions }).from(missionChestEligibility).innerJoin(missions, eq(missions.missionId, missionChestEligibility.missionId)).where(and(eq(missionChestEligibility.chestId, chest.chestId), eq(missionChestEligibility.active, true)));
  if (chest.active && associations.length < chest.targetCount) throw validationFailed("Chest has fewer eligible missions than its target.");
  for (const row of associations) {
    if (row.mission.periodType !== chest.periodType || row.mission.category !== chest.periodType || (chest.active && !row.mission.active) || row.eligibility.effectiveAt < row.mission.activationEffectiveAt || row.eligibility.effectiveAt < chest.activationEffectiveAt) throw validationFailed("Invalid chest mission eligibility or activation time.");
  }
}

// Called only inside the original qualifying event transaction, never from mission reward claims.
export async function recordChestCompletion(tx: GameStateTransaction, progress: typeof playerMissionProgress.$inferSelect, mission: typeof missions.$inferSelect, eventId: string) {
  if (!progress.completedAt || !["DAILY", "WEEKLY"].includes(mission.periodType)) return;
  const associations = await tx.select({ chest: missionChests, eligibility: missionChestEligibility }).from(missionChestEligibility).innerJoin(missionChests, eq(missionChests.chestId, missionChestEligibility.chestId)).where(and(eq(missionChestEligibility.missionId, mission.missionId), eq(missionChestEligibility.active, true), eq(missionChests.active, true))).orderBy(missionChests.chestId);
  for (const association of associations) {
    try {
      // Savepoints isolate bad chest configuration without losing the earned mission reward.
      await tx.transaction(async nested => {
        const [chest] = await nested.select().from(missionChests).where(eq(missionChests.chestId, association.chest.chestId)).for("share");
        const [eligibility] = await nested.select().from(missionChestEligibility).where(eq(missionChestEligibility.eligibilityId, association.eligibility.eligibilityId)).for("share");
        if (!chest?.active || !eligibility?.active) return;
        const at = progress.completedAt!;
        await nested.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`chest-definition:${chest.chestId}`}, 0))`);
        await validateChestEligibility(nested, chest);
        if (chest.periodType !== mission.periodType || at < eligibility.effectiveAt || at < chest.activationEffectiveAt || at < mission.activationEffectiveAt || (chest.startsAt && at < chest.startsAt) || (chest.endsAt && at >= chest.endsAt)) return;
        const periodType = chest.periodType as "DAILY" | "WEEKLY";
        if (periodKeyFor(periodType, at, chest.chestId) !== progress.periodKey) return;
        const bounds = periodBounds(periodType, progress.periodKey, chest.chestId);
        await nested.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`chest:${progress.playerId}:${chest.chestId}:${progress.periodKey}`}, 0))`);
        let [state] = await nested.select().from(playerMissionChests).where(and(eq(playerMissionChests.playerId, progress.playerId), eq(playerMissionChests.chestId, chest.chestId), eq(playerMissionChests.periodKey, progress.periodKey))).for("update");
        if (!state) [state] = await nested.insert(playerMissionChests).values({ playerId: progress.playerId, chestId: chest.chestId, periodKey: progress.periodKey, targetCountSnapshot: chest.targetCount, periodStartsAt: bounds.start!, periodEndsAt: bounds.end!, claimDeadline: claimDeadlineFor(periodType, bounds.end, null)! }).returning();
        const inserted = await nested.insert(missionChestCompletions).values({ playerChestId: state.playerChestId, missionId: mission.missionId, playerMissionProgressId: progress.playerMissionProgressId, gameEventId: eventId, eligibilityId: eligibility.eligibilityId, eligibilityEffectiveAt: eligibility.effectiveAt, completedAt: at }).onConflictDoNothing().returning();
        if (!inserted.length || state.unlockedAt) return;
        const currentCount = Math.min(state.targetCountSnapshot, state.currentCount + 1);
        await nested.update(playerMissionChests).set({ currentCount, ...(currentCount === state.targetCountSnapshot ? { unlockedAt: at, rewardSnapshot: chest.rewards } : {}) }).where(eq(playerMissionChests.playerChestId, state.playerChestId));
      });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      await tx.insert(missionProcessingFailures).values({ gameEventId: eventId, entityType: "CHEST", entityId: association.chest.chestId, errorCode: error.code }).onConflictDoNothing();
    }
  }
}

export interface ChestClaimInput { playerId: string; chestId: string; periodKey: string; idempotencyKey: string; now?: Date }
export class MissionChestService {
  constructor(private db: Database) {}
  async list(playerId: string, now = new Date()) {
    const definitions = await this.db.select().from(missionChests).orderBy(missionChests.chestId);
    const states = await this.db.select().from(playerMissionChests).where(eq(playerMissionChests.playerId, playerId));
    const result = [];
    for (const chest of definitions) {
      const current = periodKeyFor(chest.periodType as "DAILY" | "WEEKLY", now, chest.chestId);
      const visible = chest.active && now >= chest.activationEffectiveAt && (!chest.startsAt || now >= chest.startsAt) && (!chest.endsAt || now < chest.endsAt);
      if (visible) { validateChest(chest); result.push(chestDto(chest, states.find(state => state.chestId === chest.chestId && state.periodKey === current), current, now)); }
      for (const state of states.filter(state => state.chestId === chest.chestId && state.unlockedAt && !state.claimedAt && now < state.claimDeadline && (state.periodKey !== current || !visible))) result.push(chestDto(chest, state, state.periodKey, now));
    }
    return result;
  }
  async claim(input: ChestClaimInput) {
    if (!input.idempotencyKey.trim() || input.idempotencyKey.trim().length > 200) throw validationFailed("A valid Idempotency-Key is required.");
    const result = await this.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`chest-key:${input.playerId}:${input.idempotencyKey}`}, 0))`);
      const [replay] = await tx.select().from(missionChestClaims).where(and(eq(missionChestClaims.playerId, input.playerId), eq(missionChestClaims.idempotencyKey, input.idempotencyKey)));
      if (replay) {
        if (replay.chestId !== input.chestId || replay.periodKey !== input.periodKey) throw new AppError("IDEMPOTENCY_CONFLICT", "Key was used for another chest period.", 409);
        return chestClaimResult(tx, replay, true);
      }
      const [state] = await tx.select().from(playerMissionChests).where(and(eq(playerMissionChests.playerId, input.playerId), eq(playerMissionChests.chestId, input.chestId), eq(playerMissionChests.periodKey, input.periodKey))).for("update");
      if (!state?.unlockedAt) throw new AppError("CHEST_NOT_CLAIMABLE", "Chest is not unlocked.", 409);
      if (state.claimedAt) throw new AppError("CHEST_ALREADY_CLAIMED", "Chest was already claimed.", 409);
      if ((input.now ?? new Date()) >= state.claimDeadline) {
        await tx.update(playerMissionChests).set({ expiredAt: state.expiredAt ?? state.claimDeadline }).where(eq(playerMissionChests.playerChestId, state.playerChestId));
        return null;
      }
      const reward = snapshotTotals(state.rewardSnapshot);
      const [claim] = await tx.insert(missionChestClaims).values({ playerChestId: state.playerChestId, playerId: input.playerId, chestId: input.chestId, periodKey: input.periodKey, rewardSnapshot: state.rewardSnapshot!, idempotencyKey: input.idempotencyKey }).returning();
      const metadata = { chestId: input.chestId, periodKey: input.periodKey, chestClaimId: claim.chestClaimId };
      const ledger = { playerId: input.playerId, reason: "Mission chest reward", sourceType: "MISSION_CHEST_REWARD", sourceId: claim.chestClaimId, metadata };
      const points = reward.synapsePoints ? await creditPointsInTransaction(tx, { ...ledger, amount: reward.synapsePoints, idempotencyKey: `chest.sp:${state.playerChestId}` }) : undefined;
      const xp = reward.xp ? await grantXpInTransaction(tx, { ...ledger, amount: reward.xp, idempotencyKey: `chest.xp:${state.playerChestId}` }) : undefined;
      const [updated] = await tx.update(missionChestClaims).set({ pointTransactionId: points?.transactionId, xpTransactionId: xp?.transactionId }).where(eq(missionChestClaims.chestClaimId, claim.chestClaimId)).returning();
      await tx.update(playerMissionChests).set({ claimedAt: claim.createdAt }).where(eq(playerMissionChests.playerChestId, state.playerChestId));
      await insertGameEventInTransaction(tx, { playerId: input.playerId, eventType: "mission.chest_claimed", sourceType: "MISSION_CHEST", sourceId: claim.chestClaimId, idempotencyKey: `chest.claimed:${state.playerChestId}`, payload: metadata });
      return chestClaimResult(tx, updated, false);
    });
    if (!result) throw new AppError("CHEST_CLAIM_EXPIRED", "Chest claim deadline has passed.", 410);
    return result;
  }
}
function chestDto(chest: typeof missionChests.$inferSelect, state: typeof playerMissionChests.$inferSelect | undefined, periodKey: string, now: Date) {
  const bounds = periodBounds(chest.periodType as "DAILY" | "WEEKLY", periodKey, chest.chestId);
  const deadline = state?.claimDeadline ?? claimDeadlineFor(chest.periodType as "DAILY" | "WEEKLY", bounds.end, null)!;
  return { chestId: chest.chestId, title: chest.title, periodType: chest.periodType, periodKey, progress: { current: state?.currentCount ?? 0, target: state?.targetCountSnapshot ?? chest.targetCount }, periodStartsAt: bounds.start, periodEndsAt: bounds.end, claimDeadline: deadline, status: state?.claimedAt ? "CLAIMED" : now >= deadline ? "EXPIRED" : state?.unlockedAt ? "CLAIMABLE" : "IN_PROGRESS", claimable: !!state?.unlockedAt && !state.claimedAt && now < deadline, rewards: state?.rewardSnapshot ?? chest.rewards };
}
async function chestClaimResult(tx: GameStateTransaction, claim: typeof missionChestClaims.$inferSelect, idempotent: boolean) {
  const state = await getPlayerGameStateInTransaction(tx, claim.playerId);
  return { chestClaimId: claim.chestClaimId, chestId: claim.chestId, periodKey: claim.periodKey, status: "CLAIMED", idempotent, claimedAt: claim.createdAt, awarded: snapshotTotals(claim.rewardSnapshot), playerState: { synapsePoints: state.synapsePoints, xp: state.totalXp, progressionLevel: state.progressionLevel, rankName: state.rankName } };
}
