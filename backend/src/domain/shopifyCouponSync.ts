import type { Database } from "../db/client.js";
import type { couponProviderMappings } from "../db/schema.js";
import { AppError, validationFailed } from "./errors.js";
import {
  transitionCouponProviderMappingInTransaction,
  type CouponProviderGateway,
  type CouponProvisionRequest,
  type CouponProviderSyncStatus,
} from "./couponBridge.js";
import { ShopifyCouponProviderError } from "../integrations/shopify/shopifyCouponGateway.js";

export type ShopifyCouponProviderMappingState = typeof couponProviderMappings.$inferSelect;

export interface ShopifyCouponMappingSyncRepository {
  transition(input: {
    couponProviderMappingId: string;
    nextStatus: CouponProviderSyncStatus;
    providerCouponId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    attemptedAt: Date;
  }): Promise<ShopifyCouponProviderMappingState>;
}

export class DrizzleShopifyCouponMappingSyncRepository implements ShopifyCouponMappingSyncRepository {
  constructor(private db: Database) {}

  transition(input: Parameters<ShopifyCouponMappingSyncRepository["transition"]>[0]) {
    return this.db.transaction((tx) => transitionCouponProviderMappingInTransaction(tx, input));
  }
}

export class ShopifyCouponSyncService {
  constructor(
    private gateway: CouponProviderGateway,
    private repository: ShopifyCouponMappingSyncRepository,
    private now: () => Date = () => new Date(),
  ) {}

  async provisionPending(items: Array<{ mapping: ShopifyCouponProviderMappingState; request: CouponProvisionRequest }>) {
    const results = [];
    for (const item of items) {
      if (item.mapping.provider !== "SHOPIFY") continue;
      results.push(await this.provision(item));
    }
    return results;
  }

  async provision(input: { mapping: ShopifyCouponProviderMappingState; request: CouponProvisionRequest }) {
    assertShopifyMapping(input.mapping);
    if (input.mapping.syncStatus !== "PENDING_CREATE") {
      throw validationFailed("Shopify coupon provisioning requires a PENDING_CREATE mapping.");
    }
    if (input.request.provider !== "SHOPIFY" || input.request.storefrontTarget !== input.mapping.storefrontTarget
      || input.request.couponOwnershipId !== input.mapping.couponOwnershipId) {
      throw validationFailed("Shopify coupon provisioning request does not match its mapping.");
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
      const safe = safeShopifyFailure(error);
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

  async disablePending(items: Array<{ mapping: ShopifyCouponProviderMappingState; couponCode: string }>) {
    const results = [];
    for (const item of items) {
      if (item.mapping.provider !== "SHOPIFY") continue;
      results.push(await this.disable(item));
    }
    return results;
  }

  async disable(input: { mapping: ShopifyCouponProviderMappingState; couponCode: string }) {
    assertShopifyMapping(input.mapping);
    if (input.mapping.syncStatus !== "PENDING_DISABLE") {
      throw validationFailed("Shopify coupon disable requires a PENDING_DISABLE mapping.");
    }
    if (!input.mapping.providerCouponId) {
      throw validationFailed("Shopify coupon disable requires the stored provider coupon id.");
    }
    const attemptedAt = this.now();
    try {
      await this.gateway.disable({
        storefrontTarget: input.mapping.storefrontTarget,
        providerCouponId: input.mapping.providerCouponId,
        couponCode: input.couponCode,
      });
      return await this.repository.transition({
        couponProviderMappingId: input.mapping.couponProviderMappingId,
        nextStatus: "DISABLED",
        providerCouponId: input.mapping.providerCouponId,
        attemptedAt,
      });
    } catch (error) {
      const safe = safeShopifyFailure(error);
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

function assertShopifyMapping(mapping: ShopifyCouponProviderMappingState) {
  if (mapping.provider !== "SHOPIFY" || mapping.storefrontTarget !== "SHOPIFY_COGZART") {
    throw validationFailed("Shopify coupon synchronization requires a SHOPIFY_COGZART mapping.", {
      storefront: mapping.storefrontTarget,
    });
  }
}

function safeShopifyFailure(error: unknown) {
  if (error instanceof ShopifyCouponProviderError) return { code: error.code, message: error.message, error };
  const safeError = new AppError("SHOPIFY_COUPON_SYNC_FAILED", "Shopify coupon synchronization failed.", 502);
  return { code: safeError.code, message: safeError.message, error: safeError };
}
