import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { couponOwnerships, rewardDefinitions } from "../db/schema.js";
import { AppError, validationFailed } from "./errors.js";
import { insertGameEventInTransaction } from "./gameEvents.js";
import type { GameStateTransaction } from "./gameState.js";
import type { RewardDefinitionType } from "./rewardCatalog.js";

export type CouponStoredStatus = "ACTIVE" | "REDEEMED" | "REVOKED";
export type CouponEffectiveStatus = CouponStoredStatus | "EXPIRED";

export interface CouponGrantInput {
  playerId: string;
  rewardDefinitionId: string;
  rewardType: RewardDefinitionType;
  quantity: number;
  sourceType: string;
  sourceId: string;
  idempotencyKey: string;
  issuedAt?: Date;
  expiresAt?: Date | null;
}

export interface CouponDto {
  couponOwnershipId: string;
  rewardDefinitionId: string;
  rewardCode: string;
  name: string;
  description: string;
  imageUrl: string | null;
  rarity: string | null;
  status: CouponEffectiveStatus;
  issuedAt: string;
  expiresAt: string | null;
  displayMetadata: Record<string, string>;
}

export async function grantCouponOwnershipInTransaction(tx: GameStateTransaction, input: CouponGrantInput) {
  validateCouponGrant(input);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.playerId}:coupon-grant`}, 0))`);

  const replay = await tx.select().from(couponOwnerships).where(and(
    eq(couponOwnerships.playerId, input.playerId),
    eq(couponOwnerships.idempotencyKey, input.idempotencyKey),
  )).orderBy(asc(couponOwnerships.issuanceOrdinal));
  if (replay.length) {
    assertCouponReplay(replay, input);
    return { ownerships: replay, idempotent: true };
  }

  const existingSource = await tx.select().from(couponOwnerships).where(and(
    eq(couponOwnerships.playerId, input.playerId),
    eq(couponOwnerships.sourceType, input.sourceType),
    eq(couponOwnerships.sourceId, input.sourceId),
  )).limit(1);
  if (existingSource.length) throw new AppError("IDEMPOTENCY_CONFLICT", "Coupon issuance source was already recorded with another idempotency key.", 409);

  const [reward] = await tx.select({ rewardType: rewardDefinitions.rewardType }).from(rewardDefinitions).where(eq(rewardDefinitions.rewardDefinitionId, input.rewardDefinitionId)).limit(1).for("share");
  if (!reward || reward.rewardType !== "COUPON") throw new AppError("COUPON_REWARD_REQUIRED", "Coupon ownership requires a COUPON reward definition.", 409);

  const issuedAt = input.issuedAt ?? new Date();
  const ownerships = await tx.insert(couponOwnerships).values(Array.from({ length: input.quantity }, (_, index) => ({
    playerId: input.playerId,
    rewardDefinitionId: input.rewardDefinitionId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    issuanceOrdinal: index + 1,
    idempotencyKey: input.idempotencyKey,
    issuedAt,
    expiresAt: input.expiresAt ?? null,
  }))).returning();
  if (ownerships.length !== input.quantity) throw new AppError("COUPON_ISSUANCE_FAILED", "Could not record coupon ownership.", 500);

  await insertGameEventInTransaction(tx, {
    playerId: input.playerId,
    eventType: "coupon.issued",
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    idempotencyKey: `coupon.issued:${ownerships[0].couponOwnershipId}`,
    payload: { rewardDefinitionId: input.rewardDefinitionId, quantity: input.quantity, sourceType: input.sourceType, expiresAt: input.expiresAt?.toISOString() ?? null },
  });
  return { ownerships, idempotent: false };
}

export interface CouponRepository { list(playerId: string, now: Date): Promise<CouponDto[]> }

export class CouponService {
  constructor(private repo: CouponRepository) {}
  list(playerId: string, now = new Date()) {
    if (!playerId || Number.isNaN(now.getTime())) throw validationFailed("Player and a valid coupon status time are required.");
    return this.repo.list(playerId, now);
  }
}

export class DrizzleCouponRepository implements CouponRepository {
  constructor(private db: Database) {}

  async list(playerId: string, now: Date): Promise<CouponDto[]> {
    const rows = await this.db.select({ ownership: couponOwnerships, reward: rewardDefinitions }).from(couponOwnerships)
      .innerJoin(rewardDefinitions, eq(couponOwnerships.rewardDefinitionId, rewardDefinitions.rewardDefinitionId))
      .where(eq(couponOwnerships.playerId, playerId))
      .orderBy(asc(couponOwnerships.issuedAt), asc(couponOwnerships.couponOwnershipId));
    return rows.map(({ ownership, reward }) => ({
      couponOwnershipId: ownership.couponOwnershipId,
      rewardDefinitionId: ownership.rewardDefinitionId,
      rewardCode: reward.code,
      name: reward.name,
      description: reward.description,
      imageUrl: reward.imageUrl,
      rarity: reward.rarity,
      status: effectiveCouponStatus(ownership.status, ownership.expiresAt, now),
      issuedAt: ownership.issuedAt.toISOString(),
      expiresAt: ownership.expiresAt?.toISOString() ?? null,
      displayMetadata: safeCouponDisplayMetadata(reward.metadata),
    }));
  }
}

export function effectiveCouponStatus(status: CouponStoredStatus, expiresAt: Date | null, now: Date): CouponEffectiveStatus {
  return status === "ACTIVE" && expiresAt && now >= expiresAt ? "EXPIRED" : status;
}

export function validateCouponGrant(input: CouponGrantInput) {
  if (input.rewardType !== "COUPON") throw new AppError("COUPON_REWARD_REQUIRED", "Coupon ownership requires reward type COUPON.", 409);
  if (!input.playerId || !input.rewardDefinitionId || !input.sourceType.trim() || !input.sourceId.trim() || !input.idempotencyKey.trim()) throw validationFailed("Coupon grant identity and source are required.");
  if (input.sourceType.length > 200 || input.sourceId.length > 200 || input.idempotencyKey.length > 200) throw validationFailed("Coupon grant source and idempotency values must be at most 200 characters.");
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw validationFailed("Coupon grant quantity must be a positive integer.");
  const issuedAt = input.issuedAt ?? new Date();
  if (Number.isNaN(issuedAt.getTime()) || (input.expiresAt && (Number.isNaN(input.expiresAt.getTime()) || input.expiresAt <= issuedAt))) throw validationFailed("Coupon expiry must be after issuance.");
}

function assertCouponReplay(existing: Array<typeof couponOwnerships.$inferSelect>, input: CouponGrantInput) {
  const expiresAt = input.expiresAt?.getTime() ?? null;
  const matches = existing.length === input.quantity && existing.every((ownership, index) => ownership.rewardDefinitionId === input.rewardDefinitionId
    && ownership.sourceType === input.sourceType
    && ownership.sourceId === input.sourceId
    && ownership.issuanceOrdinal === index + 1
    && (ownership.expiresAt?.getTime() ?? null) === expiresAt);
  if (!matches) throw new AppError("IDEMPOTENCY_CONFLICT", "Coupon issuance key was already used for another operation.", 409);
}

function safeCouponDisplayMetadata(metadata: Record<string, unknown>) {
  const safe: Record<string, string> = {};
  for (const key of ["discountLabel", "terms", "minimumSpendLabel"]) if (typeof metadata[key] === "string") safe[key] = metadata[key];
  return safe;
}
