import { and, eq, ne } from "drizzle-orm";
import { couponOwnerships, couponProviderMappings, couponRedemptions, rewardDefinitions } from "../db/schema.js";
import { AppError, validationFailed } from "./errors.js";
import { insertGameEventInTransaction } from "./gameEvents.js";
import type { GameStateTransaction } from "./gameState.js";
import { effectiveCouponStatus } from "./coupons.js";

export const couponStorefrontTargets = [
  "WIX_CIRCZLES_IN",
  "WIX_CIRCZLES_COM",
  "WIX_COGZART_IN",
  "WIX_COGZART_COM",
  "SHOPIFY_COGZART",
] as const;

export type CouponStorefrontTarget = typeof couponStorefrontTargets[number];
export type CouponProvider = "WIX" | "SHOPIFY";
export type CouponProviderSyncStatus = "PENDING_CREATE" | "ACTIVE" | "PENDING_DISABLE" | "DISABLED" | "ERROR";
export type CouponBenefit =
  | { type: "PERCENTAGE"; percentage: number }
  | { type: "FIXED_AMOUNT"; amounts: { INR: number; USD: number } };

export interface CouponProvisionRequest {
  couponOwnershipId: string;
  couponCode: string;
  storefrontTarget: CouponStorefrontTarget;
  provider: CouponProvider;
  benefit: { type: "PERCENTAGE"; percentage: number } | { type: "FIXED_AMOUNT"; currency: "INR" | "USD"; amount: number };
  startsAt: Date;
  expiresAt: Date | null;
  totalUsageLimit: 1;
  perCustomerUsageLimit: 1;
}

export interface CouponProviderGateway {
  provision(request: CouponProvisionRequest): Promise<{ providerCouponId: string }>;
  disable(input: { storefrontTarget: CouponStorefrontTarget; providerCouponId: string; couponCode: string }): Promise<void>;
}

export function providerForStorefront(target: CouponStorefrontTarget): CouponProvider {
  return target === "SHOPIFY_COGZART" ? "SHOPIFY" : "WIX";
}

export function assertStorefrontProviderPair(target: CouponStorefrontTarget, provider: CouponProvider) {
  if (!couponStorefrontTargets.includes(target) || providerForStorefront(target) !== provider) {
    throw validationFailed("Storefront and coupon provider do not match.");
  }
}

export function parseCouponBenefit(metadata: Record<string, unknown>): CouponBenefit {
  const value = metadata.couponBenefit;
  if (!isRecord(value) || (value.type !== "PERCENTAGE" && value.type !== "FIXED_AMOUNT")) {
    throw validationFailed("Coupon reward metadata must include a supported couponBenefit.");
  }
  if (value.type === "PERCENTAGE") {
    if (!isPositiveFinite(value.percentage) || value.percentage > 100) throw validationFailed("Coupon percentage must be greater than 0 and at most 100.");
    return { type: "PERCENTAGE", percentage: value.percentage };
  }
  if (!isRecord(value.amounts) || !isPositiveFinite(value.amounts.INR) || !isPositiveFinite(value.amounts.USD)) {
    throw validationFailed("Fixed-amount coupons require positive INR and USD amounts.");
  }
  return { type: "FIXED_AMOUNT", amounts: { INR: value.amounts.INR, USD: value.amounts.USD } };
}

export function buildCouponProvisionRequest(input: {
  couponOwnershipId: string;
  couponCode: string;
  storefrontTarget: CouponStorefrontTarget;
  benefit: CouponBenefit;
  issuedAt: Date;
  expiresAt: Date | null;
}): CouponProvisionRequest {
  const provider = providerForStorefront(input.storefrontTarget);
  const currency = storefrontCurrency(input.storefrontTarget);
  const benefit = input.benefit.type === "PERCENTAGE"
    ? input.benefit
    : { type: "FIXED_AMOUNT" as const, currency, amount: input.benefit.amounts[currency] };
  return {
    couponOwnershipId: input.couponOwnershipId,
    couponCode: input.couponCode,
    storefrontTarget: input.storefrontTarget,
    provider,
    benefit,
    startsAt: input.issuedAt,
    expiresAt: input.expiresAt,
    totalUsageLimit: 1,
    perCustomerUsageLimit: 1,
  };
}

export async function ensureCouponProviderMappingInTransaction(tx: GameStateTransaction, input: {
  couponOwnershipId: string;
  storefrontTarget: CouponStorefrontTarget;
  provider: CouponProvider;
  now?: Date;
}) {
  assertStorefrontProviderPair(input.storefrontTarget, input.provider);
  const [ownership] = await tx.select({ couponOwnershipId: couponOwnerships.couponOwnershipId }).from(couponOwnerships)
    .where(eq(couponOwnerships.couponOwnershipId, input.couponOwnershipId)).limit(1).for("update");
  if (!ownership) throw new AppError("COUPON_NOT_FOUND", "Coupon ownership was not found.", 404);

  const [existing] = await tx.select().from(couponProviderMappings).where(and(
    eq(couponProviderMappings.couponOwnershipId, input.couponOwnershipId),
    eq(couponProviderMappings.storefrontTarget, input.storefrontTarget),
  )).limit(1);
  if (existing) {
    if (existing.provider !== input.provider) throw new AppError("COUPON_MAPPING_CONFLICT", "Coupon storefront mapping has a conflicting provider.", 409);
    return { mapping: existing, idempotent: true };
  }

  const now = input.now ?? new Date();
  const [mapping] = await tx.insert(couponProviderMappings).values({
    couponOwnershipId: input.couponOwnershipId,
    storefrontTarget: input.storefrontTarget,
    provider: input.provider,
    createdAt: now,
    updatedAt: now,
  }).returning();
  if (!mapping) throw new AppError("COUPON_MAPPING_WRITE_FAILED", "Could not create coupon storefront mapping.", 500);
  return { mapping, idempotent: false };
}

export async function createCouponProvisioningPlanInTransaction(tx: GameStateTransaction, couponOwnershipId: string, now = new Date()) {
  const [row] = await tx.select({ ownership: couponOwnerships, rewardMetadata: rewardDefinitions.metadata }).from(couponOwnerships)
    .innerJoin(rewardDefinitions, eq(couponOwnerships.rewardDefinitionId, rewardDefinitions.rewardDefinitionId))
    .where(eq(couponOwnerships.couponOwnershipId, couponOwnershipId)).limit(1).for("update");
  if (!row) throw new AppError("COUPON_NOT_FOUND", "Coupon ownership was not found.", 404);
  if (effectiveCouponStatus(row.ownership.status, row.ownership.expiresAt, now) !== "ACTIVE") {
    throw new AppError("COUPON_NOT_ACTIVE", "Only active coupons can be prepared for provider provisioning.", 409);
  }

  const benefit = parseCouponBenefit(row.rewardMetadata);
  const mappings = [];
  for (const storefrontTarget of couponStorefrontTargets) {
    const result = await ensureCouponProviderMappingInTransaction(tx, {
      couponOwnershipId,
      storefrontTarget,
      provider: providerForStorefront(storefrontTarget),
      now,
    });
    mappings.push(result.mapping);
  }
  return {
    mappings,
    requests: couponStorefrontTargets.map((storefrontTarget) => buildCouponProvisionRequest({
      couponOwnershipId,
      couponCode: row.ownership.couponCode,
      storefrontTarget,
      benefit,
      issuedAt: row.ownership.issuedAt,
      expiresAt: row.ownership.expiresAt,
    })),
  };
}

const allowedSyncTransitions: Record<CouponProviderSyncStatus, CouponProviderSyncStatus[]> = {
  PENDING_CREATE: ["ACTIVE", "PENDING_DISABLE", "ERROR"],
  ACTIVE: ["PENDING_DISABLE", "ERROR"],
  PENDING_DISABLE: ["DISABLED", "ERROR"],
  DISABLED: [],
  ERROR: ["PENDING_CREATE", "ACTIVE", "PENDING_DISABLE"],
};

export function assertCouponProviderSyncTransition(current: CouponProviderSyncStatus, next: CouponProviderSyncStatus) {
  if (!allowedSyncTransitions[current].includes(next)) throw validationFailed(`Invalid coupon provider mapping transition: ${current} -> ${next}.`);
}

export async function transitionCouponProviderMappingInTransaction(tx: GameStateTransaction, input: {
  couponProviderMappingId: string;
  nextStatus: CouponProviderSyncStatus;
  providerCouponId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  attemptedAt?: Date;
}) {
  const [mapping] = await tx.select().from(couponProviderMappings)
    .where(eq(couponProviderMappings.couponProviderMappingId, input.couponProviderMappingId)).limit(1).for("update");
  if (!mapping) throw new AppError("COUPON_MAPPING_NOT_FOUND", "Coupon storefront mapping was not found.", 404);
  assertCouponProviderSyncTransition(mapping.syncStatus, input.nextStatus);
  const attemptedAt = input.attemptedAt ?? new Date();
  if (Number.isNaN(attemptedAt.getTime())) throw validationFailed("Coupon provider sync time must be valid.");
  const providerCouponId = input.providerCouponId === undefined ? mapping.providerCouponId : input.providerCouponId?.trim() || null;
  if (providerCouponId && providerCouponId.length > 200) throw validationFailed("Provider coupon id must be at most 200 characters.");
  if (input.nextStatus === "ACTIVE" && !providerCouponId) throw validationFailed("An active coupon mapping requires a provider coupon id.");
  if (input.nextStatus === "ERROR" && !input.errorCode?.trim()) throw validationFailed("An error mapping requires an error code.");

  const [updated] = await tx.update(couponProviderMappings).set({
    providerCouponId,
    syncStatus: input.nextStatus,
    lastSyncAttemptAt: attemptedAt,
    lastSyncSucceededAt: input.nextStatus === "ACTIVE" || input.nextStatus === "DISABLED" ? attemptedAt : mapping.lastSyncSucceededAt,
    lastErrorCode: input.nextStatus === "ERROR" ? input.errorCode!.trim() : null,
    lastErrorMessage: input.nextStatus === "ERROR" ? input.errorMessage?.trim() || null : null,
    disabledAt: input.nextStatus === "DISABLED" ? attemptedAt : null,
    updatedAt: attemptedAt,
  }).where(eq(couponProviderMappings.couponProviderMappingId, input.couponProviderMappingId)).returning();
  if (!updated) throw new AppError("COUPON_MAPPING_WRITE_FAILED", "Could not update coupon storefront mapping.", 500);
  return updated;
}

export interface CouponRedemptionInput {
  couponOwnershipId: string;
  storefrontTarget: CouponStorefrontTarget;
  sourceRedemptionId: string;
  idempotencyKey: string;
  redeemedAt?: Date;
}

export async function recordCouponRedemptionInTransaction(tx: GameStateTransaction, input: CouponRedemptionInput) {
  validateRedemptionInput(input);
  const [ownership] = await tx.select().from(couponOwnerships).where(eq(couponOwnerships.couponOwnershipId, input.couponOwnershipId)).limit(1).for("update");
  if (!ownership) throw new AppError("COUPON_NOT_FOUND", "Coupon ownership was not found.", 404);

  const [existing] = await tx.select().from(couponRedemptions).where(eq(couponRedemptions.couponOwnershipId, input.couponOwnershipId)).limit(1);
  if (existing) {
    const same = existing.storefrontTarget === input.storefrontTarget
      && existing.sourceRedemptionId === input.sourceRedemptionId
      && existing.idempotencyKey === input.idempotencyKey;
    if (!same) throw new AppError("COUPON_ALREADY_REDEEMED", "Coupon ownership was already redeemed by another operation.", 409);
    return { ownership, redemption: existing, idempotent: true };
  }

  const redeemedAt = input.redeemedAt ?? new Date();
  const effectiveStatus = effectiveCouponStatus(ownership.status, ownership.expiresAt, redeemedAt);
  if (effectiveStatus === "REVOKED") throw new AppError("COUPON_REVOKED", "Revoked coupons cannot be redeemed.", 409);
  if (effectiveStatus === "EXPIRED") throw new AppError("COUPON_EXPIRED", "Expired coupons cannot be redeemed.", 409);
  if (effectiveStatus !== "ACTIVE") throw new AppError("COUPON_ALREADY_REDEEMED", "Coupon ownership was already redeemed.", 409);

  const [mapping] = await tx.select().from(couponProviderMappings).where(and(
    eq(couponProviderMappings.couponOwnershipId, input.couponOwnershipId),
    eq(couponProviderMappings.storefrontTarget, input.storefrontTarget),
  )).limit(1);
  if (!mapping || mapping.syncStatus === "DISABLED") throw new AppError("COUPON_STOREFRONT_NOT_ACTIVE", "Coupon is not available on the reported storefront.", 409);

  const [sourceReplay] = await tx.select().from(couponRedemptions).where(and(
    eq(couponRedemptions.storefrontTarget, input.storefrontTarget),
    eq(couponRedemptions.sourceRedemptionId, input.sourceRedemptionId),
  )).limit(1);
  if (sourceReplay) throw new AppError("IDEMPOTENCY_CONFLICT", "Provider redemption identity was already used for another coupon.", 409);

  const [redemption] = await tx.insert(couponRedemptions).values({ ...input, redeemedAt }).returning();
  if (!redemption) throw new AppError("COUPON_REDEMPTION_WRITE_FAILED", "Could not record coupon redemption.", 500);

  const [redeemedOwnership] = await tx.update(couponOwnerships).set({ status: "REDEEMED", redeemedAt }).where(eq(couponOwnerships.couponOwnershipId, input.couponOwnershipId)).returning();
  if (!redeemedOwnership) throw new AppError("COUPON_REDEMPTION_WRITE_FAILED", "Could not update coupon ownership redemption state.", 500);
  await tx.update(couponProviderMappings).set({ syncStatus: "PENDING_DISABLE", disabledAt: null, updatedAt: redeemedAt }).where(and(
    eq(couponProviderMappings.couponOwnershipId, input.couponOwnershipId),
    ne(couponProviderMappings.syncStatus, "DISABLED"),
  ));
  await insertGameEventInTransaction(tx, {
    playerId: ownership.playerId,
    eventType: "coupon.redeemed",
    sourceType: "COUPON_REDEMPTION",
    sourceId: redemption.couponRedemptionId,
    idempotencyKey: `coupon.redeemed:${redemption.couponRedemptionId}`,
    payload: { couponOwnershipId: input.couponOwnershipId, storefrontTarget: input.storefrontTarget, redeemedAt: redeemedAt.toISOString() },
  });
  return { ownership: redeemedOwnership, redemption, idempotent: false };
}

function validateRedemptionInput(input: CouponRedemptionInput) {
  if (!couponStorefrontTargets.includes(input.storefrontTarget)) throw validationFailed("Unsupported coupon storefront target.");
  if (!input.couponOwnershipId || !input.sourceRedemptionId.trim() || !input.idempotencyKey.trim()) throw validationFailed("Coupon redemption identity is required.");
  if (input.sourceRedemptionId.length > 200 || input.idempotencyKey.length > 200) throw validationFailed("Coupon redemption identifiers must be at most 200 characters.");
  if (input.redeemedAt && Number.isNaN(input.redeemedAt.getTime())) throw validationFailed("Coupon redemption time must be valid.");
}

function storefrontCurrency(target: CouponStorefrontTarget): "INR" | "USD" {
  return target === "WIX_CIRCZLES_IN" || target === "WIX_COGZART_IN" ? "INR" : "USD";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
