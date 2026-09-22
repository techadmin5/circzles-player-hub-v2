import { describe, expect, it } from "vitest";
import type { couponProviderMappings } from "../src/db/schema.js";
import { AppError } from "../src/domain/errors.js";
import {
  CouponRedemptionSyncService,
  redemptionIdempotencyKey,
  type CouponDisableService,
  type CouponRedemptionSyncRepository,
  type ProviderCouponRedemptionEvent,
} from "../src/domain/couponRedemptionSync.js";

type Mapping = typeof couponProviderMappings.$inferSelect;

const baseEvent: ProviderCouponRedemptionEvent = {
  provider: "WIX",
  storefrontTarget: "WIX_CIRCZLES_IN",
  providerEventId: "provider-event-1",
  providerOrderId: "provider-order-1",
  couponCodes: ["CZ1234567890ABCDEF"],
  redeemedAt: new Date("2026-09-22T10:00:00.000Z"),
};

function mapping(provider: "WIX" | "SHOPIFY", status: Mapping["syncStatus"] = "PENDING_DISABLE"): Mapping {
  return {
    couponProviderMappingId: `mapping-${provider.toLowerCase()}`,
    couponOwnershipId: "70000000-0000-4000-8000-000000000001",
    storefrontTarget: provider === "WIX" ? "WIX_CIRCZLES_COM" : "SHOPIFY_COGZART",
    provider,
    providerCouponId: `provider-${provider.toLowerCase()}-coupon`,
    syncStatus: status,
    lastSyncAttemptAt: null,
    lastSyncSucceededAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    disabledAt: status === "DISABLED" ? new Date("2026-09-22T10:00:01.000Z") : null,
    createdAt: new Date("2026-09-21T10:00:00.000Z"),
    updatedAt: new Date("2026-09-21T10:00:00.000Z"),
  };
}

class AuthoritativeFake implements CouponRedemptionSyncRepository {
  redemptionRows = 0;
  eventRows = 0;
  ownershipStatus = "ACTIVE";
  acceptedKey?: string;
  mappings = [mapping("WIX"), mapping("SHOPIFY"), mapping("WIX", "DISABLED")];

  async record(event: ProviderCouponRedemptionEvent) {
    if (!event.couponCodes.includes("CZ1234567890ABCDEF")) return { status: "IGNORED" as const, mappings: [] };
    const key = redemptionIdempotencyKey(event);
    if (this.acceptedKey) {
      if (this.acceptedKey !== key) throw new AppError("COUPON_ALREADY_REDEEMED", "Already redeemed.", 409);
      return { status: "DUPLICATE" as const, couponRedemptionId: "redemption-1", couponCode: "CZ1234567890ABCDEF", mappings: [] };
    }
    this.acceptedKey = key;
    this.redemptionRows += 1;
    this.eventRows += 1;
    this.ownershipStatus = "REDEEMED";
    return {
      status: "REDEEMED" as const,
      couponRedemptionId: "redemption-1",
      couponCode: "CZ1234567890ABCDEF",
      mappings: this.mappings.filter((item) => item.syncStatus === "PENDING_DISABLE"),
    };
  }
}

class DisableFake implements CouponDisableService {
  calls: Mapping[] = [];
  constructor(private fail = false) {}
  async disable(input: { mapping: Mapping }) {
    this.calls.push(input.mapping);
    if (this.fail) throw new Error("provider unavailable");
  }
}

describe("provider coupon redemption orchestration", () => {
  it("commits one authoritative redemption and delegates pending siblings by provider", async () => {
    const repository = new AuthoritativeFake();
    const wix = new DisableFake();
    const shopify = new DisableFake();
    const service = new CouponRedemptionSyncService(repository, wix, shopify);
    expect(await service.synchronize(baseEvent)).toEqual({ status: "REDEEMED", couponRedemptionId: "redemption-1" });
    expect(repository.ownershipStatus).toBe("REDEEMED");
    expect(repository.redemptionRows).toBe(1);
    expect(repository.eventRows).toBe(1);
    expect(wix.calls.map((item) => item.provider)).toEqual(["WIX"]);
    expect(shopify.calls.map((item) => item.provider)).toEqual(["SHOPIFY"]);
    expect([...wix.calls, ...shopify.calls].some((item) => item.syncStatus === "DISABLED")).toBe(false);
  });

  it("makes an exact webhook retry idempotent without another grant or event", async () => {
    const repository = new AuthoritativeFake();
    const service = new CouponRedemptionSyncService(repository, new DisableFake(), new DisableFake());
    await service.synchronize(baseEvent);
    expect(await service.synchronize(baseEvent)).toEqual({ status: "DUPLICATE", couponRedemptionId: "redemption-1" });
    expect(repository.redemptionRows).toBe(1);
    expect(repository.eventRows).toBe(1);
  });

  it("fails closed when the same event identity is reused with conflicting order details", async () => {
    const repository = new AuthoritativeFake();
    const service = new CouponRedemptionSyncService(repository, new DisableFake(), new DisableFake());
    await service.synchronize(baseEvent);
    await expect(service.synchronize({ ...baseEvent, providerOrderId: "different-order" }))
      .rejects.toMatchObject({ code: "COUPON_ALREADY_REDEEMED" });
    expect(repository.redemptionRows).toBe(1);
  });

  it("binds event time and coupon candidates into conflicting replay detection", async () => {
    expect(redemptionIdempotencyKey(baseEvent)).not.toBe(redemptionIdempotencyKey({
      ...baseEvent,
      redeemedAt: new Date("2026-09-22T10:00:01.000Z"),
    }));
    expect(redemptionIdempotencyKey(baseEvent)).not.toBe(redemptionIdempotencyKey({
      ...baseEvent,
      couponCodes: [...baseEvent.couponCodes, "OTHER20"],
    }));
  });

  it("ignores unrelated canonical discount strings only after repository resolution", async () => {
    const repository = new AuthoritativeFake();
    const service = new CouponRedemptionSyncService(repository, new DisableFake(), new DisableFake());
    expect(await service.synchronize({ ...baseEvent, couponCodes: ["OTHER20"] })).toEqual({ status: "IGNORED" });
    expect(repository.redemptionRows).toBe(0);
  });

  it("does not roll back authoritative redemption when provider disable fails", async () => {
    const repository = new AuthoritativeFake();
    const service = new CouponRedemptionSyncService(repository, new DisableFake(true), new DisableFake());
    await expect(service.synchronize(baseEvent)).rejects.toMatchObject({ code: "COUPON_DISABLE_RECONCILIATION_FAILED", statusCode: 502 });
    expect(repository.ownershipStatus).toBe("REDEEMED");
    expect(repository.redemptionRows).toBe(1);
  });
});
