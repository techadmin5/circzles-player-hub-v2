import { describe, expect, it } from "vitest";
import type { CouponProviderGateway, CouponProvisionRequest } from "../src/domain/couponBridge.js";
import { WixCouponSyncService, type CouponMappingSyncRepository, type CouponProviderMappingState } from "../src/domain/wixCouponSync.js";
import { WixCouponProviderError } from "../src/integrations/wix/wixCouponGateway.js";

function mapping(overrides: Partial<CouponProviderMappingState> = {}): CouponProviderMappingState {
  return {
    couponProviderMappingId: "mapping-1",
    couponOwnershipId: "70000000-0000-4000-8000-000000000001",
    storefrontTarget: "WIX_CIRCZLES_IN",
    provider: "WIX",
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
    storefrontTarget: "WIX_CIRCZLES_IN",
    provider: "WIX",
    benefit: { type: "PERCENTAGE", percentage: 20 },
    startsAt: new Date("2026-09-21T05:00:00.000Z"),
    expiresAt: null,
    totalUsageLimit: 1,
    perCustomerUsageLimit: 1,
    ...overrides,
  };
}

class MappingRepository implements CouponMappingSyncRepository {
  transitions: Parameters<CouponMappingSyncRepository["transition"]>[0][] = [];
  constructor(public current: CouponProviderMappingState) {}

  async transition(input: Parameters<CouponMappingSyncRepository["transition"]>[0]) {
    this.transitions.push(input);
    this.current = {
      ...this.current,
      providerCouponId: input.providerCouponId === undefined ? this.current.providerCouponId : input.providerCouponId,
      syncStatus: input.nextStatus,
      lastSyncAttemptAt: input.attemptedAt,
      lastSyncSucceededAt: input.nextStatus === "ACTIVE" || input.nextStatus === "DISABLED" ? input.attemptedAt : this.current.lastSyncSucceededAt,
      lastErrorCode: input.nextStatus === "ERROR" ? input.errorCode ?? null : null,
      lastErrorMessage: input.nextStatus === "ERROR" ? input.errorMessage ?? null : null,
      disabledAt: input.nextStatus === "DISABLED" ? input.attemptedAt : null,
      updatedAt: input.attemptedAt,
    };
    return this.current;
  }
}

describe("Wix coupon mapping orchestration", () => {
  const attemptedAt = new Date("2026-09-21T06:00:00.000Z");

  it("stores the provider id and moves successful provisioning to ACTIVE", async () => {
    const current = mapping({ lastErrorCode: "OLD", lastErrorMessage: "old error" });
    const repository = new MappingRepository(current);
    const gateway: CouponProviderGateway = { provision: async () => ({ providerCouponId: "wix-coupon-1" }), disable: async () => undefined };
    const service = new WixCouponSyncService(gateway, repository, () => attemptedAt);
    await expect(service.provision({ mapping: current, request: request() })).resolves.toMatchObject({ syncStatus: "ACTIVE", providerCouponId: "wix-coupon-1", lastErrorCode: null, lastSyncSucceededAt: attemptedAt });
    expect(repository.transitions).toEqual([expect.objectContaining({ nextStatus: "ACTIVE", providerCouponId: "wix-coupon-1", attemptedAt })]);
  });

  it("moves failed provisioning to ERROR with safe provider details", async () => {
    const current = mapping();
    const repository = new MappingRepository(current);
    const providerError = new WixCouponProviderError("WIX_COUPON_HTTP_ERROR", "Wix coupon request was rejected.", { storefront: "WIX_CIRCZLES_IN", operation: "CREATE", httpStatus: 429 });
    const gateway: CouponProviderGateway = { provision: async () => { throw providerError; }, disable: async () => undefined };
    const service = new WixCouponSyncService(gateway, repository, () => attemptedAt);
    await expect(service.provision({ mapping: current, request: request() })).rejects.toBe(providerError);
    expect(repository.current).toMatchObject({ syncStatus: "ERROR", lastErrorCode: "WIX_COUPON_HTTP_ERROR", lastErrorMessage: "Wix coupon request was rejected." });
  });

  it("moves a successfully disabled mapping to DISABLED", async () => {
    const current = mapping({ syncStatus: "PENDING_DISABLE", providerCouponId: "wix-coupon-1" });
    const repository = new MappingRepository(current);
    const disabled: string[] = [];
    const gateway: CouponProviderGateway = { provision: async () => ({ providerCouponId: "unused" }), disable: async (input) => { disabled.push(input.providerCouponId); } };
    const service = new WixCouponSyncService(gateway, repository, () => attemptedAt);
    await expect(service.disable({ mapping: current, couponCode: "CZ95F70BA56FDCF99B" })).resolves.toMatchObject({ syncStatus: "DISABLED", disabledAt: attemptedAt, providerCouponId: "wix-coupon-1" });
    expect(disabled).toEqual(["wix-coupon-1"]);
  });

  it("records disable failure without changing authoritative redeemed state", async () => {
    const ownership = { status: "REDEEMED" };
    const current = mapping({ syncStatus: "PENDING_DISABLE", providerCouponId: "wix-coupon-1" });
    const repository = new MappingRepository(current);
    const providerError = new WixCouponProviderError("WIX_COUPON_HTTP_ERROR", "Wix coupon request was rejected.", { storefront: "WIX_CIRCZLES_IN", operation: "DISABLE", httpStatus: 500 });
    const gateway: CouponProviderGateway = { provision: async () => ({ providerCouponId: "unused" }), disable: async () => { throw providerError; } };
    const service = new WixCouponSyncService(gateway, repository, () => attemptedAt);
    await expect(service.disable({ mapping: current, couponCode: "CZ95F70BA56FDCF99B" })).rejects.toBe(providerError);
    expect(repository.current).toMatchObject({ syncStatus: "ERROR", providerCouponId: "wix-coupon-1", lastErrorCode: "WIX_COUPON_HTTP_ERROR" });
    expect(ownership.status).toBe("REDEEMED");
  });

  it("ignores Shopify mappings in Wix batch operations", async () => {
    const wix = mapping();
    const shopify = mapping({ couponProviderMappingId: "mapping-shopify", storefrontTarget: "SHOPIFY_COGZART", provider: "SHOPIFY" });
    const repository = new MappingRepository(wix);
    const calls: string[] = [];
    const gateway: CouponProviderGateway = { provision: async (input) => { calls.push(input.storefrontTarget); return { providerCouponId: "wix-coupon-1" }; }, disable: async () => undefined };
    const service = new WixCouponSyncService(gateway, repository, () => attemptedAt);
    const results = await service.provisionPending([{ mapping: wix, request: request() }, { mapping: shopify, request: request({ storefrontTarget: "SHOPIFY_COGZART", provider: "SHOPIFY" }) }]);
    expect(results).toHaveLength(1);
    expect(calls).toEqual(["WIX_CIRCZLES_IN"]);
    expect(repository.transitions).toHaveLength(1);
  });
});
