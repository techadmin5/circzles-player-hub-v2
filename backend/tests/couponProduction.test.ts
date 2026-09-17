import { describe, expect, it } from "vitest";
import { grantCouponOwnershipInTransaction, type CouponGrantInput } from "../src/domain/coupons.js";
import { grantRewardEntitlementInTransaction } from "../src/domain/rewardEntitlements.js";
import { grantRewardWheelEntitlementInTransaction } from "../src/domain/rewardWheel.js";
import { grantStorePurchaseEntitlementInTransaction } from "../src/domain/storePurchases.js";
import { CouponTransactionDouble } from "./couponTransactionDouble.js";

const issuedAt = new Date("2026-09-17T12:00:00.000Z");
function grant(overrides: Partial<CouponGrantInput> = {}): CouponGrantInput {
  return { playerId: "player-1", rewardDefinitionId: "coupon-reward-1", rewardType: "COUPON", quantity: 1, sourceType: "STORE_PURCHASE", sourceId: "purchase-1", idempotencyKey: "coupon-key-1", issuedAt, ...overrides };
}

describe("production coupon entitlement functions", () => {
  it("issues one row per coupon unit, emits once, and reuses an exact replay", async () => {
    const fake = new CouponTransactionDouble();
    fake.queueCouponSelects([], []);
    const first = await grantCouponOwnershipInTransaction(fake.transaction(), grant({ quantity: 2 }));

    fake.queueCouponSelects([...fake.couponRows]);
    const replay = await grantCouponOwnershipInTransaction(fake.transaction(), grant({ quantity: 2 }));

    expect(first).toMatchObject({ idempotent: false });
    expect(replay).toEqual({ ownerships: first.ownerships, idempotent: true });
    expect(fake.couponRows.map((row) => row.issuanceOrdinal)).toEqual([1, 2]);
    expect(fake.eventRows).toHaveLength(1);
    expect(fake.eventRows[0]).toMatchObject({ eventType: "coupon.issued", sourceType: "STORE_PURCHASE", sourceId: "purchase-1" });
  });

  it("rejects alternate-key reuse of a source even for another coupon definition", async () => {
    const fake = new CouponTransactionDouble();
    fake.queueCouponSelects([], []);
    await grantCouponOwnershipInTransaction(fake.transaction(), grant());

    fake.queueCouponSelects([], [...fake.couponRows]);
    await expect(grantCouponOwnershipInTransaction(fake.transaction(), grant({ rewardDefinitionId: "coupon-reward-2", idempotencyKey: "coupon-key-2" }))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(fake.couponRows).toHaveLength(1);
    expect(fake.eventRows).toHaveLength(1);
  });

  it("validates the canonical database reward type", async () => {
    const fake = new CouponTransactionDouble();
    fake.rewardType = "FRAME";
    fake.queueCouponSelects([], []);
    await expect(grantCouponOwnershipInTransaction(fake.transaction(), grant())).rejects.toMatchObject({ code: "COUPON_REWARD_REQUIRED" });
    expect(fake.couponRows).toHaveLength(0);
    expect(fake.eventRows).toHaveLength(0);
  });

  it("routes coupons through the real shared entitlement function", async () => {
    const fake = new CouponTransactionDouble();
    fake.queueCouponSelects([], []);
    const result = await grantRewardEntitlementInTransaction(fake.transaction(), grant());
    expect(result).toMatchObject({ kind: "COUPON", coupon: { idempotent: false } });
    expect(fake.couponRows).toHaveLength(1);
    expect(fake.eventRows[0].eventType).toBe("coupon.issued");
  });

  it("uses the production Store coupon source and idempotency identity", async () => {
    const fake = new CouponTransactionDouble();
    fake.queueCouponSelects([], []);
    const result = await grantStorePurchaseEntitlementInTransaction(fake.transaction(), { playerId: "player-1", rewardDefinitionId: "coupon-reward-1", rewardType: "COUPON", purchaseId: "purchase-42", issuedAt });
    expect(result.kind).toBe("COUPON");
    expect(fake.couponRows[0]).toMatchObject({ sourceType: "STORE_PURCHASE", sourceId: "purchase-42", idempotencyKey: "store.purchase.entitlement:purchase-42" });
  });

  it("uses the production Reward Wheel coupon source and preserves quantity", async () => {
    const fake = new CouponTransactionDouble();
    fake.queueCouponSelects([], []);
    const result = await grantRewardWheelEntitlementInTransaction(fake.transaction(), { playerId: "player-1", rewardDefinitionId: "coupon-reward-1", rewardType: "COUPON", quantity: 2, spinId: "spin-42", issuedAt });
    expect(result.kind).toBe("COUPON");
    expect(fake.couponRows).toHaveLength(2);
    expect(fake.couponRows[0]).toMatchObject({ sourceType: "REWARD_WHEEL_SPIN", sourceId: "spin-42", idempotencyKey: "reward-wheel.entitlement:spin-42" });
    expect(fake.eventRows).toHaveLength(1);
  });
});
