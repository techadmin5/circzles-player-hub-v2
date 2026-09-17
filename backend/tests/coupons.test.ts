import { describe, expect, it } from "vitest";
import { AppError } from "../src/domain/errors.js";
import { CouponService, effectiveCouponStatus, validateCouponGrant, type CouponDto, type CouponGrantInput, type CouponRepository } from "../src/domain/coupons.js";

type StoredCoupon = CouponDto & { playerId: string; idempotencyKey: string; sourceType: string; sourceId: string; issuanceOrdinal: number };

class CouponHarness implements CouponRepository {
  coupons: StoredCoupon[] = [];

  grant(input: CouponGrantInput) {
    validateCouponGrant(input);
    const replay = this.coupons.filter((coupon) => coupon.playerId === input.playerId && coupon.idempotencyKey === input.idempotencyKey);
    if (replay.length) {
      const sameOperation = replay.length === input.quantity && replay.every((coupon, index) => coupon.rewardDefinitionId === input.rewardDefinitionId
        && coupon.sourceType === input.sourceType && coupon.sourceId === input.sourceId && coupon.issuanceOrdinal === index + 1
        && coupon.expiresAt === (input.expiresAt?.toISOString() ?? null));
      if (!sameOperation) throw new AppError("IDEMPOTENCY_CONFLICT", "Coupon issuance key was already used for another operation.", 409);
      return { ownerships: replay, idempotent: true };
    }
    if (this.coupons.some((coupon) => coupon.playerId === input.playerId && coupon.sourceType === input.sourceType && coupon.sourceId === input.sourceId)) {
      throw new AppError("IDEMPOTENCY_CONFLICT", "Coupon issuance source was already recorded with another idempotency key.", 409);
    }
    const issuedAt = input.issuedAt ?? new Date("2026-09-17T12:00:00.000Z");
    const ownerships = Array.from({ length: input.quantity }, (_, index): StoredCoupon => ({
      couponOwnershipId: `coupon-${this.coupons.length + index + 1}`,
      playerId: input.playerId,
      rewardDefinitionId: input.rewardDefinitionId,
      rewardCode: "COUPON_TEST",
      name: "Test Coupon",
      description: "Test coupon ownership.",
      imageUrl: null,
      rarity: "RARE",
      status: "ACTIVE",
      issuedAt: issuedAt.toISOString(),
      expiresAt: input.expiresAt?.toISOString() ?? null,
      displayMetadata: { discountLabel: "10% off" },
      idempotencyKey: input.idempotencyKey,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      issuanceOrdinal: index + 1,
    }));
    this.coupons.push(...ownerships);
    return { ownerships, idempotent: false };
  }

  async list(playerId: string, now: Date): Promise<CouponDto[]> {
    return this.coupons.filter((coupon) => coupon.playerId === playerId).map((coupon) => ({
      couponOwnershipId: coupon.couponOwnershipId,
      rewardDefinitionId: coupon.rewardDefinitionId,
      rewardCode: coupon.rewardCode,
      name: coupon.name,
      description: coupon.description,
      imageUrl: coupon.imageUrl,
      rarity: coupon.rarity,
      status: effectiveCouponStatus(coupon.status === "EXPIRED" ? "ACTIVE" : coupon.status, coupon.expiresAt ? new Date(coupon.expiresAt) : null, now),
      issuedAt: coupon.issuedAt,
      expiresAt: coupon.expiresAt,
      displayMetadata: coupon.displayMetadata,
    }));
  }
}

function grant(overrides: Partial<CouponGrantInput> = {}): CouponGrantInput {
  return { playerId: "player-1", rewardDefinitionId: "reward-coupon", rewardType: "COUPON", quantity: 1, sourceType: "STORE_PURCHASE", sourceId: "purchase-1", idempotencyKey: "coupon-grant-1", issuedAt: new Date("2026-09-17T12:00:00.000Z"), ...overrides };
}

describe("coupon ownership authority", () => {
  it("creates stable ownership rows and exact replay does not duplicate them", () => {
    const repo = new CouponHarness();
    const first = repo.grant(grant({ quantity: 2 }));
    const replay = repo.grant(grant({ quantity: 2 }));
    expect(first.idempotent).toBe(false);
    expect(replay).toEqual({ ownerships: first.ownerships, idempotent: true });
    expect(repo.coupons).toHaveLength(2);
    expect(repo.coupons.map((coupon) => coupon.issuanceOrdinal)).toEqual([1, 2]);
  });

  it("allows different valid grants to coexist", () => {
    const repo = new CouponHarness();
    repo.grant(grant());
    repo.grant(grant({ sourceId: "purchase-2", idempotencyKey: "coupon-grant-2" }));
    expect(repo.coupons.map((coupon) => coupon.sourceId)).toEqual(["purchase-1", "purchase-2"]);
  });

  it("rejects idempotency conflicts and alternate keys for an existing source", () => {
    const repo = new CouponHarness();
    repo.grant(grant());
    expect(() => repo.grant(grant({ quantity: 2 }))).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }));
    expect(() => repo.grant(grant({ idempotencyKey: "alternate-key" }))).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }));
    expect(repo.coupons).toHaveLength(1);
  });

  it("scopes retrieval to the requested player", async () => {
    const repo = new CouponHarness();
    repo.grant(grant());
    repo.grant(grant({ playerId: "player-2" }));
    const service = new CouponService(repo);
    expect(await service.list("player-1", new Date("2026-09-17T12:30:00.000Z"))).toHaveLength(1);
    expect(await service.list("player-2", new Date("2026-09-17T12:30:00.000Z"))).toHaveLength(1);
    expect((await service.list("player-1", new Date("2026-09-17T12:30:00.000Z")))[0].couponOwnershipId).not.toBe((await service.list("player-2", new Date("2026-09-17T12:30:00.000Z")))[0].couponOwnershipId);
  });

  it("represents optional expiry and derives effective expiration at read time", async () => {
    const repo = new CouponHarness();
    const expiresAt = new Date("2026-09-18T12:00:00.000Z");
    repo.grant(grant({ expiresAt }));
    const service = new CouponService(repo);
    expect((await service.list("player-1", new Date("2026-09-18T11:59:59.000Z")))[0]).toMatchObject({ status: "ACTIVE", expiresAt: expiresAt.toISOString() });
    expect((await service.list("player-1", expiresAt))[0]).toMatchObject({ status: "EXPIRED", expiresAt: expiresAt.toISOString() });
  });

  it("rejects non-coupon rewards and invalid expiry", () => {
    expect(() => validateCouponGrant(grant({ rewardType: "FRAME" }))).toThrowError(expect.objectContaining({ code: "COUPON_REWARD_REQUIRED" }));
    expect(() => validateCouponGrant(grant({ expiresAt: new Date("2026-09-17T11:59:59.000Z") }))).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });
});
