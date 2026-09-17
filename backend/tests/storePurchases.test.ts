import { describe, expect, it } from "vitest";
import { AppError, insufficientPoints } from "../src/domain/errors.js";
import { StorePurchaseService, type StorePurchaseInput, type StorePurchaseRepository, type StorePurchaseResult } from "../src/domain/storePurchases.js";
import type { RewardDefinitionType } from "../src/domain/rewardCatalog.js";

type Listing = { id: string; rewardDefinitionId: string; rewardType: RewardDefinitionType; code: string; name: string; imageUrl: string | null; rarity: string | null; price: number; active: boolean; rewardActive: boolean; availableFrom: Date | null; availableUntil: Date | null; purchaseLimit: number | null };
type Purchase = StorePurchaseResult & { playerId: string; idempotencyKey: string; pointTransactionId: string | null };
type CouponOwnership = { couponOwnershipId: string; playerId: string; rewardDefinitionId: string; sourceId: string; idempotencyKey: string };

class PurchaseHarness implements StorePurchaseRepository {
  listings = new Map<string, Listing>();
  wallets = new Map<string, number>();
  purchases: Purchase[] = [];
  debits: Array<{ id: string; playerId: string; amount: number; sourceId: string; sourceType: string }> = [];
  events: Array<{ type: string; key: string; purchaseId: string }> = [];
  inventory = new Map<string, number>();
  inventoryGrants: Array<{ purchaseId: string; rewardDefinitionId: string }> = [];
  couponOwnerships: CouponOwnership[] = [];
  failAfterDebit = false;
  failInventory = false;
  private sequence = Promise.resolve();

  purchase(input: StorePurchaseInput): Promise<StorePurchaseResult> {
    const operation = this.sequence.then(() => this.purchaseAtomically(input));
    this.sequence = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async purchaseAtomically(input: StorePurchaseInput): Promise<StorePurchaseResult> {
    const snapshot = { wallets: new Map(this.wallets), purchases: [...this.purchases], debits: [...this.debits], events: [...this.events], inventory: new Map(this.inventory), inventoryGrants: [...this.inventoryGrants], couponOwnerships: [...this.couponOwnerships] };
    try {
      const replay = this.purchases.find((purchase) => purchase.playerId === input.playerId && purchase.idempotencyKey === input.idempotencyKey);
      if (replay) {
        if (replay.listingId !== input.listingId) throw new AppError("IDEMPOTENCY_CONFLICT", "Different listing.", 409);
        return { ...replay, idempotent: true };
      }
      const listing = this.listings.get(input.listingId);
      const now = input.now ?? new Date("2026-09-12T12:00:00Z");
      if (!listing || !listing.active || !listing.rewardActive || (listing.availableFrom && now < listing.availableFrom) || (listing.availableUntil && now >= listing.availableUntil)) throw new AppError("STORE_LISTING_UNAVAILABLE", "Unavailable.", 409);
      const count = this.purchases.filter((purchase) => purchase.playerId === input.playerId && purchase.listingId === listing.id).length;
      if (listing.purchaseLimit !== null && count >= listing.purchaseLimit) throw new AppError("PURCHASE_LIMIT_REACHED", "Limit reached.", 409);
      const inventoryKey = `${input.playerId}:${listing.rewardDefinitionId}`;
      const unique = ["FRAME", "BADGE", "AVATAR", "COSMETIC"].includes(listing.rewardType);
      if (["XP", "SYNAPSE_POINTS"].includes(listing.rewardType)) throw new AppError("STORE_REWARD_NOT_INVENTORY_SUPPORTED", "Unsupported.", 409);
      if (unique && (this.inventory.get(inventoryKey) ?? 0) > 0) throw new AppError("ITEM_ALREADY_OWNED", "Owned.", 409);
      const balance = this.wallets.get(input.playerId) ?? 0;
      if (balance < listing.price) throw insufficientPoints();
      const purchaseId = `purchase-${this.purchases.length + 1}`;
      const balanceAfter = balance - listing.price;
      let pointTransactionId: string | null = null;
      if (listing.price > 0) {
        pointTransactionId = `debit-${this.debits.length + 1}`;
        this.wallets.set(input.playerId, balanceAfter);
        this.debits.push({ id: pointTransactionId, playerId: input.playerId, amount: listing.price, sourceId: purchaseId, sourceType: "STORE_PURCHASE" });
      }
      if (this.failAfterDebit) throw new Error("simulated post-debit failure");
      const result: Purchase = { purchaseId, playerId: input.playerId, listingId: listing.id, reward: { rewardDefinitionId: listing.rewardDefinitionId, code: listing.code, rewardType: listing.rewardType, name: listing.name, imageUrl: listing.imageUrl, rarity: listing.rarity }, priceSynapsePoints: listing.price, balanceAfter, purchasedAt: now.toISOString(), idempotent: false, idempotencyKey: input.idempotencyKey, pointTransactionId };
      this.purchases.push(result);
      if (this.failInventory) throw new Error("simulated entitlement failure");
      if (listing.rewardType === "COUPON") {
        this.couponOwnerships.push({ couponOwnershipId: `coupon-${this.couponOwnerships.length + 1}`, playerId: input.playerId, rewardDefinitionId: listing.rewardDefinitionId, sourceId: purchaseId, idempotencyKey: `store.purchase.entitlement:${purchaseId}` });
        this.events.push({ type: "coupon.issued", key: `coupon.issued:${purchaseId}`, purchaseId });
      } else {
        this.inventory.set(inventoryKey, unique ? 1 : (this.inventory.get(inventoryKey) ?? 0) + 1);
        this.inventoryGrants.push({ purchaseId, rewardDefinitionId: listing.rewardDefinitionId });
        this.events.push({ type: "inventory.item.granted", key: `inventory.item.granted:${purchaseId}`, purchaseId });
      }
      this.events.push({ type: "store.purchase.completed", key: `store.purchase.completed:${purchaseId}`, purchaseId });
      return result;
    } catch (error) {
      this.wallets = snapshot.wallets; this.purchases = snapshot.purchases; this.debits = snapshot.debits; this.events = snapshot.events; this.inventory = snapshot.inventory; this.inventoryGrants = snapshot.inventoryGrants; this.couponOwnerships = snapshot.couponOwnerships;
      throw error;
    }
  }
}

const now = new Date("2026-09-12T12:00:00Z");
function listing(overrides: Partial<Listing> = {}): Listing { return { id: "listing-1", rewardDefinitionId: "reward-1", rewardType: "FRAME", code: "FRAME_NEON", name: "Neon Frame", imageUrl: "/frame.png", rarity: "EPIC", price: 250, active: true, rewardActive: true, availableFrom: null, availableUntil: null, purchaseLimit: null, ...overrides }; }
function input(overrides: Partial<StorePurchaseInput> = {}): StorePurchaseInput { return { playerId: "player-1", listingId: "listing-1", idempotencyKey: "purchase-key-1", now, ...overrides }; }
function setup(overrides: Partial<Listing> = {}) { const repo = new PurchaseHarness(); repo.listings.set("listing-1", listing(overrides)); repo.wallets.set("player-1", 1000); return { repo, service: new StorePurchaseService(repo) }; }

describe("secure Store purchases", () => {
  it("debits the authoritative price and stores immutable reward and balance snapshots", async () => {
    const { repo, service } = setup();
    const result = await service.purchase(input());
    expect(result).toMatchObject({ priceSynapsePoints: 250, balanceAfter: 750, reward: { rewardDefinitionId: "reward-1", code: "FRAME_NEON", rewardType: "FRAME", name: "Neon Frame" } });
    expect(repo.wallets.get("player-1")).toBe(750);
    expect(repo.debits[0]).toMatchObject({ amount: 250, sourceId: result.purchaseId, sourceType: "STORE_PURCHASE" });
    expect(repo.purchases[0].pointTransactionId).toBe(repo.debits[0].id);
    expect(repo.inventory.get("player-1:reward-1")).toBe(1); expect(repo.inventoryGrants).toHaveLength(1);
    expect(repo.events.map((event) => event.type)).toEqual(["inventory.item.granted", "store.purchase.completed"]);
  });

  it("handles free purchases without a zero-SP debit", async () => {
    const { repo, service } = setup({ price: 0 });
    const result = await service.purchase(input());
    expect(result.balanceAfter).toBe(1000);
    expect(repo.wallets.get("player-1")).toBe(1000);
    expect(repo.debits).toHaveLength(0);
    expect(repo.purchases[0].pointTransactionId).toBeNull();
    expect(repo.inventory.get("player-1:reward-1")).toBe(1);
  });

  it("replays exactly without another purchase, debit, event, or balance change", async () => {
    const { repo, service } = setup();
    const first = await service.purchase(input());
    const replay = await service.purchase(input());
    expect(replay).toMatchObject({ purchaseId: first.purchaseId, purchasedAt: first.purchasedAt, idempotent: true });
    expect(repo.purchases).toHaveLength(1); expect(repo.debits).toHaveLength(1); expect(repo.events).toHaveLength(2); expect(repo.inventoryGrants).toHaveLength(1); expect(repo.wallets.get("player-1")).toBe(750);
  });

  it("rejects conflicting listing reuse of a player idempotency key", async () => {
    const { repo, service } = setup(); repo.listings.set("listing-2", listing({ id: "listing-2" }));
    await service.purchase(input());
    await expect(service.purchase(input({ listingId: "listing-2" }))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", statusCode: 409 });
  });

  it("rejects insufficient funds without side effects", async () => {
    const { repo, service } = setup({ price: 1001 });
    await expect(service.purchase(input())).rejects.toMatchObject({ code: "INSUFFICIENT_POINTS" });
    expect(repo.purchases).toHaveLength(0); expect(repo.debits).toHaveLength(0); expect(repo.events).toHaveLength(0); expect(repo.wallets.get("player-1")).toBe(1000);
  });

  it.each([
    ["inactive listing", { active: false }], ["inactive reward", { rewardActive: false }],
    ["future listing", { availableFrom: new Date("2026-09-13T00:00:00Z") }], ["expired listing", { availableUntil: now }],
  ] as const)("rejects an %s", async (_name, overrides) => {
    const { repo, service } = setup(overrides);
    await expect(service.purchase(input())).rejects.toMatchObject({ code: "STORE_LISTING_UNAVAILABLE" });
    expect(repo.purchases).toHaveLength(0);
  });

  it("enforces purchase limit one", async () => {
    const { repo, service } = setup({ purchaseLimit: 1 });
    await service.purchase(input());
    await expect(service.purchase(input({ idempotencyKey: "purchase-key-2" }))).rejects.toMatchObject({ code: "PURCHASE_LIMIT_REACHED" });
    expect(repo.purchases).toHaveLength(1);
  });

  it("rejects an already-owned unique item before charging", async () => {
    const { repo, service } = setup(); repo.inventory.set("player-1:reward-1", 1);
    await expect(service.purchase(input())).rejects.toMatchObject({ code: "ITEM_ALREADY_OWNED" });
    expect(repo.wallets.get("player-1")).toBe(1000); expect(repo.debits).toHaveLength(0); expect(repo.purchases).toHaveLength(0);
  });

  it("stacks Rename Cards once per successful purchase", async () => {
    const { repo, service } = setup({ rewardType: "RENAME_CARD" });
    await service.purchase(input()); await service.purchase(input({ idempotencyKey: "purchase-key-2" }));
    expect(repo.inventory.get("player-1:reward-1")).toBe(2); expect(repo.inventoryGrants).toHaveLength(2);
  });

  it("creates one stable coupon ownership per Store purchase without using Inventory", async () => {
    const { repo, service } = setup({ rewardType: "COUPON" });
    const first = await service.purchase(input());
    const replay = await service.purchase(input());
    await service.purchase(input({ idempotencyKey: "purchase-key-2" }));

    expect(replay).toMatchObject({ purchaseId: first.purchaseId, idempotent: true });
    expect(repo.couponOwnerships).toHaveLength(2);
    expect(repo.couponOwnerships.map((coupon) => coupon.sourceId)).toEqual(["purchase-1", "purchase-2"]);
    expect(repo.inventory.has("player-1:reward-1")).toBe(false);
    expect(repo.inventoryGrants).toHaveLength(0);
    expect(repo.events.filter((event) => event.type === "coupon.issued")).toHaveLength(2);
  });

  it.each(["XP", "SYNAPSE_POINTS"] as const)("rejects %s Store rewards from Inventory", async (rewardType) => {
    const { repo, service } = setup({ rewardType }); await expect(service.purchase(input())).rejects.toMatchObject({ code: "STORE_REWARD_NOT_INVENTORY_SUPPORTED" }); expect(repo.debits).toHaveLength(0);
  });

  it("allows exactly N purchases", async () => {
    const { repo, service } = setup({ purchaseLimit: 2, rewardType: "RENAME_CARD" });
    await service.purchase(input()); await service.purchase(input({ idempotencyKey: "purchase-key-2" }));
    await expect(service.purchase(input({ idempotencyKey: "purchase-key-3" }))).rejects.toMatchObject({ code: "PURCHASE_LIMIT_REACHED" });
    expect(repo.purchases).toHaveLength(2);
  });

  it("serializes simultaneous exact retries to one debit", async () => {
    const { repo, service } = setup();
    const [first, replay] = await Promise.all([service.purchase(input()), service.purchase(input())]);
    expect(first.purchaseId).toBe(replay.purchaseId); expect([first.idempotent, replay.idempotent]).toEqual([false, true]); expect(repo.debits).toHaveLength(1);
  });

  it("does not let simultaneous distinct attempts bypass a limit", async () => {
    const { repo, service } = setup({ purchaseLimit: 1 });
    const results = await Promise.allSettled([service.purchase(input()), service.purchase(input({ idempotencyKey: "purchase-key-2" }))]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1); expect(repo.purchases).toHaveLength(1); expect(repo.debits).toHaveLength(1);
  });

  it("rolls back wallet, debit, purchase, and event after a post-debit failure", async () => {
    const { repo, service } = setup(); repo.failAfterDebit = true;
    await expect(service.purchase(input())).rejects.toThrow("simulated post-debit failure");
    expect(repo.wallets.get("player-1")).toBe(1000); expect(repo.debits).toHaveLength(0); expect(repo.purchases).toHaveLength(0); expect(repo.events).toHaveLength(0);
  });

  it("rolls back debit and purchase when Inventory grant fails", async () => {
    const { repo, service } = setup(); repo.failInventory = true;
    await expect(service.purchase(input())).rejects.toThrow("simulated entitlement failure");
    expect(repo.wallets.get("player-1")).toBe(1000); expect(repo.debits).toHaveLength(0); expect(repo.purchases).toHaveLength(0); expect(repo.inventoryGrants).toHaveLength(0); expect(repo.events).toHaveLength(0);
  });

  it("rolls back debit, purchase, and coupon ownership when coupon issuance fails", async () => {
    const { repo, service } = setup({ rewardType: "COUPON" }); repo.failInventory = true;
    await expect(service.purchase(input())).rejects.toThrow("simulated entitlement failure");
    expect(repo.wallets.get("player-1")).toBe(1000); expect(repo.debits).toHaveLength(0); expect(repo.purchases).toHaveLength(0); expect(repo.couponOwnerships).toHaveLength(0); expect(repo.events).toHaveLength(0);
  });
});
