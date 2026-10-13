import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { gameEvents, missionClaims, missionRewards, missionRules, missions, playerMissionProgress, xpTransactions } from "../db/schema.js";
import { implementedGameEventTypes, insertGameEventInTransaction } from "./gameEvents.js";
import { missionEventAttempts, missionProcessingFailures } from "../db/missionChestSchema.js";
import { recordChestCompletion } from "./missionChests.js";
import { claimDeadlineFor, freezeRewards, periodBounds, periodKeyFor, snapshotTotals } from "./missionLifecycle.js";
export { periodKeyFor } from "./missionLifecycle.js";
import { AppError, validationFailed } from "./errors.js";
import { creditPointsInTransaction, getPlayerGameStateInTransaction, grantXpInTransaction, type GameStateTransaction } from "./gameState.js";

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

export interface PlayerMissionRepository { listForPlayer(playerId: string, now: Date): Promise<MissionDto[]>; listPeriods?(playerId: string, now: Date): Promise<unknown[]> }
export class PlayerMissionService {
  constructor(private repo: PlayerMissionRepository) {}
  list(playerId: string, now = new Date()) { return this.repo.listForPlayer(playerId, now); }
  periods(playerId: string, now = new Date()) { return this.repo.listPeriods?.(playerId, now) ?? this.repo.listForPlayer(playerId, now); }
}

export interface MissionClaimInput { playerId: string; missionId: string; periodKey?: string; idempotencyKey: string; now?: Date }
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

export { MissionProcessorRunner } from "./missionProcessorRunner.js";

export class DrizzleMissionRepository implements PlayerMissionRepository, MissionEventProcessorRepository {
  constructor(private db: Database) {}

  async processBatch(batchSize: number) {
    let processed = 0;
    while (processed < batchSize && await this.processNext()) processed += 1;
    return processed;
  }

  private async processNext() {
    let failedEventId: string | undefined;
    try {
      return await this.db.transaction(async tx => {
        // Serialize event selection across workers; claims still run independently.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('mission-processor', 0))`);
        const [event] = await tx.select().from(gameEvents).where(and(isNull(gameEvents.processedAt), sql`NOT EXISTS (SELECT 1 FROM mission_event_attempts a WHERE a.game_event_id = ${gameEvents.gameEventId} AND (a.quarantined_at IS NOT NULL OR a.next_attempt_at > now()))`)).orderBy(asc(gameEvents.createdAt), asc(gameEvents.gameEventId)).limit(1).for("update", { skipLocked: true });
        if (!event) return false;
        failedEventId = event.gameEventId;
        if (!(await isRewardGeneratedEvent(tx, event))) {
          const candidates = await tx.select({ mission: missions, rule: missionRules }).from(missions).innerJoin(missionRules, eq(missionRules.missionId, missions.missionId)).where(and(eq(missions.active, true), eq(missionRules.active, true), eq(missionRules.eventType, event.eventType))).orderBy(missions.missionId);
          for (const candidate of candidates) {
            try {
              await tx.transaction(async nested => {
                const [lockedMission] = await nested.select().from(missions).where(eq(missions.missionId, candidate.mission.missionId)).for("share");
                const [lockedRule] = await nested.select().from(missionRules).where(eq(missionRules.missionId, candidate.mission.missionId)).for("share");
                if (!lockedMission?.active || !lockedRule?.active) return;
                candidate.mission = lockedMission; candidate.rule = lockedRule;
                validateMissionDefinition(candidate.mission); validateMissionRule(candidate.rule);
                if (event.createdAt < candidate.mission.activationEffectiveAt || !missionMatchesEvent(event, candidate.mission, candidate.rule)) return;
                const periodType = candidate.mission.periodType as MissionPeriodType;
                const periodKey = periodKeyFor(periodType, event.createdAt, candidate.mission.missionId);
                await nested.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${event.playerId}:${candidate.mission.missionId}:${periodKey}`}, 0))`);
                const [existing] = await nested.select().from(playerMissionProgress).where(and(eq(playerMissionProgress.playerId, event.playerId), eq(playerMissionProgress.missionId, candidate.mission.missionId), eq(playerMissionProgress.periodKey, periodKey))).limit(1).for("update");
                if (existing?.status !== undefined && existing.status !== "IN_PROGRESS") return;
                const target = existing?.targetCountSnapshot ?? candidate.rule.targetCount;
                const current = Math.min(target, (existing?.currentCount ?? 0) + 1);
                const becameClaimable = current === target;
                const bounds = periodBounds(periodType, periodKey, candidate.mission.missionId, candidate.mission.startsAt, candidate.mission.endsAt);
                const rewards = becameClaimable ? freezeRewards(await nested.select().from(missionRewards).where(and(eq(missionRewards.missionId, candidate.mission.missionId), eq(missionRewards.active, true))).for("share")) : null;
                const values = { currentCount: current, status: becameClaimable ? "CLAIMABLE" : "IN_PROGRESS", lastGameEventId: event.gameEventId, ...(becameClaimable ? { completedAt: event.createdAt, rewardSnapshot: rewards, periodStartsAt: bounds.start, periodEndsAt: bounds.end, claimDeadline: claimDeadlineFor(periodType, bounds.end, candidate.mission.claimDeadline) } : {}) };
                const [progress] = existing ? await nested.update(playerMissionProgress).set(values).where(eq(playerMissionProgress.playerMissionProgressId, existing.playerMissionProgressId)).returning() : await nested.insert(playerMissionProgress).values({ ...values, playerId: event.playerId, missionId: candidate.mission.missionId, periodKey, targetCountSnapshot: target }).returning();
                if (becameClaimable) {
                  await insertGameEventInTransaction(nested, { playerId: event.playerId, eventType: "mission.completed", sourceType: "MISSION", sourceId: progress.playerMissionProgressId, idempotencyKey: `mission.completed:${event.playerId}:${candidate.mission.missionId}:${periodKey}`, payload: { missionId: candidate.mission.missionId, periodKey, completedAt: event.createdAt.toISOString() } });
                  await recordChestCompletion(nested, progress, candidate.mission, event.gameEventId);
                }
              });
            } catch (error) {
              if (!(error instanceof AppError)) throw error;
              await tx.insert(missionProcessingFailures).values({ gameEventId: event.gameEventId, entityType: "MISSION", entityId: candidate.mission.missionId, errorCode: error.code }).onConflictDoNothing();
            }
          }
        }
        await tx.update(gameEvents).set({ processedAt: new Date() }).where(eq(gameEvents.gameEventId, event.gameEventId));
        return true;
      });
    } catch (error) {
      if (!failedEventId) throw error; // Database unavailable before selection: runner logs and retries later.
      const eventId = failedEventId;
      await this.db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('mission-processor', 0))`);
        const [event] = await tx.select().from(gameEvents).where(eq(gameEvents.gameEventId, eventId)).for("update");
        if (event.processedAt) return;
        const [previous] = await tx.select().from(missionEventAttempts).where(eq(missionEventAttempts.gameEventId, eventId));
        const attempts = Math.min(5, (previous?.attempts ?? 0) + 1);
        const now = new Date();
        const values = { attempts, nextAttemptAt: new Date(now.getTime() + 1000 * 2 ** attempts), quarantinedAt: attempts === 5 ? now : null, errorCode: error instanceof AppError ? error.code : "EVENT_PROCESSING_FAILED" };
        await tx.insert(missionEventAttempts).values({ gameEventId: eventId, ...values }).onConflictDoUpdate({ target: missionEventAttempts.gameEventId, set: values });
      });
      throw new AppError("MISSION_PROCESSOR_RETRY", "Mission event processing failed; retry/quarantine state persisted.", 500);
    }
  }

  async listForPlayer(playerId: string, now: Date) {
    const rows = await this.db.select({ mission: missions, rule: missionRules, reward: missionRewards }).from(missions)
      .innerJoin(missionRules, eq(missionRules.missionId, missions.missionId))
      .leftJoin(missionRewards, and(eq(missionRewards.missionId, missions.missionId), eq(missionRewards.active, true)))
      .where(and(eq(missions.active, true), eq(missionRules.active, true))).orderBy(asc(missions.displayOrder), asc(missionRewards.displayOrder));
    const visible = rows.filter(({ mission }) => isMissionVisibleAt(mission, now) && now >= mission.activationEffectiveAt);
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
      const earnedRewards = progress?.rewardSnapshot?.rewards.map(row => ({ ...row, label: `${row.amount} ${row.type === "XP" ? "XP" : "Synapse Points"}` })) ?? rewards;
      result.push({ missionId: mission.missionId, title: mission.title, description: mission.description, category: mission.category as MissionCategory, periodType: mission.periodType as MissionPeriodType, periodKey, status: progress?.status as MissionDto["status"] ?? "IN_PROGRESS", progress: { current: progress?.currentCount ?? 0, target: progress?.targetCountSnapshot ?? rule.targetCount }, claimable: progress?.status === "CLAIMABLE" && !!progress.rewardSnapshot && (!progress.claimDeadline || now < progress.claimDeadline), startsAt: mission.startsAt?.toISOString() ?? null, endsAt: mission.endsAt?.toISOString() ?? null, rewards: earnedRewards });
    }
    return result;
  }

  async listPeriods(playerId: string, now: Date) {
    const current = await this.listForPlayer(playerId, now);
    const earned = await this.db.select({ mission: missions, progress: playerMissionProgress }).from(playerMissionProgress).innerJoin(missions, eq(missions.missionId, playerMissionProgress.missionId)).where(and(eq(playerMissionProgress.playerId, playerId), eq(playerMissionProgress.status, "CLAIMABLE")));
    const result = current.map(dto => ({ ...dto, claimDeadline: earned.find(row => row.mission.missionId === dto.missionId && row.progress.periodKey === dto.periodKey)?.progress.claimDeadline?.toISOString() ?? null }));
    for (const { mission, progress } of earned) {
      if (!progress.rewardSnapshot || (progress.claimDeadline && now >= progress.claimDeadline) || result.some(row => row.missionId === mission.missionId && row.periodKey === progress.periodKey)) continue;
      result.push({ missionId: mission.missionId, title: mission.title, description: mission.description, category: mission.category as MissionCategory, periodType: mission.periodType as MissionPeriodType, periodKey: progress.periodKey, status: "CLAIMABLE", claimable: true, progress: { current: progress.currentCount, target: progress.targetCountSnapshot }, startsAt: progress.periodStartsAt?.toISOString() ?? null, endsAt: progress.periodEndsAt?.toISOString() ?? null, claimDeadline: progress.claimDeadline?.toISOString() ?? null, rewards: progress.rewardSnapshot.rewards.map(row => ({ ...row, label: `${row.amount} ${row.type === "XP" ? "XP" : "Synapse Points"}` })) });
    }
    return result;
  }
}

export class DrizzleMissionClaimRepository implements MissionClaimRepository {
  constructor(private db: Database) {}
  async claim(input: MissionClaimInput) {
    const result = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.playerId}:${input.idempotencyKey}`}, 0))`);
      const [replay] = await tx.select().from(missionClaims).where(and(eq(missionClaims.playerId, input.playerId), eq(missionClaims.idempotencyKey, input.idempotencyKey))).limit(1);
      if (replay) {
        if (replay.missionId !== input.missionId || (input.periodKey && replay.periodKey !== input.periodKey)) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different mission period.", 409);
        return claimResult(tx, replay, true);
      }

      const now = input.now ?? new Date();
      const [mission] = await tx.select().from(missions).where(eq(missions.missionId, input.missionId)).limit(1);
      if (!mission) throw new AppError("MISSION_NOT_AVAILABLE", "Mission is not available.", 404);
      const periodKey = input.periodKey ?? periodKeyFor(mission.periodType as MissionPeriodType, now, mission.missionId);
      // Explicit historical keys are authenticated by ownership of the persisted earned period.
      const [progress] = await tx.select().from(playerMissionProgress).where(and(eq(playerMissionProgress.playerId, input.playerId), eq(playerMissionProgress.missionId, mission.missionId), eq(playerMissionProgress.periodKey, periodKey))).limit(1).for("update");
      if (!progress || progress.status === "IN_PROGRESS") throw new AppError("MISSION_NOT_CLAIMABLE", "Mission is not claimable.", 409);
      if (progress.status === "CLAIMED") throw new AppError("MISSION_ALREADY_CLAIMED", "Mission reward was already claimed.", 409);
      if (progress.claimDeadline && now >= progress.claimDeadline) {
        await tx.update(playerMissionProgress).set({ expiredAt: progress.expiredAt ?? progress.claimDeadline }).where(eq(playerMissionProgress.playerMissionProgressId, progress.playerMissionProgressId));
        return null;
      }
      const { synapsePoints: synapseReward, xp: xpReward } = snapshotTotals(progress.rewardSnapshot);

      const [claim] = await tx.insert(missionClaims).values({ playerId: input.playerId, missionId: mission.missionId, playerMissionProgressId: progress.playerMissionProgressId, periodKey, synapseRewardSnapshot: synapseReward, xpRewardSnapshot: xpReward, idempotencyKey: input.idempotencyKey }).returning();
      if (!claim) throw new AppError("MISSION_CLAIM_FAILED", "Mission claim could not be recorded.", 500);
      const metadata = { missionId: mission.missionId, periodKey, missionClaimId: claim.missionClaimId };
      const points = synapseReward > 0 ? await creditPointsInTransaction(tx, { playerId: input.playerId, amount: synapseReward, reason: "Mission reward", sourceType: "MISSION_REWARD", sourceId: claim.missionClaimId, idempotencyKey: `mission.reward.sp:${input.playerId}:${mission.missionId}:${periodKey}`, metadata }) : undefined;
      const xp = xpReward > 0 ? await grantXpInTransaction(tx, { playerId: input.playerId, amount: xpReward, reason: "Mission reward", sourceType: "MISSION_REWARD", sourceId: claim.missionClaimId, idempotencyKey: `mission.reward.xp:${input.playerId}:${mission.missionId}:${periodKey}`, metadata }) : undefined;
      await tx.update(missionClaims).set({ pointTransactionId: points?.transactionId, xpTransactionId: xp?.transactionId }).where(eq(missionClaims.missionClaimId, claim.missionClaimId));
      const claimedAt = claim.createdAt;
      const [claimedProgress] = await tx.update(playerMissionProgress).set({ status: "CLAIMED", claimedAt, updatedAt: sql`now()` }).where(eq(playerMissionProgress.playerMissionProgressId, progress.playerMissionProgressId)).returning();
      if (!claimedProgress) throw new AppError("MISSION_CLAIM_FAILED", "Mission progress could not be marked claimed.", 500);
      await insertGameEventInTransaction(tx, { playerId: input.playerId, eventType: "mission.claimed", sourceType: "MISSION", sourceId: claim.missionClaimId, idempotencyKey: `mission.claimed:${input.playerId}:${mission.missionId}:${periodKey}`, payload: { missionId: mission.missionId, periodKey, synapseReward, xpReward, claimedAt: claimedAt.toISOString() } });
      return claimResult(tx, { ...claim, pointTransactionId: points?.transactionId ?? null, xpTransactionId: xp?.transactionId ?? null }, false);
    });
    if (!result) throw new AppError("MISSION_CLAIM_EXPIRED", "Mission claim deadline has passed.", 410);
    return result;
  }
}

async function claimResult(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], claim: typeof missionClaims.$inferSelect, idempotent: boolean): Promise<MissionClaimResult> {
  const state = await getPlayerGameStateInTransaction(tx, claim.playerId);
  return { missionClaimId: claim.missionClaimId, missionId: claim.missionId, periodKey: claim.periodKey, status: "CLAIMED", claimedAt: claim.createdAt.toISOString(), idempotent, awarded: { synapsePoints: claim.synapseRewardSnapshot, xp: claim.xpRewardSnapshot }, playerState: { synapsePoints: state.synapsePoints, xp: state.totalXp, progressionLevel: state.progressionLevel, rankName: state.rankName } };
}

export function conditionsMatch(conditions: unknown, payload: Record<string, unknown>) {
  if (!isPlainObject(conditions)) throw validationFailed("Mission rule conditions must be a flat object of scalar values.");
  return Object.entries(conditions).every(([key, value]) => {
    if (!isScalar(value)) throw validationFailed("Mission rule conditions support scalar equality only.");
    return payload[key] === value;
  });
}

export function validateMissionDefinition(input: { category: string; periodType: string; displayOrder: number; startsAt?: Date | null; endsAt?: Date | null; claimDeadline?: Date | null; activationEffectiveAt?: Date }) {
  if (!missionCategories.includes(input.category as MissionCategory)) throw validationFailed("Unsupported mission category.");
  if (!missionPeriodTypes.includes(input.periodType as MissionPeriodType)) throw validationFailed("Unsupported mission period type.");
  const expected = input.category === "DAILY" ? "DAILY" : input.category === "WEEKLY" ? "WEEKLY" : input.category === "ACHIEVEMENT" ? "LIFETIME" : "FIXED";
  if (input.periodType !== expected) throw validationFailed("Invalid mission category/period combination.");
  if (input.periodType === "FIXED" && (!input.startsAt || !input.endsAt)) throw validationFailed("Fixed campaigns require explicit UTC start and end.");
  if ([input.startsAt, input.endsAt, input.claimDeadline, input.activationEffectiveAt].some(date => date && !Number.isFinite(date.getTime()))) throw validationFailed("Invalid mission timestamp.");
  if (input.claimDeadline && (input.periodType === "DAILY" || input.periodType === "WEEKLY" || (input.endsAt && input.claimDeadline < input.endsAt))) throw validationFailed("Invalid explicit claim deadline.");
  if (!Number.isInteger(input.displayOrder) || input.displayOrder < 0) throw validationFailed("Mission display order must be non-negative.");
  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) throw validationFailed("Mission end must be after its start.");
}

export function validateMissionRule(input: { eventType: string; targetCount: number; conditions: unknown; levelId?: number | null }) {
  if (!input.eventType.trim() || !Number.isInteger(input.targetCount) || input.targetCount <= 0) throw validationFailed("Mission rule requires an event type and positive target.");
  if (!(implementedGameEventTypes as readonly string[]).includes(input.eventType) || input.eventType.startsWith("mission.")) throw validationFailed("Unsupported or recursive mission event type.");
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

async function isRewardGeneratedEvent(tx: GameStateTransaction, event: typeof gameEvents.$inferSelect) {
  if (event.eventType.startsWith("mission.") || ["MISSION_REWARD", "MISSION_CHEST_REWARD"].includes(String(event.payload.source))) return true;
  if (event.sourceType === "XP_TRANSACTION") {
    const [ledger] = await tx.select({ source: xpTransactions.sourceType }).from(xpTransactions).where(eq(xpTransactions.xpTransactionId, event.sourceId));
    return !!ledger && ["MISSION_REWARD", "MISSION_CHEST_REWARD"].includes(ledger.source);
  }
  return false;
}
