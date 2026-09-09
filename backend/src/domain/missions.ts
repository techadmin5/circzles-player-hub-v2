import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { gameEvents, missionClaims, missionRewards, missionRules, missions, playerMissionProgress } from "../db/schema.js";
import { insertGameEventInTransaction } from "./gameEvents.js";
import { AppError, validationFailed } from "./errors.js";
import { creditPointsInTransaction, getPlayerGameStateInTransaction, grantXpInTransaction } from "./gameState.js";

export const missionCategories = ["DAILY", "WEEKLY", "SPRINT", "SEASON", "EVENT", "ACHIEVEMENT"] as const;
export const missionPeriodTypes = ["DAILY", "WEEKLY", "LIFETIME", "FIXED"] as const;
export const missionRewardTypes = ["SYNAPSE_POINTS", "XP"] as const;
export type MissionCategory = typeof missionCategories[number];
export type MissionPeriodType = typeof missionPeriodTypes[number];
type Scalar = string | number | boolean | null;

export interface MissionDto {
  missionId: string;
  title: string;
  description: string;
  category: MissionCategory;
  periodType: MissionPeriodType;
  periodKey: string;
  status: "IN_PROGRESS" | "CLAIMABLE" | "CLAIMED";
  progress: { current: number; target: number };
  claimable: boolean;
  startsAt: string | null;
  endsAt: string | null;
  rewards: Array<{ type: "SYNAPSE_POINTS" | "XP"; amount: number; label: string }>;
}

export interface PlayerMissionRepository { listForPlayer(playerId: string, now: Date): Promise<MissionDto[]> }
export class PlayerMissionService {
  constructor(private repo: PlayerMissionRepository) {}
  list(playerId: string, now = new Date()) { return this.repo.listForPlayer(playerId, now); }
}

export interface MissionClaimInput { playerId: string; missionId: string; idempotencyKey: string; now?: Date }
export interface MissionClaimResult {
  missionClaimId: string;
  missionId: string;
  periodKey: string;
  status: "CLAIMED";
  claimedAt: string;
  idempotent: boolean;
  awarded: { synapsePoints: number; xp: number };
  playerState: { synapsePoints: number; xp: number; progressionLevel: number; rankName: string };
}
export interface MissionClaimRepository { claim(input: MissionClaimInput): Promise<MissionClaimResult> }
export class MissionClaimService {
  constructor(private repo: MissionClaimRepository) {}
  claim(input: MissionClaimInput) {
    if (!input.playerId || !input.missionId || !input.idempotencyKey?.trim() || input.idempotencyKey.trim().length > 200) throw validationFailed("Player, mission, and a valid Idempotency-Key are required.");
    return this.repo.claim({ ...input, idempotencyKey: input.idempotencyKey.trim() });
  }
}

export interface MissionEventProcessorRepository { processBatch(batchSize: number): Promise<number> }
export class MissionEventProcessor {
  constructor(private repo: MissionEventProcessorRepository) {}
  processBatch(batchSize: number) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw validationFailed("Mission processor batch size must be between 1 and 1000.");
    return this.repo.processBatch(batchSize);
  }
}

export class MissionProcessorRunner {
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(private processor: MissionEventProcessor, private intervalMs: number, private batchSize: number, private onError: (error: unknown) => void) {}
  async tick() {
    if (this.running) return false;
    this.running = true;
    try { await this.processor.processBatch(this.batchSize); return true; }
    catch (error) { this.onError(error); return false; }
    finally { this.running = false; }
  }
  start() {
    if (!this.timer) this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}

export class DrizzleMissionRepository implements PlayerMissionRepository, MissionEventProcessorRepository {
  constructor(private db: Database) {}

  async processBatch(batchSize: number) {
    let processed = 0;
    while (processed < batchSize && await this.processNext()) processed += 1;
    return processed;
  }

  private processNext() {
    return this.db.transaction(async (tx) => {
      const [event] = await tx.select().from(gameEvents).where(isNull(gameEvents.processedAt))
        .orderBy(asc(gameEvents.createdAt), asc(gameEvents.gameEventId)).limit(1).for("update", { skipLocked: true });
      if (!event) return false;
      const candidates = await tx.select({ mission: missions, rule: missionRules }).from(missions)
        .innerJoin(missionRules, eq(missionRules.missionId, missions.missionId))
        .where(and(eq(missions.active, true), eq(missionRules.active, true), eq(missionRules.eventType, event.eventType)));

      for (const candidate of candidates) {
        validateMissionDefinition(candidate.mission);
        validateMissionRule(candidate.rule);
        if (!missionMatchesEvent(event, candidate.mission, candidate.rule)) continue;
        const periodKey = periodKeyFor(candidate.mission.periodType as MissionPeriodType, event.createdAt, candidate.mission.missionId);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${event.playerId}:${candidate.mission.missionId}:${periodKey}`}, 0))`);
        const [existing] = await tx.select().from(playerMissionProgress).where(and(
          eq(playerMissionProgress.playerId, event.playerId), eq(playerMissionProgress.missionId, candidate.mission.missionId), eq(playerMissionProgress.periodKey, periodKey),
        )).limit(1).for("update");
        if (existing?.lastGameEventId === event.gameEventId) continue;
        const target = existing?.targetCountSnapshot ?? candidate.rule.targetCount;
        const previous = existing?.currentCount ?? 0;
        const current = Math.min(target, previous + 1);
        const becameClaimable = previous < target && current === target;
        const completedAt = becameClaimable ? event.createdAt : existing?.completedAt;
        const status = becameClaimable ? "CLAIMABLE" : existing?.status ?? "IN_PROGRESS";
        const [progress] = existing
          ? await tx.update(playerMissionProgress).set({ currentCount: current, status, completedAt, lastGameEventId: event.gameEventId, updatedAt: new Date() }).where(eq(playerMissionProgress.playerMissionProgressId, existing.playerMissionProgressId)).returning()
          : await tx.insert(playerMissionProgress).values({ playerId: event.playerId, missionId: candidate.mission.missionId, periodKey, currentCount: current, targetCountSnapshot: target, status, completedAt, lastGameEventId: event.gameEventId }).returning();
        if (becameClaimable) await insertGameEventInTransaction(tx, {
          playerId: event.playerId, eventType: "mission.completed", sourceType: "MISSION", sourceId: progress.playerMissionProgressId,
          idempotencyKey: `mission.completed:${event.playerId}:${candidate.mission.missionId}:${periodKey}`,
          payload: { missionId: candidate.mission.missionId, category: candidate.mission.category, periodKey, completedAt: event.createdAt.toISOString() },
        });
      }
      await tx.update(gameEvents).set({ processedAt: new Date() }).where(eq(gameEvents.gameEventId, event.gameEventId));
      return true;
    });
  }

  async listForPlayer(playerId: string, now: Date) {
    const rows = await this.db.select({ mission: missions, rule: missionRules, reward: missionRewards }).from(missions)
      .innerJoin(missionRules, eq(missionRules.missionId, missions.missionId))
      .leftJoin(missionRewards, and(eq(missionRewards.missionId, missions.missionId), eq(missionRewards.active, true)))
      .where(and(eq(missions.active, true), eq(missionRules.active, true))).orderBy(asc(missions.displayOrder), asc(missionRewards.displayOrder));
    const visible = rows.filter(({ mission }) => isMissionVisibleAt(mission, now));
    const grouped = new Map<string, typeof visible>();
    for (const row of visible) grouped.set(row.mission.missionId, [...(grouped.get(row.mission.missionId) ?? []), row]);
    const result: MissionDto[] = [];
    for (const group of grouped.values()) {
      const { mission, rule } = group[0];
      validateMissionDefinition(mission); validateMissionRule(rule);
      const periodKey = periodKeyFor(mission.periodType as MissionPeriodType, now, mission.missionId);
      const [progress] = await this.db.select().from(playerMissionProgress).where(and(eq(playerMissionProgress.playerId, playerId), eq(playerMissionProgress.missionId, mission.missionId), eq(playerMissionProgress.periodKey, periodKey))).limit(1);
      const rewards = group.flatMap(({ reward }) => {
        if (!reward) return [];
        if (!missionRewardTypes.includes(reward.rewardType as typeof missionRewardTypes[number]) || reward.amount <= 0) throw validationFailed("Mission reward configuration is invalid.");
        return [{ type: reward.rewardType as "SYNAPSE_POINTS" | "XP", amount: reward.amount, label: reward.rewardType === "XP" ? `${reward.amount} XP` : `${reward.amount} Synapse Points` }];
      });
      result.push({ missionId: mission.missionId, title: mission.title, description: mission.description, category: mission.category as MissionCategory, periodType: mission.periodType as MissionPeriodType, periodKey, status: progress?.status as MissionDto["status"] ?? "IN_PROGRESS", progress: { current: progress?.currentCount ?? 0, target: progress?.targetCountSnapshot ?? rule.targetCount }, claimable: progress?.status === "CLAIMABLE", startsAt: mission.startsAt?.toISOString() ?? null, endsAt: mission.endsAt?.toISOString() ?? null, rewards });
    }
    return result;
  }
}

export class DrizzleMissionClaimRepository implements MissionClaimRepository {
  constructor(private db: Database) {}
  claim(input: MissionClaimInput) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.playerId}:${input.idempotencyKey}`}, 0))`);
      const [replay] = await tx.select().from(missionClaims).where(and(eq(missionClaims.playerId, input.playerId), eq(missionClaims.idempotencyKey, input.idempotencyKey))).limit(1);
      if (replay) {
        if (replay.missionId !== input.missionId) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different mission claim.", 409);
        return claimResult(tx, replay, true);
      }

      const now = input.now ?? new Date();
      const [mission] = await tx.select().from(missions).where(eq(missions.missionId, input.missionId)).limit(1).for("update");
      if (!mission || !isMissionVisibleAt(mission, now)) throw new AppError("MISSION_NOT_AVAILABLE", "Mission is not currently available.", 404);
      validateMissionDefinition(mission);
      const periodKey = periodKeyFor(mission.periodType as MissionPeriodType, now, mission.missionId);
      const [progress] = await tx.select().from(playerMissionProgress).where(and(eq(playerMissionProgress.playerId, input.playerId), eq(playerMissionProgress.missionId, mission.missionId), eq(playerMissionProgress.periodKey, periodKey))).limit(1).for("update");
      if (!progress || progress.status === "IN_PROGRESS") throw new AppError("MISSION_NOT_CLAIMABLE", "Mission is not claimable.", 409);
      if (progress.status === "CLAIMED") throw new AppError("MISSION_ALREADY_CLAIMED", "Mission reward was already claimed.", 409);

      const rewards = await tx.select().from(missionRewards).where(and(eq(missionRewards.missionId, mission.missionId), eq(missionRewards.active, true))).orderBy(asc(missionRewards.displayOrder));
      let synapseReward = 0; let xpReward = 0;
      for (const reward of rewards) {
        if (!missionRewardTypes.includes(reward.rewardType as typeof missionRewardTypes[number]) || !Number.isInteger(reward.amount) || reward.amount <= 0) throw new AppError("MISSION_REWARD_CONFIG_INVALID", "Mission reward configuration is invalid.", 500);
        if (reward.rewardType === "SYNAPSE_POINTS") synapseReward += reward.amount; else xpReward += reward.amount;
      }
      if (synapseReward === 0 && xpReward === 0) throw new AppError("MISSION_REWARD_CONFIG_INVALID", "Mission has no active rewards.", 500);
      if (!Number.isSafeInteger(synapseReward) || !Number.isSafeInteger(xpReward) || synapseReward > 2_147_483_647 || xpReward > 2_147_483_647) throw new AppError("MISSION_REWARD_CONFIG_INVALID", "Mission reward total exceeds supported limits.", 500);

      const [claim] = await tx.insert(missionClaims).values({ playerId: input.playerId, missionId: mission.missionId, playerMissionProgressId: progress.playerMissionProgressId, periodKey, synapseRewardSnapshot: synapseReward, xpRewardSnapshot: xpReward, idempotencyKey: input.idempotencyKey }).returning();
      if (!claim) throw new AppError("MISSION_CLAIM_FAILED", "Mission claim could not be recorded.", 500);
      const metadata = { missionId: mission.missionId, periodKey, missionClaimId: claim.missionClaimId };
      const points = synapseReward > 0 ? await creditPointsInTransaction(tx, { playerId: input.playerId, amount: synapseReward, reason: "Mission reward", sourceType: "MISSION_REWARD", sourceId: claim.missionClaimId, idempotencyKey: `mission.reward.sp:${input.playerId}:${mission.missionId}:${periodKey}`, metadata }) : undefined;
      const xp = xpReward > 0 ? await grantXpInTransaction(tx, { playerId: input.playerId, amount: xpReward, reason: "Mission reward", sourceType: "MISSION_REWARD", sourceId: claim.missionClaimId, idempotencyKey: `mission.reward.xp:${input.playerId}:${mission.missionId}:${periodKey}`, metadata }) : undefined;
      await tx.update(missionClaims).set({ pointTransactionId: points?.transactionId, xpTransactionId: xp?.transactionId }).where(eq(missionClaims.missionClaimId, claim.missionClaimId));
      const [claimedProgress] = await tx.update(playerMissionProgress).set({ status: "CLAIMED", claimedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(playerMissionProgress.playerMissionProgressId, progress.playerMissionProgressId)).returning();
      if (!claimedProgress) throw new AppError("MISSION_CLAIM_FAILED", "Mission progress could not be marked claimed.", 500);
      const claimedAt = claimedProgress.claimedAt ?? new Date();
      await insertGameEventInTransaction(tx, { playerId: input.playerId, eventType: "mission.claimed", sourceType: "MISSION", sourceId: claim.missionClaimId, idempotencyKey: `mission.claimed:${input.playerId}:${mission.missionId}:${periodKey}`, payload: { missionId: mission.missionId, periodKey, synapseReward, xpReward, claimedAt: claimedAt.toISOString() } });
      return claimResult(tx, { ...claim, pointTransactionId: points?.transactionId ?? null, xpTransactionId: xp?.transactionId ?? null, createdAt: claimedAt }, false);
    });
  }
}

async function claimResult(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], claim: typeof missionClaims.$inferSelect, idempotent: boolean): Promise<MissionClaimResult> {
  const state = await getPlayerGameStateInTransaction(tx, claim.playerId);
  return { missionClaimId: claim.missionClaimId, missionId: claim.missionId, periodKey: claim.periodKey, status: "CLAIMED", claimedAt: claim.createdAt.toISOString(), idempotent, awarded: { synapsePoints: claim.synapseRewardSnapshot, xp: claim.xpRewardSnapshot }, playerState: { synapsePoints: state.synapsePoints, xp: state.totalXp, progressionLevel: state.progressionLevel, rankName: state.rankName } };
}

export function periodKeyFor(periodType: MissionPeriodType, at: Date, missionId: string) {
  if (periodType === "LIFETIME") return "lifetime";
  if (periodType === "FIXED") return `fixed:${missionId}`;
  if (periodType === "DAILY") return at.toISOString().slice(0, 10);
  const date = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function conditionsMatch(conditions: unknown, payload: Record<string, unknown>) {
  if (!isPlainObject(conditions)) throw validationFailed("Mission rule conditions must be a flat object of scalar values.");
  return Object.entries(conditions).every(([key, value]) => {
    if (!isScalar(value)) throw validationFailed("Mission rule conditions support scalar equality only.");
    return payload[key] === value;
  });
}

export function validateMissionDefinition(input: { category: string; periodType: string; displayOrder: number; startsAt?: Date | null; endsAt?: Date | null }) {
  if (!missionCategories.includes(input.category as MissionCategory)) throw validationFailed("Unsupported mission category.");
  if (!missionPeriodTypes.includes(input.periodType as MissionPeriodType)) throw validationFailed("Unsupported mission period type.");
  if (!Number.isInteger(input.displayOrder) || input.displayOrder < 0) throw validationFailed("Mission display order must be non-negative.");
  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) throw validationFailed("Mission end must be after its start.");
}

export function validateMissionRule(input: { eventType: string; targetCount: number; conditions: unknown; levelId?: number | null }) {
  if (!input.eventType.trim() || !Number.isInteger(input.targetCount) || input.targetCount <= 0) throw validationFailed("Mission rule requires an event type and positive target.");
  if (input.levelId != null && (!Number.isFinite(input.levelId) || input.levelId <= 0 || Math.abs(input.levelId * 10 - Math.round(input.levelId * 10)) > Number.EPSILON * 10)) throw validationFailed("Mission rule levelId must be positive with at most one decimal place.");
  conditionsMatch(input.conditions, {});
}

export function missionMatchesEvent(event: { eventType: string; sourceType: string; payload: Record<string, unknown>; createdAt: Date }, mission: Pick<typeof missions.$inferSelect, "startsAt" | "endsAt">, rule: Pick<typeof missionRules.$inferSelect, "eventType" | "sourceType" | "puzzleId" | "levelId" | "conditions">) {
  if (!isWithinWindow(event.createdAt, mission.startsAt, mission.endsAt) || event.eventType !== rule.eventType) return false;
  if (rule.sourceType && event.sourceType !== rule.sourceType) return false;
  if (rule.puzzleId && event.payload.puzzleId !== rule.puzzleId) return false;
  if (rule.levelId != null && event.payload.levelId !== Number(rule.levelId)) return false;
  return conditionsMatch(rule.conditions, event.payload);
}

function isWithinWindow(at: Date, startsAt: Date | null, endsAt: Date | null) { return (!startsAt || at >= startsAt) && (!endsAt || at < endsAt); }
export function isMissionVisibleAt(mission: { active: boolean; startsAt: Date | null; endsAt: Date | null }, now: Date) { return mission.active && isWithinWindow(now, mission.startsAt, mission.endsAt); }
function isScalar(value: unknown): value is Scalar { return value === null || ["string", "number", "boolean"].includes(typeof value); }
function isPlainObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
