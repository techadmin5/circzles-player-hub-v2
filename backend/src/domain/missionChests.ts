import { recordChestCapacityException, findChestCapacityException, pendingCapacityError } from "./chestCapacityExceptions.js";
import { checkedPointChange, checkedXpGrant } from "./rewardArithmetic.js";
import { and, eq, sql, desc, lt, or } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { chestCapacityExceptions, chestCapacityEvents, chestCapacityRequests, missionChestClaims, missionChestCompletions, missionChestEligibility, missionChests, missionProcessingFailures, playerMissionChests } from "../db/missionChestSchema.js";
import { missions, playerMissionProgress, playerProgression } from "../db/schema.js";
import { AppError, validationFailed } from "./errors.js";
import { insertGameEventInTransaction } from "./gameEvents.js";
import { creditPointsInTransaction, getPlayerGameStateInTransaction, grantXpInTransaction, lockWalletAndGetBalanceInTransaction, type GameStateTransaction } from "./gameState.js";
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

export interface ChestClaimInput { playerId: string; chestId: string; periodKey: string; idempotencyKey: string; now?: Date; arrivedAt?: Date }
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
    return Promise.all(result.map(async item => this.decorate(playerId,item)));
  }
  private async decorate(playerId: string,item: ReturnType<typeof chestDto>) {
    const [state]=await this.db.select().from(playerMissionChests).where(and(eq(playerMissionChests.playerId,playerId),eq(playerMissionChests.chestId,item.chestId),eq(playerMissionChests.periodKey,item.periodKey)));
    const [exception]=await this.db.select().from(chestCapacityExceptions).where(and(eq(chestCapacityExceptions.playerId,playerId),eq(chestCapacityExceptions.chestId,item.chestId),eq(chestCapacityExceptions.periodKey,item.periodKey)));
    const [event]=exception?await this.db.select().from(chestCapacityEvents).where(eq(chestCapacityEvents.exceptionId,exception.exceptionId)).orderBy(desc(chestCapacityEvents.eventId)).limit(1):[];
    const [paid]=await this.db.select().from(missionChestClaims).where(and(eq(missionChestClaims.playerId,playerId),eq(missionChestClaims.periodType,item.periodType),eq(missionChestClaims.periodKey,item.periodKey)));
    const [reserved]=await this.db.select().from(chestCapacityExceptions).where(and(eq(chestCapacityExceptions.playerId,playerId),eq(chestCapacityExceptions.periodType,item.periodType),eq(chestCapacityExceptions.periodKey,item.periodKey)));
    const occupied=(paid && paid.chestId!==item.chestId)||(reserved && reserved.chestId!==item.chestId);
    const status=event?.action==="RECOVERED"?"RECOVERED":exception?(event?.action==="RECOVERY_BLOCKED"?"CAPACITY_BLOCKED":"CAPACITY_PENDING"):occupied?"PERIOD_RESERVED":item.status;
    const linked=await this.db.select({missionId:missions.missionId,title:missions.title}).from(missionChestEligibility).innerJoin(missions,eq(missions.missionId,missionChestEligibility.missionId)).where(and(eq(missionChestEligibility.chestId,item.chestId),eq(missionChestEligibility.selected,true))).orderBy(missions.missionId);
    const completed=state?await this.db.select({missionId:missionChestCompletions.missionId}).from(missionChestCompletions).where(eq(missionChestCompletions.playerChestId,state.playerChestId)):[];
    return {...item,status,claimable:item.claimable&&!exception&&!occupied,capacityException:exception?{status:event?.action??"OPENED",arrivedAt:exception.arrivedAt.toISOString()}:null,missions:linked.map(m=>({...m,completed:completed.some(c=>c.missionId===m.missionId)}))};
  }
  async history(playerId: string,input: unknown,now=new Date()){
    const p=z.object({limit:z.coerce.number().int().min(1).max(50).default(20),cursor:z.string().max(300).optional()}).strict().safeParse(input);
    if(!p.success)throw validationFailed("Invalid chest history pagination.");
    let cursor:{end:string;id:string}|undefined;
    if(p.data.cursor){try{cursor=z.object({end:z.string().datetime(),id:z.string().uuid()}).strict().parse(JSON.parse(Buffer.from(p.data.cursor,"base64url").toString("utf8")));}catch{throw validationFailed("Invalid chest history cursor.");}}
    const rows=await this.db.select({state:playerMissionChests,chest:missionChests}).from(playerMissionChests).innerJoin(missionChests,eq(missionChests.chestId,playerMissionChests.chestId)).where(and(eq(playerMissionChests.playerId,playerId),cursor?or(lt(playerMissionChests.periodEndsAt,new Date(cursor.end)),and(eq(playerMissionChests.periodEndsAt,new Date(cursor.end)),lt(playerMissionChests.playerChestId,cursor.id))):undefined)).orderBy(desc(playerMissionChests.periodEndsAt),desc(playerMissionChests.playerChestId)).limit(p.data.limit+1);
    const shown=rows.slice(0,p.data.limit),last=shown.at(-1)?.state;
    return {entries:await Promise.all(shown.map(async({state,chest})=>({...await this.decorate(playerId,chestDto(chest,state,state.periodKey,now)),rewards:state.rewardSnapshot,titleSource:"CURRENT_DEFINITION",rewardSource:state.rewardSnapshot?"FROZEN":"NOT_RECORDED",active:chest.active}))),nextCursor:rows.length>p.data.limit&&last?Buffer.from(JSON.stringify({end:last.periodEndsAt.toISOString(),id:last.playerChestId})).toString("base64url"):null};
  }
  async claim(input: ChestClaimInput) {
    if (!input.idempotencyKey?.trim() || input.idempotencyKey.trim().length>200) throw validationFailed("A valid Idempotency-Key is required.");
    const at=new Date((input.arrivedAt??input.now??new Date()).getTime());
    if (!Number.isFinite(at.getTime())) throw validationFailed("Invalid trusted arrival timestamp.");
    const result=await this.db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`chest-key:${input.playerId}:${input.idempotencyKey}`},0))`);
      const [replay]=await tx.select().from(missionChestClaims).where(and(eq(missionChestClaims.playerId,input.playerId),eq(missionChestClaims.idempotencyKey,input.idempotencyKey)));
      if(replay){if(replay.chestId!==input.chestId||replay.periodKey!==input.periodKey)throw new AppError("IDEMPOTENCY_CONFLICT","Key belongs to another chest period.",409);return chestClaimResult(tx,replay,true);}
      const [bound]=await tx.select({chestId:chestCapacityExceptions.chestId,periodKey:chestCapacityExceptions.periodKey}).from(chestCapacityRequests).innerJoin(chestCapacityExceptions,eq(chestCapacityExceptions.exceptionId,chestCapacityRequests.exceptionId)).where(and(eq(chestCapacityRequests.playerId,input.playerId),eq(chestCapacityRequests.key,input.idempotencyKey)));
      if(bound&&(bound.chestId!==input.chestId||bound.periodKey!==input.periodKey))throw new AppError("IDEMPOTENCY_CONFLICT","Key belongs to another chest entitlement.",409);
      const [chest]=await tx.select().from(missionChests).where(eq(missionChests.chestId,input.chestId)).for("share");
      if(!chest)throw new AppError("CHEST_NOT_FOUND","Chest was not found.",404);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`chest-period:${input.playerId}:${chest.periodType}:${input.periodKey}`},0))`);
      const [state]=await tx.select().from(playerMissionChests).where(and(eq(playerMissionChests.playerId,input.playerId),eq(playerMissionChests.chestId,input.chestId),eq(playerMissionChests.periodKey,input.periodKey))).for("update");
      if(!state?.unlockedAt||state.unlockedAt>at)throw new AppError("CHEST_NOT_CLAIMABLE","Chest is not unlocked.",409);
      const pending=await findChestCapacityException(tx,input,state);
      if(pending)return pending;
      if(state.claimedAt)throw new AppError("CHEST_ALREADY_CLAIMED","Chest was already claimed.",409);
      if(at>=state.claimDeadline){if(!state.expiredAt)await tx.update(playerMissionChests).set({expiredAt:at}).where(eq(playerMissionChests.playerChestId,state.playerChestId));return null;}
      try{return await tx.transaction(nested=>payUnlockedChest(nested,state,input.idempotencyKey));}
      catch(error){if(!(error instanceof AppError)||!["SP_BALANCE_LIMIT_EXCEEDED","XP_TOTAL_LIMIT_EXCEEDED"].includes(error.code))throw error;
        return {capacityExceptionId:await recordChestCapacityException(tx,state,input.idempotencyKey,at,error.code)};
      }
    });
    if(!result)throw new AppError("CHEST_CLAIM_EXPIRED","Chest claim deadline has passed.",410);
    if("capacityExceptionId" in result)throw pendingCapacityError(result.capacityExceptionId);
    return result;
  }
}
function chestDto(chest: typeof missionChests.$inferSelect, state: typeof playerMissionChests.$inferSelect | undefined, periodKey: string, now: Date) {
  const bounds = periodBounds(chest.periodType as "DAILY" | "WEEKLY", periodKey, chest.chestId);
  const deadline = state?.claimDeadline ?? claimDeadlineFor(chest.periodType as "DAILY" | "WEEKLY", bounds.end, null)!;
  return { chestId: chest.chestId, title: chest.title, periodType: chest.periodType, periodKey, progress: { current: state?.currentCount ?? 0, target: state?.targetCountSnapshot ?? chest.targetCount }, periodStartsAt: bounds.start, periodEndsAt: bounds.end, claimDeadline: deadline, status: state?.claimedAt ? "CLAIMED" : now >= deadline ? "EXPIRED" : state?.unlockedAt ? "CLAIMABLE" : "IN_PROGRESS", claimable: !!state?.unlockedAt && !state.claimedAt && now < deadline, rewards: state?.rewardSnapshot ?? chest.rewards };
}
export async function chestClaimResult(tx: GameStateTransaction, claim: typeof missionChestClaims.$inferSelect, idempotent: boolean) {
  const state = await getPlayerGameStateInTransaction(tx, claim.playerId);
  return { chestClaimId: claim.chestClaimId, chestId: claim.chestId, periodKey: claim.periodKey, status: "CLAIMED", idempotent, claimedAt: claim.createdAt, awarded: snapshotTotals(claim.rewardSnapshot), playerState: { synapsePoints: state.synapsePoints, xp: state.totalXp, progressionLevel: state.progressionLevel, rankName: state.rankName } };
}

export async function payUnlockedChest(tx: GameStateTransaction,state: typeof playerMissionChests.$inferSelect,key:string){
  const [chest]=await tx.select().from(missionChests).where(eq(missionChests.chestId,state.chestId));
  const [prior]=await tx.select().from(missionChestClaims).where(and(eq(missionChestClaims.playerId,state.playerId),eq(missionChestClaims.periodType,chest.periodType),eq(missionChestClaims.periodKey,state.periodKey)));
  if(prior)throw new AppError("CHEST_PERIOD_ALREADY_CLAIMED","A chest reward was already paid for this period.",409);
  const [reserved]=await tx.select().from(chestCapacityExceptions).where(and(eq(chestCapacityExceptions.playerId,state.playerId),eq(chestCapacityExceptions.periodType,chest.periodType),eq(chestCapacityExceptions.periodKey,state.periodKey)));
  if(reserved&&reserved.progressId!==state.playerChestId)throw new AppError("CHEST_PERIOD_RESERVED","An on-time chest claim already reserves this period for administrator recovery.",409);
  const totals=snapshotTotals(state.rewardSnapshot);
  await lockWalletAndGetBalanceInTransaction(tx,state.playerId);
  await tx.select().from(playerProgression).where(eq(playerProgression.playerId,state.playerId)).for("update");
  const game=await getPlayerGameStateInTransaction(tx,state.playerId);
  let capacityFailure: AppError|undefined;
  for(const check of [()=>{if(totals.synapsePoints)checkedPointChange(game.synapsePoints,totals.synapsePoints,"CREDIT");},()=>{if(totals.xp)checkedXpGrant(game.totalXp,totals.xp); }]){
    try{check();}catch(error){if(!(error instanceof AppError)||!["SP_BALANCE_LIMIT_EXCEEDED","XP_TOTAL_LIMIT_EXCEEDED"].includes(error.code))throw error;capacityFailure??=error;}
  }
  if(capacityFailure)throw capacityFailure;
      const reward = snapshotTotals(state.rewardSnapshot);
      const [claim] = await tx.insert(missionChestClaims).values({ playerChestId: state.playerChestId, playerId: state.playerId, chestId: state.chestId, periodKey: state.periodKey, rewardSnapshot: state.rewardSnapshot!, periodType: chest.periodType, idempotencyKey: key }).returning();
      const metadata = { chestId: state.chestId, periodKey: state.periodKey, chestClaimId: claim.chestClaimId };
      const ledger = { playerId: state.playerId, reason: "Mission chest reward", sourceType: "MISSION_CHEST_REWARD", sourceId: claim.chestClaimId, metadata };
      const points = reward.synapsePoints ? await creditPointsInTransaction(tx, { ...ledger, amount: reward.synapsePoints, idempotencyKey: `chest.sp:${state.playerChestId}` }) : undefined;
      const xp = reward.xp ? await grantXpInTransaction(tx, { ...ledger, amount: reward.xp, idempotencyKey: `chest.xp:${state.playerChestId}` }) : undefined;
      const [updated] = await tx.update(missionChestClaims).set({ pointTransactionId: points?.transactionId, xpTransactionId: xp?.transactionId }).where(eq(missionChestClaims.chestClaimId, claim.chestClaimId)).returning();
      await tx.update(playerMissionChests).set({ claimedAt: claim.createdAt }).where(eq(playerMissionChests.playerChestId, state.playerChestId));
      await insertGameEventInTransaction(tx, { playerId: state.playerId, eventType: "mission.chest_claimed", sourceType: "MISSION_CHEST", sourceId: claim.chestClaimId, idempotencyKey: `chest.claimed:${state.playerChestId}`, payload: metadata });
      return chestClaimResult(tx, updated, false);
}
export type ChestClaimResult = Awaited<ReturnType<typeof chestClaimResult>>;
