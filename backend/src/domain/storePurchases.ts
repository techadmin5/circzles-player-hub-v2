import { and, count, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { rewardDefinitions, storeListings, storePurchases } from "../db/schema.js";
import { AppError, validationFailed } from "./errors.js";
import { debitPointsInTransaction, lockWalletAndGetBalanceInTransaction, type GameStateTransaction } from "./gameState.js";
import { insertGameEventInTransaction } from "./gameEvents.js";
import type { RewardDefinitionType } from "./rewardCatalog.js";
import { assertRewardEntitlementPurchasableInTransaction, grantRewardEntitlementInTransaction } from "./rewardEntitlements.js";

export interface StorePurchaseInput { playerId: string; listingId: string; idempotencyKey: string; now?: Date }
export interface StorePurchaseResult {
  purchaseId: string;
  listingId: string;
  reward: { rewardDefinitionId: string; code: string; rewardType: RewardDefinitionType; name: string; imageUrl: string | null; rarity: string | null };
  priceSynapsePoints: number;
  balanceAfter: number;
  purchasedAt: string;
  idempotent: boolean;
}

export interface StorePurchaseRepository { purchase(input: StorePurchaseInput): Promise<StorePurchaseResult> }

export class StorePurchaseService {
  constructor(private repo: StorePurchaseRepository) {}

  purchase(input: StorePurchaseInput) {
    if (!input.playerId || !input.listingId || !input.idempotencyKey?.trim() || input.idempotencyKey.trim().length > 200) {
      throw validationFailed("Player, listing, and a valid Idempotency-Key are required.");
    }
    const now = input.now ?? new Date();
    if (Number.isNaN(now.getTime())) throw validationFailed("Purchase time must be valid.");
    return this.repo.purchase({ ...input, idempotencyKey: input.idempotencyKey.trim(), now });
  }
}

export class DrizzleStorePurchaseRepository implements StorePurchaseRepository {
  constructor(private db: Database) {}

  purchase(input: StorePurchaseInput): Promise<StorePurchaseResult> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.playerId}:${input.idempotencyKey}`}, 0))`);
      const [replay] = await tx.select().from(storePurchases).where(and(eq(storePurchases.playerId, input.playerId), eq(storePurchases.idempotencyKey, input.idempotencyKey))).limit(1);
      if (replay) {
        if (replay.storeListingId !== input.listingId) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different Store purchase.", 409);
        return purchaseResult(replay, true);
      }

      const [authority] = await tx.select({ listing: storeListings, reward: rewardDefinitions }).from(storeListings)
        .innerJoin(rewardDefinitions, eq(storeListings.rewardDefinitionId, rewardDefinitions.rewardDefinitionId))
        .where(eq(storeListings.storeListingId, input.listingId)).limit(1).for("share");
      const now = input.now ?? new Date();
      if (!authority || !authority.listing.active || !authority.reward.active
        || (authority.listing.availableFrom && now < authority.listing.availableFrom)
        || (authority.listing.availableUntil && now >= authority.listing.availableUntil)) {
        throw new AppError("STORE_LISTING_UNAVAILABLE", "This Store listing is not currently available.", 409);
      }

      const currentBalance = await lockWalletAndGetBalanceInTransaction(tx, input.playerId);
      const [{ purchaseCount }] = await tx.select({ purchaseCount: count() }).from(storePurchases).where(and(
        eq(storePurchases.playerId, input.playerId),
        eq(storePurchases.storeListingId, authority.listing.storeListingId),
      ));
      if (authority.listing.purchaseLimit !== null && purchaseCount >= authority.listing.purchaseLimit) {
        throw new AppError("PURCHASE_LIMIT_REACHED", "The purchase limit for this Store listing has been reached.", 409);
      }

      await assertRewardEntitlementPurchasableInTransaction(tx, { playerId: input.playerId, rewardDefinitionId: authority.reward.rewardDefinitionId, rewardType: authority.reward.rewardType });

      const purchaseId = crypto.randomUUID();
      const price = authority.listing.priceSynapsePoints;
      const ledger = price > 0 ? await debitPointsInTransaction(tx, {
        playerId: input.playerId,
        amount: price,
        reason: "STORE_PURCHASE",
        sourceType: "STORE_PURCHASE",
        sourceId: purchaseId,
        idempotencyKey: `store.purchase.debit:${purchaseId}`,
        metadata: { purchaseId, listingId: authority.listing.storeListingId, rewardDefinitionId: authority.reward.rewardDefinitionId },
      }) : undefined;
      const balanceAfter = ledger?.balanceAfter ?? currentBalance;

      const [purchase] = await tx.insert(storePurchases).values({
        purchaseId,
        playerId: input.playerId,
        storeListingId: authority.listing.storeListingId,
        rewardDefinitionId: authority.reward.rewardDefinitionId,
        priceSynapsePointsSnapshot: price,
        rewardTypeSnapshot: authority.reward.rewardType,
        rewardCodeSnapshot: authority.reward.code,
        rewardNameSnapshot: authority.reward.name,
        raritySnapshot: authority.reward.rarity,
        imageUrlSnapshot: authority.reward.imageUrl,
        pointTransactionId: ledger?.transactionId,
        balanceAfter,
        idempotencyKey: input.idempotencyKey,
      }).returning();
      if (!purchase) throw new AppError("STORE_PURCHASE_FAILED", "Could not record Store purchase.", 500);

      await grantStorePurchaseEntitlementInTransaction(tx, { playerId: input.playerId, rewardDefinitionId: authority.reward.rewardDefinitionId, rewardType: authority.reward.rewardType, purchaseId: purchase.purchaseId, issuedAt: now });

      await insertGameEventInTransaction(tx, {
        playerId: input.playerId,
        eventType: "store.purchase.completed",
        sourceType: "STORE_PURCHASE",
        sourceId: purchase.purchaseId,
        idempotencyKey: `store.purchase.completed:${purchase.purchaseId}`,
        payload: { purchaseId: purchase.purchaseId, listingId: purchase.storeListingId, rewardDefinitionId: purchase.rewardDefinitionId, rewardType: purchase.rewardTypeSnapshot, priceSynapsePoints: purchase.priceSynapsePointsSnapshot, balanceAfter: purchase.balanceAfter },
      });
      return purchaseResult(purchase, false);
    });
  }
}

export function grantStorePurchaseEntitlementInTransaction(tx: GameStateTransaction, input: { playerId: string; rewardDefinitionId: string; rewardType: RewardDefinitionType; purchaseId: string; issuedAt: Date }) {
  return grantRewardEntitlementInTransaction(tx, {
    playerId: input.playerId,
    rewardDefinitionId: input.rewardDefinitionId,
    rewardType: input.rewardType,
    quantity: 1,
    sourceType: "STORE_PURCHASE",
    sourceId: input.purchaseId,
    idempotencyKey: `store.purchase.entitlement:${input.purchaseId}`,
    issuedAt: input.issuedAt,
  });
}

function purchaseResult(purchase: typeof storePurchases.$inferSelect, idempotent: boolean): StorePurchaseResult {
  return {
    purchaseId: purchase.purchaseId,
    listingId: purchase.storeListingId,
    reward: { rewardDefinitionId: purchase.rewardDefinitionId, code: purchase.rewardCodeSnapshot, rewardType: purchase.rewardTypeSnapshot, name: purchase.rewardNameSnapshot, imageUrl: purchase.imageUrlSnapshot, rarity: purchase.raritySnapshot },
    priceSynapsePoints: purchase.priceSynapsePointsSnapshot,
    balanceAfter: purchase.balanceAfter,
    purchasedAt: purchase.purchasedAt.toISOString(),
    idempotent,
  };
}
