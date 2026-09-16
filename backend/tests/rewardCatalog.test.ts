import { describe, expect, it } from "vitest";
import { RewardCatalogService, type RewardCatalogRepository, type StoreCatalogItemDto } from "../src/domain/rewardCatalog.js";

class FakeRewardCatalogRepository implements RewardCatalogRepository {
  rows: Array<StoreCatalogItemDto & { active: boolean; rewardActive: boolean; availableFrom: Date | null; availableUntil: Date | null }> = [];

  async listAvailable(now: Date, playerId: string) {
    void playerId;
    return this.rows
      .filter((row) => row.active && row.rewardActive && (!row.availableFrom || row.availableFrom <= now) && (!row.availableUntil || row.availableUntil > now))
      .sort((a, b) => Number(b.featured) - Number(a.featured) || a.displayOrder - b.displayOrder || a.listingId.localeCompare(b.listingId))
      .map((row) => ({
        listingId: row.listingId,
        rewardDefinitionId: row.rewardDefinitionId,
        code: row.code,
        rewardType: row.rewardType,
        name: row.name,
        description: row.description,
        imageUrl: row.imageUrl,
        rarity: row.rarity,
        priceSynapsePoints: row.priceSynapsePoints,
        featured: row.featured,
        displayOrder: row.displayOrder,
        purchaseLimit: row.purchaseLimit,
        ownedQuantity: row.ownedQuantity,
        alreadyOwned: row.alreadyOwned,
        purchaseCount: row.purchaseCount,
        remainingPurchases: row.remainingPurchases,
        canPurchase: row.canPurchase,
      }));
  }
}

const now = new Date("2026-09-12T12:00:00.000Z");
function item(overrides: Partial<FakeRewardCatalogRepository["rows"][number]> = {}): FakeRewardCatalogRepository["rows"][number] {
  return {
    listingId: "10000000-0000-4000-8000-000000000001",
    rewardDefinitionId: "20000000-0000-4000-8000-000000000001",
    code: "FRAME_NEON_CIRCUIT",
    rewardType: "FRAME",
    name: "Neon Circuit Frame",
    description: "A profile frame.",
    imageUrl: null,
    rarity: "EPIC",
    priceSynapsePoints: 0,
    featured: false,
    displayOrder: 0,
    purchaseLimit: null,
    ownedQuantity: 0,
    alreadyOwned: false,
    purchaseCount: 0,
    remainingPurchases: null,
    canPurchase: true,
    active: true,
    rewardActive: true,
    availableFrom: null,
    availableUntil: null,
    ...overrides,
  };
}

describe("reward store catalog", () => {
  it("returns active and currently available listings, including zero-price listings", async () => {
    const repo = new FakeRewardCatalogRepository();
    repo.rows = [
      item(),
      item({ listingId: "inactive", active: false }),
      item({ listingId: "inactive-reward", rewardActive: false }),
      item({ listingId: "future", availableFrom: new Date("2026-09-13T00:00:00Z") }),
      item({ listingId: "expired", availableUntil: now }),
    ];
    const result = await new RewardCatalogService(repo).listAvailable("player-1", now);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ listingId: item().listingId, priceSynapsePoints: 0 });
  });

  it("keeps stable definition and listing identities and omits internal metadata", async () => {
    const repo = new FakeRewardCatalogRepository();
    repo.rows = [item()];
    const [result] = await new RewardCatalogService(repo).listAvailable("player-1", now);
    expect(result).toMatchObject({ listingId: item().listingId, rewardDefinitionId: item().rewardDefinitionId, code: "FRAME_NEON_CIRCUIT" });
    expect(result).not.toHaveProperty("metadata");
  });

  it("rejects an invalid catalog clock", () => {
    const service = new RewardCatalogService(new FakeRewardCatalogRepository());
    expect(() => service.listAvailable("player-1", new Date("invalid"))).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });
});
