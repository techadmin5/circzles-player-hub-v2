import { and, asc, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema.js";
import { rewardDefinitions, storeListings } from "../db/schema.js";
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
}

export interface RewardCatalogRepository {
  listAvailable(now: Date): Promise<StoreCatalogItemDto[]>;
}

export class RewardCatalogService {
  constructor(private repo: RewardCatalogRepository) {}

  listAvailable(now = new Date()) {
    if (Number.isNaN(now.getTime())) throw validationFailed("Catalog time must be valid.");
    return this.repo.listAvailable(now);
  }
}

export class DrizzleRewardCatalogRepository implements RewardCatalogRepository {
  constructor(private db: Db) {}

  async listAvailable(now: Date): Promise<StoreCatalogItemDto[]> {
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

    return rows.map(({ listing, reward }) => ({
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
    }));
  }
}
