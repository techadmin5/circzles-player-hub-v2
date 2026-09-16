import { and, asc, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema.js";
import { playerInventoryItems, rewardDefinitions, storeListings, storePurchases } from "../db/schema.js";
import { validationFailed } from "./errors.js";

type Db = NodePgDatabase<typeof schema>;
export type RewardDefinitionType = "FRAME" | "BADGE" | "AVATAR" | "RENAME_CARD" | "COUPON" | "SYNAPSE_POINTS" | "XP" | "COSMETIC";

export interface StoreCatalogItemDto {
  listingId: string;
  rewardDefinitionId: string;
  code: string;
  rewardType: RewardDefinitionType;
  name: string;
  description: string;
  imageUrl: string | null;
  rarity: string | null;
  priceSynapsePoints: number;
  featured: boolean;
  displayOrder: number;
  purchaseLimit: number | null;
  ownedQuantity: number;
  alreadyOwned: boolean;
  purchaseCount: number;
  remainingPurchases: number | null;
  canPurchase: boolean;
}

export interface RewardCatalogRepository {
  listAvailable(now: Date, playerId: string): Promise<StoreCatalogItemDto[]>;
}

export class RewardCatalogService {
  constructor(private repo: RewardCatalogRepository) {}

  listAvailable(playerId: string, now = new Date()) {
    if (Number.isNaN(now.getTime())) throw validationFailed("Catalog time must be valid.");
    return this.repo.listAvailable(now, playerId);
  }
}

export class DrizzleRewardCatalogRepository implements RewardCatalogRepository {
  constructor(private db: Db) {}

  async listAvailable(now: Date, playerId: string): Promise<StoreCatalogItemDto[]> {
    const rows = await this.db.select({ listing: storeListings, reward: rewardDefinitions })
      .from(storeListings)
      .innerJoin(rewardDefinitions, eq(storeListings.rewardDefinitionId, rewardDefinitions.rewardDefinitionId))
      .where(and(
        eq(storeListings.active, true),
        eq(rewardDefinitions.active, true),
        or(isNull(storeListings.availableFrom), lte(storeListings.availableFrom, now)),
        or(isNull(storeListings.availableUntil), gt(storeListings.availableUntil, now)),
      ))
      .orderBy(desc(storeListings.featured), asc(storeListings.displayOrder), asc(storeListings.storeListingId));

    const ownedRows = await this.db.select().from(playerInventoryItems).where(eq(playerInventoryItems.playerId, playerId));
    const purchaseRows = await this.db.select({ storeListingId: storePurchases.storeListingId }).from(storePurchases).where(eq(storePurchases.playerId, playerId));
    const owned = new Map(ownedRows.map((row) => [row.rewardDefinitionId, row.quantity]));
    const purchases = new Map<string, number>();
    for (const row of purchaseRows) purchases.set(row.storeListingId, (purchases.get(row.storeListingId) ?? 0) + 1);
    return rows.map(({ listing, reward }) => {
      const ownedQuantity = owned.get(reward.rewardDefinitionId) ?? 0;
      const purchaseCount = purchases.get(listing.storeListingId) ?? 0;
      const remainingPurchases = listing.purchaseLimit === null ? null : Math.max(0, listing.purchaseLimit - purchaseCount);
      const uniqueOwned = ["FRAME", "BADGE", "AVATAR", "COSMETIC"].includes(reward.rewardType) && ownedQuantity > 0;
      const supported = !["SYNAPSE_POINTS", "XP"].includes(reward.rewardType);
      return ({
      listingId: listing.storeListingId,
      rewardDefinitionId: reward.rewardDefinitionId,
      code: reward.code,
      rewardType: reward.rewardType,
      name: reward.name,
      description: reward.description,
      imageUrl: reward.imageUrl,
      rarity: reward.rarity,
      priceSynapsePoints: listing.priceSynapsePoints,
      featured: listing.featured,
      displayOrder: listing.displayOrder,
      purchaseLimit: listing.purchaseLimit,
      ownedQuantity, alreadyOwned: ownedQuantity > 0, purchaseCount, remainingPurchases,
      canPurchase: supported && !uniqueOwned && (remainingPurchases === null || remainingPurchases > 0),
    }); });
  }
}
