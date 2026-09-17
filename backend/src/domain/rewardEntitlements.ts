import type { GameStateTransaction } from "./gameState.js";
import { grantCouponOwnershipInTransaction, type CouponGrantInput } from "./coupons.js";
import { assertInventoryPurchasableInTransaction, grantInventoryItemInTransaction, type InventoryGrantInput } from "./inventory.js";

export type RewardEntitlementInput = InventoryGrantInput & Pick<CouponGrantInput, "issuedAt" | "expiresAt">;

export async function assertRewardEntitlementPurchasableInTransaction(tx: GameStateTransaction, input: Pick<RewardEntitlementInput, "playerId" | "rewardDefinitionId" | "rewardType">) {
  if (input.rewardType === "COUPON") return;
  await assertInventoryPurchasableInTransaction(tx, input.playerId, input.rewardDefinitionId, input.rewardType);
}

export async function grantRewardEntitlementInTransaction(tx: GameStateTransaction, input: RewardEntitlementInput) {
  if (input.rewardType === "COUPON") {
    return { kind: "COUPON" as const, coupon: await grantCouponOwnershipInTransaction(tx, input) };
  }
  return { kind: "INVENTORY" as const, inventory: await grantInventoryItemInTransaction(tx, input) };
}
