import { randomInt as secureRandomInt } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { playerInventoryItems, rewardDefinitions, rewardWheelSegments, rewardWheelSpins, rewardWheels } from "../db/schema.js";
import { AppError, validationFailed } from "./errors.js";
import { creditPointsInTransaction, debitPointsInTransaction, grantXpInTransaction, lockWalletAndGetBalanceInTransaction } from "./gameState.js";
import { insertGameEventInTransaction } from "./gameEvents.js";
import { grantInventoryItemInTransaction, uniqueInventoryTypes } from "./inventory.js";
import type { RewardDefinitionType } from "./rewardCatalog.js";

export type WheelUnavailableReason = "WHEEL_NOT_STARTED" | "WHEEL_ENDED" | "WHEEL_COOLDOWN_ACTIVE" | "WHEEL_NO_ELIGIBLE_REWARDS" | "WHEEL_NOT_CONFIGURED";

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
    costSynapsePoints: number;
    cooldownSeconds: number;
    nextSpinAt: string | null;
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
  nextSpinAt: string | null;
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

    const rows = await this.db.select({ segment: rewardWheelSegments, reward: rewardDefinitions })
      .from(rewardWheelSegments)
      .innerJoin(rewardDefinitions, eq(rewardWheelSegments.rewardDefinitionId, rewardDefinitions.rewardDefinitionId))
      .where(and(eq(rewardWheelSegments.rewardWheelId, wheel.rewardWheelId), eq(rewardWheelSegments.active, true), eq(rewardDefinitions.active, true)))
      .orderBy(asc(rewardWheelSegments.position));
    const ownedRows = await this.db.select({ rewardDefinitionId: playerInventoryItems.rewardDefinitionId, quantity: playerInventoryItems.quantity })
      .from(playerInventoryItems).where(eq(playerInventoryItems.playerId, playerId));
    const owned = new Set(ownedRows.filter((item) => item.quantity > 0).map((item) => item.rewardDefinitionId));
    const eligible = rows.filter(({ reward }) => !uniqueInventoryTypes.includes(reward.rewardType) || !owned.has(reward.rewardDefinitionId));
    const [latest] = await this.db.select({ spunAt: rewardWheelSpins.spunAt }).from(rewardWheelSpins)
      .where(and(eq(rewardWheelSpins.playerId, playerId), eq(rewardWheelSpins.rewardWheelId, wheel.rewardWheelId)))
      .orderBy(desc(rewardWheelSpins.spunAt)).limit(1);
    const state = wheelAvailability(wheel, latest?.spunAt ?? null, eligible.length, now);
    return {
      available: state.reason === null || state.reason === "WHEEL_COOLDOWN_ACTIVE",
      wheel: {
        code: wheel.code,
        name: wheel.name,
        costSynapsePoints: wheel.spinCostSynapsePoints,
        cooldownSeconds: wheel.cooldownSeconds,
        nextSpinAt: state.nextSpinAt?.toISOString() ?? null,
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
      const [latest] = await tx.select({ spunAt: rewardWheelSpins.spunAt }).from(rewardWheelSpins)
        .where(and(eq(rewardWheelSpins.playerId, input.playerId), eq(rewardWheelSpins.rewardWheelId, wheel.rewardWheelId)))
        .orderBy(desc(rewardWheelSpins.spunAt)).limit(1);
      const initialAvailability = wheelAvailability(wheel, latest?.spunAt ?? null, 1, input.now);
      if (initialAvailability.reason) throw wheelUnavailable(initialAvailability.reason, initialAvailability.nextSpinAt);

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

      const startingBalance = await lockWalletAndGetBalanceInTransaction(tx, input.playerId);
      const spinId = crypto.randomUUID();
      const source = { sourceType: "REWARD_WHEEL_SPIN", sourceId: spinId };
      const debit = wheel.spinCostSynapsePoints > 0 ? await debitPointsInTransaction(tx, {
        playerId: input.playerId,
        amount: wheel.spinCostSynapsePoints,
        reason: "REWARD_WHEEL_SPIN",
        ...source,
        idempotencyKey: `reward-wheel.cost:${spinId}`,
        metadata: { rewardWheelId: wheel.rewardWheelId },
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
        rewardDefinitionId: selected.reward.rewardDefinitionId,
        wheelCodeSnapshot: wheel.code,
        wheelNameSnapshot: wheel.name,
        segmentPositionSnapshot: selected.segment.position,
        segmentLabelSnapshot: selected.segment.displayLabel,
        spinCostSynapsePointsSnapshot: wheel.spinCostSynapsePoints,
        cooldownSecondsSnapshot: wheel.cooldownSeconds,
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
        payload: { rewardWheelId: wheel.rewardWheelId, rewardWheelCode: wheel.code, segmentPosition: selected.segment.position, rewardDefinitionId: selected.reward.rewardDefinitionId, rewardType: selected.reward.rewardType, rewardQuantity: selected.segment.rewardQuantity, configuredCost: wheel.spinCostSynapsePoints, resultingBalance },
      });
      return spinResult(spin, false);
    });
  }
}

type WheelRow = typeof rewardWheels.$inferSelect;
function wheelAvailability(wheel: WheelRow, latestSpinAt: Date | null, eligibleCount: number, now: Date) {
  if (wheel.startsAt && now < wheel.startsAt) return { reason: "WHEEL_NOT_STARTED" as const, nextSpinAt: wheel.startsAt };
  if (wheel.endsAt && now >= wheel.endsAt) return { reason: "WHEEL_ENDED" as const, nextSpinAt: null };
  if (eligibleCount === 0) return { reason: "WHEEL_NO_ELIGIBLE_REWARDS" as const, nextSpinAt: null };
  if (latestSpinAt && wheel.cooldownSeconds > 0) {
    const nextSpinAt = new Date(latestSpinAt.getTime() + wheel.cooldownSeconds * 1000);
    if (now < nextSpinAt) return { reason: "WHEEL_COOLDOWN_ACTIVE" as const, nextSpinAt };
  }
  return { reason: null, nextSpinAt: null };
}

function wheelUnavailable(reason: Exclude<WheelUnavailableReason, "WHEEL_NOT_CONFIGURED">, nextSpinAt: Date | null) {
  const code = reason === "WHEEL_COOLDOWN_ACTIVE" ? reason : reason === "WHEEL_NO_ELIGIBLE_REWARDS" ? reason : "WHEEL_NOT_AVAILABLE";
  const message = reason === "WHEEL_COOLDOWN_ACTIVE" ? "The Reward Wheel is still cooling down." : reason === "WHEEL_NO_ELIGIBLE_REWARDS" ? "No eligible Reward Wheel prizes remain." : "The Reward Wheel is not currently available.";
  return new AppError(code, message, 409, nextSpinAt ? { nextSpinAt: nextSpinAt.toISOString() } : undefined);
}

function spinResult(spin: typeof rewardWheelSpins.$inferSelect, idempotent: boolean): RewardWheelSpinResult {
  const nextSpinAt = spin.cooldownSecondsSnapshot > 0
    ? new Date(spin.spunAt.getTime() + spin.cooldownSecondsSnapshot * 1000).toISOString()
    : null;
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
    nextSpinAt,
    idempotent,
  };
}

function safeDisplayMetadata(metadata: Record<string, unknown>) {
  return typeof metadata.tone === "string" ? { tone: metadata.tone } : {};
}
