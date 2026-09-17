import { randomInt as secureRandomInt } from "node:crypto";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { playerInventoryItems, rewardDefinitions, rewardWheelSegments, rewardWheelSpins, rewardWheelSpinTiers, rewardWheels, wallets } from "../db/schema.js";
import { AppError, insufficientPoints, validationFailed } from "./errors.js";
import { creditPointsInTransaction, debitPointsInTransaction, grantXpInTransaction, lockWalletAndGetBalanceInTransaction } from "./gameState.js";
import { insertGameEventInTransaction } from "./gameEvents.js";
import { grantInventoryItemInTransaction, uniqueInventoryTypes } from "./inventory.js";
import type { RewardDefinitionType } from "./rewardCatalog.js";

export type WheelUnavailableReason = "WHEEL_NOT_STARTED" | "WHEEL_ENDED" | "WHEEL_DAILY_LIMIT_REACHED" | "WHEEL_NO_ELIGIBLE_REWARDS" | "WHEEL_NOT_CONFIGURED" | "INSUFFICIENT_POINTS";

export interface RewardWheelSegmentDto {
  wheelSegmentIndex: number;
  label: string;
  rewardType: RewardDefinitionType;
  rewardValue: number;
  imageUrl: string | null;
  rarity: string | null;
  displayMetadata: Record<string, unknown>;
}

export interface RewardWheelStatusDto {
  available: boolean;
  wheel: null | {
    code: string;
    name: string;
    cycleSeconds: number;
    cycleStartedAt: string | null;
    cycleEndsAt: string | null;
    spinsUsed: number;
    maxSpinsPerCycle: number;
    spinsRemaining: number;
    nextSpinNumber: number | null;
    nextSpinCostSynapsePoints: number | null;
    nextSpinIsFree: boolean;
    canAffordNextSpin: boolean;
    canSpin: boolean;
    unavailableReason: WheelUnavailableReason | null;
    segments: RewardWheelSegmentDto[];
  };
}

export interface RewardWheelSpinInput { playerId: string; idempotencyKey: string; now?: Date }
export interface RewardWheelSpinResult {
  spinId: string;
  rewardId: string;
  rewardDefinitionId: string;
  rewardType: RewardDefinitionType;
  rewardLabel: string;
  rewardValue: number;
  resultingBalance: number;
  wheelSegmentIndex: number;
  spunAt: string;
  spinNumber: number | null;
  chargedSynapsePoints: number;
  cycleStartedAt: string | null;
  cycleEndsAt: string | null;
  idempotent: boolean;
}

export type WheelRandomInt = (exclusiveMax: number) => number;
export interface RewardWheelRepository {
  getStatus(playerId: string, now: Date): Promise<RewardWheelStatusDto>;
  spin(input: Required<RewardWheelSpinInput>, randomInt: WheelRandomInt): Promise<RewardWheelSpinResult>;
}

export class RewardWheelService {
  constructor(private repo: RewardWheelRepository, private randomInt: WheelRandomInt = secureRandomInt) {}

  getStatus(playerId: string, now = new Date()) {
    if (!playerId) throw validationFailed("Player is required.");
    if (Number.isNaN(now.getTime())) throw validationFailed("Wheel status time must be valid.");
    return this.repo.getStatus(playerId, now);
  }

  spin(input: RewardWheelSpinInput) {
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!input.playerId || !idempotencyKey || idempotencyKey.length > 200) throw validationFailed("Player and a valid Idempotency-Key are required.");
    const now = input.now ?? new Date();
    if (Number.isNaN(now.getTime())) throw validationFailed("Spin time must be valid.");
    return this.repo.spin({ playerId: input.playerId, idempotencyKey, now }, this.randomInt);
  }
}

type WeightedSegment = { weight: number };
export function selectWeightedSegment<T extends WeightedSegment>(segments: T[], randomInt: WheelRandomInt): T {
  const totalWeight = segments.reduce((sum, segment) => sum + segment.weight, 0);
  if (!segments.length || !Number.isSafeInteger(totalWeight) || totalWeight <= 0) throw new AppError("WHEEL_CONFIGURATION_INVALID", "Reward Wheel weights are invalid.", 500);
  const roll = randomInt(totalWeight);
  if (!Number.isInteger(roll) || roll < 0 || roll >= totalWeight) throw new AppError("WHEEL_RNG_FAILED", "Reward Wheel selection failed.", 500);
  let boundary = 0;
  for (const segment of segments) {
    boundary += segment.weight;
    if (roll < boundary) return segment;
  }
  throw new AppError("WHEEL_RNG_FAILED", "Reward Wheel selection failed.", 500);
}

export class DrizzleRewardWheelRepository implements RewardWheelRepository {
  constructor(private db: Database) {}

  async getStatus(playerId: string, now: Date): Promise<RewardWheelStatusDto> {
    const [wheel] = await this.db.select().from(rewardWheels).where(eq(rewardWheels.active, true)).limit(1);
    if (!wheel) return { available: false, wheel: null };

    const tiers = validateTierSchedule(await this.db.select().from(rewardWheelSpinTiers)
      .where(and(eq(rewardWheelSpinTiers.rewardWheelId, wheel.rewardWheelId), eq(rewardWheelSpinTiers.active, true)))
      .orderBy(asc(rewardWheelSpinTiers.spinNumber)));

    const rows = await this.db.select({ segment: rewardWheelSegments, reward: rewardDefinitions })
      .from(rewardWheelSegments)
      .innerJoin(rewardDefinitions, eq(rewardWheelSegments.rewardDefinitionId, rewardDefinitions.rewardDefinitionId))
      .where(and(eq(rewardWheelSegments.rewardWheelId, wheel.rewardWheelId), eq(rewardWheelSegments.active, true), eq(rewardDefinitions.active, true)))
      .orderBy(asc(rewardWheelSegments.position));
    const ownedRows = await this.db.select({ rewardDefinitionId: playerInventoryItems.rewardDefinitionId, quantity: playerInventoryItems.quantity })
      .from(playerInventoryItems).where(eq(playerInventoryItems.playerId, playerId));
    const owned = new Set(ownedRows.filter((item) => item.quantity > 0).map((item) => item.rewardDefinitionId));
    const eligible = rows.filter(({ reward }) => !uniqueInventoryTypes.includes(reward.rewardType) || !owned.has(reward.rewardDefinitionId));
    const [latest] = await this.db.select().from(rewardWheelSpins)
      .where(and(eq(rewardWheelSpins.playerId, playerId), eq(rewardWheelSpins.rewardWheelId, wheel.rewardWheelId), isNotNull(rewardWheelSpins.cycleEndsAt)))
      .orderBy(desc(rewardWheelSpins.spunAt)).limit(1);
    const [wallet] = await this.db.select({ balance: wallets.balance }).from(wallets).where(eq(wallets.playerId, playerId)).limit(1);
    const cycle = resolveCycle(wheel, tiers, latest, now, false);
    const state = wheelAvailability(wheel, cycle, eligible.length, wallet?.balance ?? 0, now);
    return {
      available: state.reason === null || state.reason === "WHEEL_DAILY_LIMIT_REACHED" || state.reason === "INSUFFICIENT_POINTS",
      wheel: {
        code: wheel.code,
        name: wheel.name,
        cycleSeconds: wheel.cycleSeconds,
        cycleStartedAt: cycle.cycleStartedAt?.toISOString() ?? null,
        cycleEndsAt: cycle.cycleEndsAt?.toISOString() ?? null,
        spinsUsed: cycle.spinsUsed,
        maxSpinsPerCycle: tiers.length,
        spinsRemaining: tiers.length - cycle.spinsUsed,
        nextSpinNumber: cycle.tier?.spinNumber ?? null,
        nextSpinCostSynapsePoints: cycle.tier?.costSynapsePoints ?? null,
        nextSpinIsFree: cycle.tier?.costSynapsePoints === 0,
        canAffordNextSpin: cycle.tier ? (wallet?.balance ?? 0) >= cycle.tier.costSynapsePoints : false,
        canSpin: state.reason === null,
        unavailableReason: state.reason,
        segments: rows.map(({ segment, reward }) => ({
          wheelSegmentIndex: segment.position,
          label: segment.displayLabel,
          rewardType: reward.rewardType,
          rewardValue: segment.rewardQuantity,
          imageUrl: reward.imageUrl,
          rarity: reward.rarity,
          displayMetadata: safeDisplayMetadata(segment.displayMetadata),
        })),
      },
    };
  }

  spin(input: Required<RewardWheelSpinInput>, randomInt: WheelRandomInt): Promise<RewardWheelSpinResult> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.playerId}:reward-wheel`}, 0))`);

      const [replay] = await tx.select().from(rewardWheelSpins).where(and(
        eq(rewardWheelSpins.playerId, input.playerId),
        eq(rewardWheelSpins.idempotencyKey, input.idempotencyKey),
      )).limit(1);
      if (replay) return spinResult(replay, true);

      const [wheel] = await tx.select().from(rewardWheels).where(eq(rewardWheels.active, true)).limit(1).for("share");
      if (!wheel) throw new AppError("WHEEL_NOT_AVAILABLE", "No Reward Wheel is currently available.", 409);
      const tiers = validateTierSchedule(await tx.select().from(rewardWheelSpinTiers)
        .where(and(eq(rewardWheelSpinTiers.rewardWheelId, wheel.rewardWheelId), eq(rewardWheelSpinTiers.active, true)))
        .orderBy(asc(rewardWheelSpinTiers.spinNumber)).for("share"));
      const [latest] = await tx.select().from(rewardWheelSpins)
        .where(and(eq(rewardWheelSpins.playerId, input.playerId), eq(rewardWheelSpins.rewardWheelId, wheel.rewardWheelId), isNotNull(rewardWheelSpins.cycleEndsAt)))
        .orderBy(desc(rewardWheelSpins.spunAt)).limit(1);
      const cycle = resolveCycle(wheel, tiers, latest, input.now, true);
      const initialAvailability = wheelAvailability(wheel, cycle, 1, Number.MAX_SAFE_INTEGER, input.now);
      if (initialAvailability.reason === "INSUFFICIENT_POINTS") throw insufficientPoints();
      if (initialAvailability.reason) throw wheelUnavailable(initialAvailability.reason, cycle.cycleEndsAt);
      if (!cycle.tier || !cycle.cycleStartedAt || !cycle.cycleEndsAt) throw new AppError("WHEEL_CONFIGURATION_INVALID", "Reward Wheel cycle configuration is invalid.", 500);

      const startingBalance = await lockWalletAndGetBalanceInTransaction(tx, input.playerId);
      if (startingBalance < cycle.tier.costSynapsePoints) throw insufficientPoints();

      const rows = await tx.select({ segment: rewardWheelSegments, reward: rewardDefinitions })
        .from(rewardWheelSegments)
        .innerJoin(rewardDefinitions, eq(rewardWheelSegments.rewardDefinitionId, rewardDefinitions.rewardDefinitionId))
        .where(and(eq(rewardWheelSegments.rewardWheelId, wheel.rewardWheelId), eq(rewardWheelSegments.active, true), eq(rewardDefinitions.active, true)))
        .orderBy(asc(rewardWheelSegments.position)).for("share");
      const ownedRows = await tx.select({ rewardDefinitionId: playerInventoryItems.rewardDefinitionId, quantity: playerInventoryItems.quantity })
        .from(playerInventoryItems).where(eq(playerInventoryItems.playerId, input.playerId)).for("share");
      const owned = new Set(ownedRows.filter((item) => item.quantity > 0).map((item) => item.rewardDefinitionId));
      const eligible = rows.filter(({ reward }) => !uniqueInventoryTypes.includes(reward.rewardType) || !owned.has(reward.rewardDefinitionId));
      if (!eligible.length) throw wheelUnavailable("WHEEL_NO_ELIGIBLE_REWARDS", null);
      const selected = selectWeightedSegment(eligible.map((row) => ({ ...row, weight: row.segment.weight })), randomInt);
      if (uniqueInventoryTypes.includes(selected.reward.rewardType) && selected.segment.rewardQuantity !== 1) {
        throw new AppError("WHEEL_CONFIGURATION_INVALID", "Unique Reward Wheel items must have quantity one.", 500);
      }

      const spinId = crypto.randomUUID();
      const source = { sourceType: "REWARD_WHEEL_SPIN", sourceId: spinId };
      const debit = cycle.tier.costSynapsePoints > 0 ? await debitPointsInTransaction(tx, {
        playerId: input.playerId,
        amount: cycle.tier.costSynapsePoints,
        reason: "REWARD_WHEEL_SPIN",
        ...source,
        idempotencyKey: `reward-wheel.cost:${spinId}`,
        metadata: { rewardWheelId: wheel.rewardWheelId, spinNumber: cycle.tier.spinNumber },
      }) : undefined;
      let resultingBalance = debit?.balanceAfter ?? startingBalance;
      let rewardPointTransactionId: string | undefined;
      let rewardXpTransactionId: string | undefined;
      let rewardInventoryGrantId: string | undefined;

      if (selected.reward.rewardType === "SYNAPSE_POINTS") {
        const credit = await creditPointsInTransaction(tx, { playerId: input.playerId, amount: selected.segment.rewardQuantity, reason: "REWARD_WHEEL_REWARD", ...source, idempotencyKey: `reward-wheel.points:${spinId}`, metadata: { rewardDefinitionId: selected.reward.rewardDefinitionId } });
        resultingBalance = credit.balanceAfter;
        rewardPointTransactionId = credit.transactionId;
      } else if (selected.reward.rewardType === "XP") {
        const xp = await grantXpInTransaction(tx, { playerId: input.playerId, amount: selected.segment.rewardQuantity, reason: "REWARD_WHEEL_REWARD", sourceType: source.sourceType, sourceId: source.sourceId, idempotencyKey: `reward-wheel.xp:${spinId}`, metadata: { rewardDefinitionId: selected.reward.rewardDefinitionId } });
        rewardXpTransactionId = xp.transactionId;
      } else {
        const inventory = await grantInventoryItemInTransaction(tx, { playerId: input.playerId, rewardDefinitionId: selected.reward.rewardDefinitionId, rewardType: selected.reward.rewardType, quantity: selected.segment.rewardQuantity, ...source, idempotencyKey: `reward-wheel.inventory:${spinId}` });
        rewardInventoryGrantId = inventory.grant.inventoryGrantId;
      }

      const [spin] = await tx.insert(rewardWheelSpins).values({
        rewardWheelSpinId: spinId,
        playerId: input.playerId,
        rewardWheelId: wheel.rewardWheelId,
        rewardWheelSegmentId: selected.segment.rewardWheelSegmentId,
        rewardWheelSpinTierId: cycle.tier.rewardWheelSpinTierId,
        rewardDefinitionId: selected.reward.rewardDefinitionId,
        wheelCodeSnapshot: wheel.code,
        wheelNameSnapshot: wheel.name,
        segmentPositionSnapshot: selected.segment.position,
        segmentLabelSnapshot: selected.segment.displayLabel,
        spinCostSynapsePointsSnapshot: cycle.tier.costSynapsePoints,
        cooldownSecondsSnapshot: wheel.cooldownSeconds,
        spinNumberSnapshot: cycle.tier.spinNumber,
        cycleStartedAt: cycle.cycleStartedAt,
        cycleEndsAt: cycle.cycleEndsAt,
        rewardQuantitySnapshot: selected.segment.rewardQuantity,
        rewardTypeSnapshot: selected.reward.rewardType,
        rewardCodeSnapshot: selected.reward.code,
        rewardNameSnapshot: selected.reward.name,
        rewardRaritySnapshot: selected.reward.rarity,
        rewardImageUrlSnapshot: selected.reward.imageUrl,
        resultingSynapsePointBalance: resultingBalance,
        costPointTransactionId: debit?.transactionId,
        rewardPointTransactionId,
        rewardXpTransactionId,
        rewardInventoryGrantId,
        idempotencyKey: input.idempotencyKey,
        metadata: {},
        spunAt: input.now,
      }).returning();
      if (!spin) throw new AppError("WHEEL_SPIN_FAILED", "Could not record Reward Wheel spin.", 500);
      await insertGameEventInTransaction(tx, {
        playerId: input.playerId,
        eventType: "reward_wheel.spun",
        ...source,
        idempotencyKey: `reward_wheel.spun:${spinId}`,
        payload: { rewardWheelId: wheel.rewardWheelId, rewardWheelCode: wheel.code, segmentPosition: selected.segment.position, spinNumber: cycle.tier.spinNumber, chargedSynapsePoints: cycle.tier.costSynapsePoints, cycleStartedAt: cycle.cycleStartedAt.toISOString(), cycleEndsAt: cycle.cycleEndsAt.toISOString(), rewardDefinitionId: selected.reward.rewardDefinitionId, rewardType: selected.reward.rewardType, rewardQuantity: selected.segment.rewardQuantity, resultingBalance },
      });
      return spinResult(spin, false);
    });
  }
}

type WheelRow = typeof rewardWheels.$inferSelect;
type TierRow = typeof rewardWheelSpinTiers.$inferSelect;
type SpinRow = typeof rewardWheelSpins.$inferSelect;
type CycleState = {
  cycleStartedAt: Date | null;
  cycleEndsAt: Date | null;
  spinsUsed: number;
  tier: TierRow | null;
};

export function validateTierSchedule<T extends Pick<TierRow, "spinNumber" | "costSynapsePoints">>(tiers: T[]): T[] {
  const valid = tiers.length === 4
    && tiers.every((tier, index) => tier.spinNumber === index + 1 && Number.isInteger(tier.costSynapsePoints) && tier.costSynapsePoints >= 0)
    && tiers[0]?.costSynapsePoints === 0;
  if (!valid) throw new AppError("WHEEL_CONFIGURATION_INVALID", "Reward Wheel spin tiers are invalid.", 500);
  return tiers;
}

function resolveCycle(wheel: WheelRow, tiers: TierRow[], latest: SpinRow | undefined, now: Date, establishNew: boolean): CycleState {
  if (latest?.cycleStartedAt && latest.cycleEndsAt && latest.spinNumberSnapshot && now < latest.cycleEndsAt) {
    const spinsUsed = latest.spinNumberSnapshot;
    return {
      cycleStartedAt: latest.cycleStartedAt,
      cycleEndsAt: latest.cycleEndsAt,
      spinsUsed,
      tier: tiers[spinsUsed] ?? null,
    };
  }
  return {
    cycleStartedAt: establishNew ? now : null,
    cycleEndsAt: establishNew ? new Date(now.getTime() + wheel.cycleSeconds * 1000) : null,
    spinsUsed: 0,
    tier: tiers[0] ?? null,
  };
}

function wheelAvailability(wheel: WheelRow, cycle: CycleState, eligibleCount: number, balance: number, now: Date) {
  if (wheel.startsAt && now < wheel.startsAt) return { reason: "WHEEL_NOT_STARTED" as const };
  if (wheel.endsAt && now >= wheel.endsAt) return { reason: "WHEEL_ENDED" as const };
  if (eligibleCount === 0) return { reason: "WHEEL_NO_ELIGIBLE_REWARDS" as const };
  if (!cycle.tier) return { reason: "WHEEL_DAILY_LIMIT_REACHED" as const };
  if (balance < cycle.tier.costSynapsePoints) return { reason: "INSUFFICIENT_POINTS" as const };
  return { reason: null };
}

function wheelUnavailable(reason: Exclude<WheelUnavailableReason, "WHEEL_NOT_CONFIGURED" | "INSUFFICIENT_POINTS">, cycleEndsAt: Date | null) {
  const code = reason === "WHEEL_DAILY_LIMIT_REACHED" || reason === "WHEEL_NO_ELIGIBLE_REWARDS" ? reason : "WHEEL_NOT_AVAILABLE";
  const message = reason === "WHEEL_DAILY_LIMIT_REACHED" ? "The Reward Wheel spin limit has been reached for this cycle." : reason === "WHEEL_NO_ELIGIBLE_REWARDS" ? "No eligible Reward Wheel prizes remain." : "The Reward Wheel is not currently available.";
  return new AppError(code, message, 409, reason === "WHEEL_DAILY_LIMIT_REACHED" && cycleEndsAt ? { cycleEndsAt: cycleEndsAt.toISOString() } : undefined);
}

function spinResult(spin: typeof rewardWheelSpins.$inferSelect, idempotent: boolean): RewardWheelSpinResult {
  return {
    spinId: spin.rewardWheelSpinId,
    rewardId: spin.rewardDefinitionId,
    rewardDefinitionId: spin.rewardDefinitionId,
    rewardType: spin.rewardTypeSnapshot,
    rewardLabel: spin.segmentLabelSnapshot,
    rewardValue: spin.rewardQuantitySnapshot,
    resultingBalance: spin.resultingSynapsePointBalance,
    wheelSegmentIndex: spin.segmentPositionSnapshot,
    spunAt: spin.spunAt.toISOString(),
    spinNumber: spin.spinNumberSnapshot,
    chargedSynapsePoints: spin.spinCostSynapsePointsSnapshot,
    cycleStartedAt: spin.cycleStartedAt?.toISOString() ?? null,
    cycleEndsAt: spin.cycleEndsAt?.toISOString() ?? null,
    idempotent,
  };
}

function safeDisplayMetadata(metadata: Record<string, unknown>) {
  return typeof metadata.tone === "string" ? { tone: metadata.tone } : {};
}
