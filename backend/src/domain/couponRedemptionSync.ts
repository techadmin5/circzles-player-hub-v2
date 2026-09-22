import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { couponOwnerships, couponProviderMappings } from "../db/schema.js";
import { AppError, validationFailed } from "./errors.js";
import {
  recordCouponRedemptionInTransaction,
  transitionCouponProviderMappingInTransaction,
  type CouponProvider,
  type CouponStorefrontTarget,
} from "./couponBridge.js";
import type { CouponProviderMappingState } from "./wixCouponSync.js";

export interface ProviderCouponRedemptionEvent {
  provider: CouponProvider;
  storefrontTarget: CouponStorefrontTarget;
  providerEventId: string;
  providerOrderId: string;
  couponCodes: string[];
  redeemedAt: Date;
}

export interface CouponRedemptionSyncResult {
  status: "IGNORED" | "REDEEMED" | "DUPLICATE";
  couponRedemptionId?: string;
}

interface AuthoritativeRedemptionResult {
  status: CouponRedemptionSyncResult["status"];
  couponRedemptionId?: string;
  couponCode?: string;
  mappings: CouponProviderMappingState[];
}

export interface CouponRedemptionSyncRepository {
  record(event: ProviderCouponRedemptionEvent): Promise<AuthoritativeRedemptionResult>;
}

export interface CouponDisableService {
  disable(input: { mapping: CouponProviderMappingState; couponCode: string }): Promise<unknown>;
}

export class DrizzleCouponRedemptionSyncRepository implements CouponRedemptionSyncRepository {
  constructor(private db: Database) {}

  record(event: ProviderCouponRedemptionEvent) {
    return this.db.transaction(async (tx) => {
      const matches = await tx.select({ ownership: couponOwnerships })
        .from(couponOwnerships)
        .innerJoin(couponProviderMappings, and(
          eq(couponProviderMappings.couponOwnershipId, couponOwnerships.couponOwnershipId),
          eq(couponProviderMappings.storefrontTarget, event.storefrontTarget),
        ))
        .where(inArray(couponOwnerships.couponCode, event.couponCodes))
        .limit(2);

      if (matches.length === 0) return { status: "IGNORED" as const, mappings: [] };
      if (matches.length > 1) {
        throw new AppError("COUPON_REDEMPTION_AMBIGUOUS", "Provider event matched multiple CircZles coupons.", 409);
      }

      const ownership = matches[0].ownership;
      const idempotencyKey = redemptionIdempotencyKey(event);
      const recorded = await recordCouponRedemptionInTransaction(tx, {
        couponOwnershipId: ownership.couponOwnershipId,
        storefrontTarget: event.storefrontTarget,
        sourceRedemptionId: event.providerEventId,
        idempotencyKey,
        redeemedAt: event.redeemedAt,
      });

      const retryableMappings = await tx.select().from(couponProviderMappings).where(and(
        eq(couponProviderMappings.couponOwnershipId, ownership.couponOwnershipId),
        inArray(couponProviderMappings.syncStatus, ["PENDING_DISABLE", "ERROR"]),
        isNotNull(couponProviderMappings.providerCouponId),
      ));
      const mappings: CouponProviderMappingState[] = [];
      for (const mapping of retryableMappings) {
        mappings.push(mapping.syncStatus === "ERROR"
          ? await transitionCouponProviderMappingInTransaction(tx, {
            couponProviderMappingId: mapping.couponProviderMappingId,
            nextStatus: "PENDING_DISABLE",
            attemptedAt: new Date(),
          })
          : mapping);
      }

      return {
        status: recorded.idempotent ? "DUPLICATE" as const : "REDEEMED" as const,
        couponRedemptionId: recorded.redemption.couponRedemptionId,
        couponCode: ownership.couponCode,
        mappings,
      };
    });
  }
}

export class CouponRedemptionSyncService {
  constructor(
    private repository: CouponRedemptionSyncRepository,
    private wixSync: CouponDisableService,
    private shopifySync: CouponDisableService,
  ) {}

  async synchronize(event: ProviderCouponRedemptionEvent): Promise<CouponRedemptionSyncResult> {
    validateProviderEvent(event);
    const authoritative = await this.repository.record(event);
    if (authoritative.status === "IGNORED") return { status: "IGNORED" };

    const attempts = authoritative.mappings
      .filter((mapping) => mapping.syncStatus === "PENDING_DISABLE")
      .map((mapping) => (mapping.provider === "WIX" ? this.wixSync : this.shopifySync)
        .disable({ mapping, couponCode: authoritative.couponCode! }));
    const settled = await Promise.allSettled(attempts);
    if (settled.some((result) => result.status === "rejected")) {
      throw new AppError(
        "COUPON_DISABLE_RECONCILIATION_FAILED",
        "Coupon redemption was recorded, but provider disable reconciliation must be retried.",
        502,
      );
    }
    return { status: authoritative.status, couponRedemptionId: authoritative.couponRedemptionId };
  }
}

export function redemptionIdempotencyKey(event: ProviderCouponRedemptionEvent) {
  const material = [
    event.provider,
    event.storefrontTarget,
    event.providerEventId,
    event.providerOrderId,
    event.redeemedAt.toISOString(),
    [...event.couponCodes].sort().join(","),
  ].join("\n");
  return `provider-redemption:${createHash("sha256").update(material).digest("hex")}`;
}

function validateProviderEvent(event: ProviderCouponRedemptionEvent) {
  const expectedProvider = event.storefrontTarget === "SHOPIFY_COGZART" ? "SHOPIFY" : "WIX";
  if (event.provider !== expectedProvider) throw validationFailed("Provider and storefront do not match.");
  if (!event.providerEventId.trim() || event.providerEventId.length > 200) throw validationFailed("Provider event id is invalid.");
  if (!event.providerOrderId.trim() || event.providerOrderId.length > 200) throw validationFailed("Provider order id is invalid.");
  if (Number.isNaN(event.redeemedAt.getTime())) throw validationFailed("Provider redemption time is invalid.");
  if (event.couponCodes.length === 0 || event.couponCodes.length > 100
    || event.couponCodes.some((code) => !/^[A-Z0-9]{1,20}$/.test(code))) {
    throw validationFailed("Provider coupon codes are invalid.");
  }
}
