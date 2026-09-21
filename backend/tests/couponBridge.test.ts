import { describe, expect, it } from "vitest";
import { couponOwnerships, couponProviderMappings, couponRedemptions, gameEvents, rewardDefinitions } from "../src/db/schema.js";
import {
  assertCouponProviderSyncTransition,
  assertStorefrontProviderPair,
  buildCouponProvisionRequest,
  couponStorefrontTargets,
  createCouponProvisioningPlanInTransaction,
  ensureCouponProviderMappingInTransaction,
  parseCouponBenefit,
  providerForStorefront,
  recordCouponRedemptionInTransaction,
  transitionCouponProviderMappingInTransaction,
} from "../src/domain/couponBridge.js";
import type { GameStateTransaction } from "../src/domain/gameState.js";

type CouponRow = typeof couponOwnerships.$inferSelect;
type MappingRow = typeof couponProviderMappings.$inferSelect;
type RedemptionRow = typeof couponRedemptions.$inferSelect;
type EventRow = typeof gameEvents.$inferSelect;

function limited<T>(rows: T[], count: number) {
  const selected = rows.slice(0, count);
  const result = Promise.resolve(selected) as Promise<T[]> & { for: () => Promise<T[]> };
  result.for = async () => selected;
  return result;
}

class CouponBridgeTransactionDouble {
  couponRows: CouponRow[] = [];
  mappingRows: MappingRow[] = [];
  redemptionRows: RedemptionRow[] = [];
  eventRows: EventRow[] = [];
  rewardMetadata: Record<string, unknown> = { couponBenefit: { type: "PERCENTAGE", percentage: 20 } };
  private mappingSequence = 0;
  private redemptionSequence = 0;
  private eventSequence = 0;
  private mappingSelectResults: MappingRow[][] = [];

  transaction() { return this as unknown as GameStateTransaction; }
  queueMappingSelects(...results: MappingRow[][]) { this.mappingSelectResults.push(...results); }

  select(fields?: Record<string, unknown>) {
    return {
      from: (table: unknown) => {
        if (table === couponOwnerships && fields && "ownership" in fields) {
          return {
            innerJoin: (joined: unknown) => {
              if (joined !== rewardDefinitions) throw new Error("Unexpected join.");
              const rows = this.couponRows.map((ownership) => ({ ownership, rewardMetadata: this.rewardMetadata }));
              return { where: () => ({ limit: (count: number) => limited(rows, count) }) };
            },
          };
        }
        const rows: unknown[] | null = table === couponOwnerships ? this.couponRows
          : table === couponProviderMappings ? (this.mappingSelectResults.shift() ?? this.mappingRows)
            : table === couponRedemptions ? this.redemptionRows
              : table === gameEvents ? this.eventRows
                : null;
        if (!rows) throw new Error("Unexpected table selected by coupon bridge code.");
        return { where: () => ({ limit: (count: number) => limited(rows, count) }) };
      },
    };
  }

  insert(table: unknown) {
    if (table === couponProviderMappings) {
      return { values: (value: typeof couponProviderMappings.$inferInsert) => ({ returning: async () => {
        const row: MappingRow = {
          couponProviderMappingId: `mapping-${++this.mappingSequence}`,
          providerCouponId: null,
          syncStatus: "PENDING_CREATE",
          lastSyncAttemptAt: null,
          lastSyncSucceededAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          disabledAt: null,
          createdAt: value.createdAt ?? new Date(),
          updatedAt: value.updatedAt ?? new Date(),
          ...value,
        };
        this.mappingRows.push(row);
        return [row];
      } }) };
    }
    if (table === couponRedemptions) {
      return { values: (value: typeof couponRedemptions.$inferInsert) => ({ returning: async () => {
        const row: RedemptionRow = { couponRedemptionId: `redemption-${++this.redemptionSequence}`, createdAt: new Date("2026-09-18T12:00:00.000Z"), ...value };
        this.redemptionRows.push(row);
        return [row];
      } }) };
    }
    if (table === gameEvents) {
      return { values: (value: typeof gameEvents.$inferInsert) => ({ onConflictDoNothing: () => ({ returning: async () => {
        const duplicate = this.eventRows.some((row) => row.playerId === value.playerId && row.idempotencyKey === value.idempotencyKey);
        if (duplicate) return [];
        const row: EventRow = { gameEventId: `event-${++this.eventSequence}`, createdAt: new Date("2026-09-18T12:00:00.000Z"), processedAt: null, payload: value.payload ?? {}, ...value };
        this.eventRows.push(row);
        return [row];
      } }) }) };
    }
    throw new Error("Unexpected table inserted by coupon bridge code.");
  }

  update(table: unknown) {
    return { set: (values: Partial<CouponRow & MappingRow>) => ({ where: () => {
      if (table === couponOwnerships) {
        this.couponRows = this.couponRows.map((row) => ({ ...row, ...values } as CouponRow));
        return { returning: async () => [this.couponRows[0]] };
      }
      if (table === couponProviderMappings) {
        this.mappingRows = this.mappingRows.map((row) => row.syncStatus === "DISABLED" ? row : ({ ...row, ...values } as MappingRow));
        return { returning: async () => [this.mappingRows[0]] };
      }
      throw new Error("Unexpected table updated by coupon bridge code.");
    } }) };
  }
}

function coupon(overrides: Partial<CouponRow> = {}): CouponRow {
  return {
    couponOwnershipId: "70000000-0000-4000-8000-000000000001",
    couponCode: "CZ1234567890ABCDEF",
    playerId: "player-1",
    rewardDefinitionId: "reward-1",
    sourceType: "STORE_PURCHASE",
    sourceId: "purchase-1",
    issuanceOrdinal: 1,
    idempotencyKey: "issue-1",
    status: "ACTIVE",
    issuedAt: new Date("2026-09-17T12:00:00.000Z"),
    expiresAt: null,
    redeemedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function mapping(overrides: Partial<MappingRow> = {}): MappingRow {
  return {
    couponProviderMappingId: "mapping-1",
    couponOwnershipId: "70000000-0000-4000-8000-000000000001",
    storefrontTarget: "WIX_CIRCZLES_IN",
    provider: "WIX",
    providerCouponId: "provider-coupon-1",
    syncStatus: "ACTIVE",
    lastSyncAttemptAt: null,
    lastSyncSucceededAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    disabledAt: null,
    createdAt: new Date("2026-09-17T12:00:00.000Z"),
    updatedAt: new Date("2026-09-17T12:00:00.000Z"),
    ...overrides,
  };
}

const redemptionInput = {
  couponOwnershipId: "70000000-0000-4000-8000-000000000001",
  storefrontTarget: "WIX_CIRCZLES_IN" as const,
  sourceRedemptionId: "provider-redemption-1",
  idempotencyKey: "redeem-1",
  redeemedAt: new Date("2026-09-18T12:00:00.000Z"),
};

describe("coupon bridge configuration", () => {
  it("supports exactly the five provider-neutral storefront identities", () => {
    expect(couponStorefrontTargets).toEqual(["WIX_CIRCZLES_IN", "WIX_CIRCZLES_COM", "WIX_COGZART_IN", "WIX_COGZART_COM", "SHOPIFY_COGZART"]);
    expect(couponStorefrontTargets.map(providerForStorefront)).toEqual(["WIX", "WIX", "WIX", "WIX", "SHOPIFY"]);
    expect(() => assertStorefrontProviderPair("WIX_CIRCZLES_IN", "SHOPIFY")).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });

  it("validates percentage and currency-specific fixed benefits", () => {
    expect(parseCouponBenefit({ couponBenefit: { type: "PERCENTAGE", percentage: 20 } })).toEqual({ type: "PERCENTAGE", percentage: 20 });
    expect(parseCouponBenefit({ couponBenefit: { type: "FIXED_AMOUNT", amounts: { INR: 500, USD: 6 } } })).toEqual({ type: "FIXED_AMOUNT", amounts: { INR: 500, USD: 6 } });
    for (const percentage of [0, -1, 101]) expect(() => parseCouponBenefit({ couponBenefit: { type: "PERCENTAGE", percentage } })).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() => parseCouponBenefit({ couponBenefit: { type: "FIXED_AMOUNT", amounts: { INR: 500 } } })).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() => parseCouponBenefit({ couponBenefit: { type: "FIXED_AMOUNT", amounts: { INR: 0, USD: 6 } } })).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });

  it("builds one-use INR/USD projections without live conversion", () => {
    const base = { couponOwnershipId: "coupon-1", couponCode: "CZ1234567890ABCDEF", benefit: { type: "FIXED_AMOUNT" as const, amounts: { INR: 500, USD: 6 } }, issuedAt: new Date(), expiresAt: null };
    expect(buildCouponProvisionRequest({ ...base, storefrontTarget: "WIX_COGZART_IN" }).benefit).toEqual({ type: "FIXED_AMOUNT", currency: "INR", amount: 500 });
    expect(buildCouponProvisionRequest({ ...base, storefrontTarget: "SHOPIFY_COGZART" })).toMatchObject({ provider: "SHOPIFY", benefit: { currency: "USD", amount: 6 }, totalUsageLimit: 1, perCustomerUsageLimit: 1 });
  });

  it("validates provider mapping state transitions", () => {
    expect(() => assertCouponProviderSyncTransition("PENDING_CREATE", "ACTIVE")).not.toThrow();
    expect(() => assertCouponProviderSyncTransition("ACTIVE", "PENDING_DISABLE")).not.toThrow();
    expect(() => assertCouponProviderSyncTransition("PENDING_DISABLE", "DISABLED")).not.toThrow();
    expect(() => assertCouponProviderSyncTransition("DISABLED", "ACTIVE")).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });
});

describe("production coupon bridge transaction functions", () => {
  it("prepares all five storefront projections without calling a provider", async () => {
    const fake = new CouponBridgeTransactionDouble();
    fake.couponRows = [coupon()];
    fake.queueMappingSelects([], [], [], [], []);
    const plan = await createCouponProvisioningPlanInTransaction(fake.transaction(), fake.couponRows[0].couponOwnershipId, new Date("2026-09-18T11:00:00.000Z"));
    expect(plan.mappings).toHaveLength(5);
    expect(plan.requests.map((request) => request.storefrontTarget)).toEqual(couponStorefrontTargets);
    expect(fake.mappingRows).toHaveLength(5);
  });

  it("creates one mapping per ownership/storefront and safely replays", async () => {
    const fake = new CouponBridgeTransactionDouble();
    fake.couponRows = [coupon()];
    const first = await ensureCouponProviderMappingInTransaction(fake.transaction(), { couponOwnershipId: fake.couponRows[0].couponOwnershipId, storefrontTarget: "WIX_CIRCZLES_IN", provider: "WIX" });
    const replay = await ensureCouponProviderMappingInTransaction(fake.transaction(), { couponOwnershipId: fake.couponRows[0].couponOwnershipId, storefrontTarget: "WIX_CIRCZLES_IN", provider: "WIX" });
    expect(first.idempotent).toBe(false);
    expect(replay).toEqual({ mapping: first.mapping, idempotent: true });
    expect(fake.mappingRows).toHaveLength(1);
  });

  it("applies validated provider sync transitions through the production function", async () => {
    const fake = new CouponBridgeTransactionDouble();
    fake.mappingRows = [mapping({ syncStatus: "PENDING_CREATE", providerCouponId: null })];
    const active = await transitionCouponProviderMappingInTransaction(fake.transaction(), { couponProviderMappingId: "mapping-1", nextStatus: "ACTIVE", providerCouponId: "provider-1", attemptedAt: new Date("2026-09-18T10:00:00.000Z") });
    expect(active).toMatchObject({ syncStatus: "ACTIVE", providerCouponId: "provider-1", lastErrorCode: null });
    const pendingDisable = await transitionCouponProviderMappingInTransaction(fake.transaction(), { couponProviderMappingId: "mapping-1", nextStatus: "PENDING_DISABLE", attemptedAt: new Date("2026-09-18T11:00:00.000Z") });
    expect(pendingDisable.syncStatus).toBe("PENDING_DISABLE");
    const disabled = await transitionCouponProviderMappingInTransaction(fake.transaction(), { couponProviderMappingId: "mapping-1", nextStatus: "DISABLED", attemptedAt: new Date("2026-09-18T12:00:00.000Z") });
    expect(disabled).toMatchObject({ syncStatus: "DISABLED", disabledAt: new Date("2026-09-18T12:00:00.000Z") });
  });

  it("redeems ACTIVE exactly once, records time, disables projections, and emits once", async () => {
    const fake = new CouponBridgeTransactionDouble();
    fake.couponRows = [coupon()];
    fake.mappingRows = [mapping(), mapping({ couponProviderMappingId: "mapping-2", storefrontTarget: "SHOPIFY_COGZART", provider: "SHOPIFY", syncStatus: "PENDING_CREATE", providerCouponId: null })];
    const first = await recordCouponRedemptionInTransaction(fake.transaction(), redemptionInput);
    const replay = await recordCouponRedemptionInTransaction(fake.transaction(), redemptionInput);
    expect(first).toMatchObject({ idempotent: false, ownership: { status: "REDEEMED", redeemedAt: redemptionInput.redeemedAt } });
    expect(replay).toMatchObject({ redemption: first.redemption, idempotent: true });
    expect(fake.redemptionRows).toHaveLength(1);
    expect(fake.mappingRows.every((row) => row.syncStatus === "PENDING_DISABLE")).toBe(true);
    expect(fake.eventRows).toHaveLength(1);
    expect(fake.eventRows[0]).toMatchObject({ eventType: "coupon.redeemed", playerId: "player-1" });
    expect(fake).not.toHaveProperty("inventoryRows");
  });

  it("rejects a conflicting second redemption", async () => {
    const fake = new CouponBridgeTransactionDouble();
    fake.couponRows = [coupon()]; fake.mappingRows = [mapping()];
    await recordCouponRedemptionInTransaction(fake.transaction(), redemptionInput);
    await expect(recordCouponRedemptionInTransaction(fake.transaction(), { ...redemptionInput, sourceRedemptionId: "provider-redemption-2", idempotencyKey: "redeem-2" })).rejects.toMatchObject({ code: "COUPON_ALREADY_REDEEMED" });
    expect(fake.redemptionRows).toHaveLength(1);
  });

  it("rejects revoked and effectively expired ownerships", async () => {
    const revoked = new CouponBridgeTransactionDouble(); revoked.couponRows = [coupon({ status: "REVOKED", revokedAt: new Date("2026-09-18T11:00:00.000Z") })]; revoked.mappingRows = [mapping()];
    await expect(recordCouponRedemptionInTransaction(revoked.transaction(), redemptionInput)).rejects.toMatchObject({ code: "COUPON_REVOKED" });
    const expired = new CouponBridgeTransactionDouble(); expired.couponRows = [coupon({ expiresAt: new Date("2026-09-18T11:59:59.000Z") })]; expired.mappingRows = [mapping()];
    await expect(recordCouponRedemptionInTransaction(expired.transaction(), redemptionInput)).rejects.toMatchObject({ code: "COUPON_EXPIRED" });
  });
});
