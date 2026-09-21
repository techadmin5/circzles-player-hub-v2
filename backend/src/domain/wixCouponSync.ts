import type { Database } from "../db/client.js";
import type { couponProviderMappings } from "../db/schema.js";
import { AppError, validationFailed } from "./errors.js";
import { transitionCouponProviderMappingInTransaction, type CouponProviderGateway, type CouponProvisionRequest, type CouponProviderSyncStatus } from "./couponBridge.js";
import { WixCouponProviderError } from "../integrations/wix/wixCouponGateway.js";

export type CouponProviderMappingState = typeof couponProviderMappings.$inferSelect;

export interface CouponMappingSyncRepository {
  transition(input: {
    couponProviderMappingId: string;
    nextStatus: CouponProviderSyncStatus;
    providerCouponId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    attemptedAt: Date;
  }): Promise<CouponProviderMappingState>;
}

export class DrizzleCouponMappingSyncRepository implements CouponMappingSyncRepository {
  constructor(private db: Database) {}

  transition(input: Parameters<CouponMappingSyncRepository["transition"]>[0]) {
    return this.db.transaction((tx) => transitionCouponProviderMappingInTransaction(tx, input));
  }
}

export class WixCouponSyncService {
  constructor(
    private gateway: CouponProviderGateway,
    private repository: CouponMappingSyncRepository,
    private now: () => Date = () => new Date(),
  ) {}

  async provisionPending(items: Array<{ mapping: CouponProviderMappingState; request: CouponProvisionRequest }>) {
    const results = [];
    for (const item of items) {
      if (item.mapping.provider !== "WIX") continue;
      results.push(await this.provision(item));
    }
    return results;
  }

  async provision(input: { mapping: CouponProviderMappingState; request: CouponProvisionRequest }) {
    assertWixMapping(input.mapping);
    if (input.mapping.syncStatus !== "PENDING_CREATE") throw validationFailed("Wix coupon provisioning requires a PENDING_CREATE mapping.");
    if (input.request.provider !== "WIX" || input.request.storefrontTarget !== input.mapping.storefrontTarget || input.request.couponOwnershipId !== input.mapping.couponOwnershipId) {
      throw validationFailed("Wix coupon provisioning request does not match its mapping.");
    }
    const attemptedAt = this.now();
    try {
      const result = await this.gateway.provision(input.request);
      return await this.repository.transition({
        couponProviderMappingId: input.mapping.couponProviderMappingId,
        nextStatus: "ACTIVE",
        providerCouponId: result.providerCouponId,
        attemptedAt,
      });
    } catch (error) {
      const safe = safeWixFailure(error);
      await this.repository.transition({
        couponProviderMappingId: input.mapping.couponProviderMappingId,
        nextStatus: "ERROR",
        providerCouponId: input.mapping.providerCouponId,
        errorCode: safe.code,
        errorMessage: safe.message,
        attemptedAt,
      });
      throw safe.error;
    }
  }

  async disablePending(items: Array<{ mapping: CouponProviderMappingState; couponCode: string }>) {
    const results = [];
    for (const item of items) {
      if (item.mapping.provider !== "WIX") continue;
      results.push(await this.disable(item));
    }
    return results;
  }

  async disable(input: { mapping: CouponProviderMappingState; couponCode: string }) {
    assertWixMapping(input.mapping);
    if (input.mapping.syncStatus !== "PENDING_DISABLE") throw validationFailed("Wix coupon disable requires a PENDING_DISABLE mapping.");
    if (!input.mapping.providerCouponId) throw validationFailed("Wix coupon disable requires the stored provider coupon id.");
    const attemptedAt = this.now();
    try {
      await this.gateway.disable({ storefrontTarget: input.mapping.storefrontTarget, providerCouponId: input.mapping.providerCouponId, couponCode: input.couponCode });
      return await this.repository.transition({
        couponProviderMappingId: input.mapping.couponProviderMappingId,
        nextStatus: "DISABLED",
        providerCouponId: input.mapping.providerCouponId,
        attemptedAt,
      });
    } catch (error) {
      const safe = safeWixFailure(error);
      await this.repository.transition({
        couponProviderMappingId: input.mapping.couponProviderMappingId,
        nextStatus: "ERROR",
        providerCouponId: input.mapping.providerCouponId,
        errorCode: safe.code,
        errorMessage: safe.message,
        attemptedAt,
      });
      throw safe.error;
    }
  }
}

function assertWixMapping(mapping: CouponProviderMappingState) {
  if (mapping.provider !== "WIX" || mapping.storefrontTarget === "SHOPIFY_COGZART") {
    throw validationFailed("Wix coupon synchronization cannot operate on a Shopify mapping.", { storefront: mapping.storefrontTarget });
  }
}

function safeWixFailure(error: unknown) {
  if (error instanceof WixCouponProviderError) return { code: error.code, message: error.message, error };
  const safeError = new AppError("WIX_COUPON_SYNC_FAILED", "Wix coupon synchronization failed.", 502);
  return { code: safeError.code, message: safeError.message, error: safeError };
}
