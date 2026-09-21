import { describe, expect, it } from "vitest";
import type { CouponProviderGateway, CouponProvisionRequest } from "../src/domain/couponBridge.js";
import {
  ShopifyCouponSyncService,
  type ShopifyCouponMappingSyncRepository,
  type ShopifyCouponProviderMappingState,
} from "../src/domain/shopifyCouponSync.js";
import { ShopifyCouponProviderError } from "../src/integrations/shopify/shopifyCouponGateway.js";

function mapping(overrides: Partial<ShopifyCouponProviderMappingState> = {}): ShopifyCouponProviderMappingState {
  return {
    couponProviderMappingId: "mapping-shopify",
    couponOwnershipId: "70000000-0000-4000-8000-000000000001",
    storefrontTarget: "SHOPIFY_COGZART",
    provider: "SHOPIFY",
    providerCouponId: null,
    syncStatus: "PENDING_CREATE",
    lastSyncAttemptAt: null,
    lastSyncSucceededAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    disabledAt: null,
    createdAt: new Date("2026-09-21T05:00:00.000Z"),
    updatedAt: new Date("2026-09-21T05:00:00.000Z"),
    ...overrides,
  };
}

function request(overrides: Partial<CouponProvisionRequest> = {}): CouponProvisionRequest {
  return {
    couponOwnershipId: "70000000-0000-4000-8000-000000000001",
    couponCode: "CZ95F70BA56FDCF99B",
    storefrontTarget: "SHOPIFY_COGZART",
    provider: "SHOPIFY",
    benefit: { type: "PERCENTAGE", percentage: 20 },
    startsAt: new Date("2026-09-21T05:00:00.000Z"),
    expiresAt: null,
    totalUsageLimit: 1,
    perCustomerUsageLimit: 1,
    ...overrides,
  };
}

class MappingRepository implements ShopifyCouponMappingSyncRepository {
  transitions: Parameters<ShopifyCouponMappingSyncRepository["transition"]>[0][] = [];
  constructor(public current: ShopifyCouponProviderMappingState) {}

  async transition(input: Parameters<ShopifyCouponMappingSyncRepository["transition"]>[0]) {
    this.transitions.push(input);
    this.current = {
      ...this.current,
      providerCouponId: input.providerCouponId === undefined ? this.current.providerCouponId : input.providerCouponId,
      syncStatus: input.nextStatus,
      lastSyncAttemptAt: input.attemptedAt,
      lastSyncSucceededAt: input.nextStatus === "ACTIVE" || input.nextStatus === "DISABLED"
        ? input.attemptedAt
        : this.current.lastSyncSucceededAt,
      lastErrorCode: input.nextStatus === "ERROR" ? input.errorCode ?? null : null,
      lastErrorMessage: input.nextStatus === "ERROR" ? input.errorMessage ?? null : null,
      disabledAt: input.nextStatus === "DISABLED" ? input.attemptedAt : null,
      updatedAt: input.attemptedAt,
    };
    return this.current;
  }
}

describe("Shopify coupon mapping orchestration", () => {
  const attemptedAt = new Date("2026-09-21T06:00:00.000Z");
  const providerCouponId = "gid://shopify/DiscountCodeNode/123456789";

  it("stores the provider GID and moves successful provisioning to ACTIVE", async () => {
    const current = mapping({ lastErrorCode: "OLD", lastErrorMessage: "old error" });
    const repository = new MappingRepository(current);
    const gateway: CouponProviderGateway = {
      provision: async () => ({ providerCouponId }),
      disable: async () => undefined,
    };
    const service = new ShopifyCouponSyncService(gateway, repository, () => attemptedAt);
    await expect(service.provision({ mapping: current, request: request() })).resolves.toMatchObject({
      syncStatus: "ACTIVE",
      providerCouponId,
      lastErrorCode: null,
      lastSyncSucceededAt: attemptedAt,
    });
  });

  it("moves a safe provider failure to ERROR", async () => {
    const current = mapping();
    const repository = new MappingRepository(current);
    const providerError = new ShopifyCouponProviderError(
      "SHOPIFY_COUPON_HTTP_ERROR",
      "Shopify coupon request was rejected.",
      { storefront: "SHOPIFY_COGZART", operation: "CREATE", httpStatus: 429 },
    );
    const gateway: CouponProviderGateway = {
      provision: async () => { throw providerError; },
      disable: async () => undefined,
    };
    const service = new ShopifyCouponSyncService(gateway, repository, () => attemptedAt);
    await expect(service.provision({ mapping: current, request: request() })).rejects.toBe(providerError);
    expect(repository.current).toMatchObject({
      syncStatus: "ERROR",
      lastErrorCode: "SHOPIFY_COUPON_HTTP_ERROR",
      lastErrorMessage: "Shopify coupon request was rejected.",
    });
  });

  it("moves successful deactivation to DISABLED while preserving the provider GID", async () => {
    const current = mapping({ syncStatus: "PENDING_DISABLE", providerCouponId });
    const repository = new MappingRepository(current);
    const disabled: string[] = [];
    const gateway: CouponProviderGateway = {
      provision: async () => ({ providerCouponId: "unused" }),
      disable: async (input) => { disabled.push(input.providerCouponId); },
    };
    const service = new ShopifyCouponSyncService(gateway, repository, () => attemptedAt);
    await expect(service.disable({ mapping: current, couponCode: "CZ95F70BA56FDCF99B" })).resolves.toMatchObject({
      syncStatus: "DISABLED",
      providerCouponId,
      disabledAt: attemptedAt,
    });
    expect(disabled).toEqual([providerCouponId]);
  });

  it("records deactivation failures without changing authoritative ownership", async () => {
    const ownership = { status: "REDEEMED" };
    const current = mapping({ syncStatus: "PENDING_DISABLE", providerCouponId });
    const repository = new MappingRepository(current);
    const providerError = new ShopifyCouponProviderError(
      "SHOPIFY_COUPON_HTTP_ERROR",
      "Shopify coupon request was rejected.",
      { storefront: "SHOPIFY_COGZART", operation: "DISABLE", httpStatus: 500 },
    );
    const gateway: CouponProviderGateway = {
      provision: async () => ({ providerCouponId: "unused" }),
      disable: async () => { throw providerError; },
    };
    const service = new ShopifyCouponSyncService(gateway, repository, () => attemptedAt);
    await expect(service.disable({ mapping: current, couponCode: "CZ95F70BA56FDCF99B" })).rejects.toBe(providerError);
    expect(repository.current).toMatchObject({
      syncStatus: "ERROR",
      providerCouponId,
      lastErrorCode: "SHOPIFY_COUPON_HTTP_ERROR",
    });
    expect(ownership.status).toBe("REDEEMED");
  });

  it("skips Wix mappings in Shopify batch operations", async () => {
    const shopify = mapping();
    const wix = mapping({ couponProviderMappingId: "mapping-wix", storefrontTarget: "WIX_CIRCZLES_IN", provider: "WIX" });
    const repository = new MappingRepository(shopify);
    const calls: string[] = [];
    const gateway: CouponProviderGateway = {
      provision: async (input) => { calls.push(input.storefrontTarget); return { providerCouponId }; },
      disable: async () => undefined,
    };
    const service = new ShopifyCouponSyncService(gateway, repository, () => attemptedAt);
    const results = await service.provisionPending([
      { mapping: shopify, request: request() },
      { mapping: wix, request: request({ storefrontTarget: "WIX_CIRCZLES_IN", provider: "WIX" }) },
    ]);
    expect(results).toHaveLength(1);
    expect(calls).toEqual(["SHOPIFY_COGZART"]);
    expect(repository.transitions).toHaveLength(1);
  });

  it("rejects a direct Wix mapping before provider work", async () => {
    const wix = mapping({ storefrontTarget: "WIX_CIRCZLES_IN", provider: "WIX" });
    const repository = new MappingRepository(wix);
    let calls = 0;
    const gateway: CouponProviderGateway = {
      provision: async () => { calls += 1; return { providerCouponId }; },
      disable: async () => undefined,
    };
    const service = new ShopifyCouponSyncService(gateway, repository, () => attemptedAt);
    await expect(service.provision({ mapping: wix, request: request() })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(calls).toBe(0);
  });
});
