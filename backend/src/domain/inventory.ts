import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { inventoryGrants, playerEquipment, playerInventoryItems, rewardDefinitions } from "../db/schema.js";
import { AppError, validationFailed } from "./errors.js";
import { insertGameEventInTransaction } from "./gameEvents.js";
import type { GameStateTransaction } from "./gameState.js";
import type { RewardDefinitionType } from "./rewardCatalog.js";

export const equipmentSlots = ["FRAME", "AVATAR", "BADGE_1", "BADGE_2", "BADGE_3"] as const;
export type EquipmentSlot = typeof equipmentSlots[number];
export const uniqueInventoryTypes: RewardDefinitionType[] = ["FRAME", "BADGE", "AVATAR", "COSMETIC"];
export const stackableInventoryTypes: RewardDefinitionType[] = ["RENAME_CARD"];

export interface InventoryItemDto { inventoryItemId: string; rewardDefinitionId: string; code: string; rewardType: RewardDefinitionType; name: string; description: string; imageUrl: string | null; rarity: string | null; quantity: number; firstAcquiredAt: string; equippedSlots: EquipmentSlot[] }
export interface InventoryDto { items: InventoryItemDto[]; equipment: Partial<Record<EquipmentSlot, string>> }
export interface InventoryGrantInput { playerId: string; rewardDefinitionId: string; rewardType: RewardDefinitionType; quantity: number; sourceType: string; sourceId: string; idempotencyKey: string }

export function isInventorySupported(type: RewardDefinitionType) { return uniqueInventoryTypes.includes(type) || stackableInventoryTypes.includes(type); }

export async function assertInventoryPurchasableInTransaction(tx: GameStateTransaction, playerId: string, rewardDefinitionId: string, rewardType: RewardDefinitionType) {
  if (!isInventorySupported(rewardType)) throw new AppError("STORE_REWARD_NOT_INVENTORY_SUPPORTED", "This reward type is not supported by Inventory.", 409);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${playerId}:${rewardDefinitionId}`}, 0))`);
  if (!uniqueInventoryTypes.includes(rewardType)) return;
  const [existing] = await tx.select().from(playerInventoryItems).where(and(eq(playerInventoryItems.playerId, playerId), eq(playerInventoryItems.rewardDefinitionId, rewardDefinitionId))).limit(1).for("update");
  if (existing?.quantity && existing.quantity > 0) throw new AppError("ITEM_ALREADY_OWNED", "This item is already owned.", 409);
}

export async function grantInventoryItemInTransaction(tx: GameStateTransaction, input: InventoryGrantInput) {
  if (!isInventorySupported(input.rewardType)) throw new AppError("INVENTORY_REWARD_NOT_SUPPORTED", "This reward type is not supported by Inventory.", 409);
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw validationFailed("Inventory grant quantity must be a positive integer.");
  if (uniqueInventoryTypes.includes(input.rewardType) && input.quantity !== 1) throw validationFailed("Unique Inventory rewards must be granted with quantity one.");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.playerId}:${input.rewardDefinitionId}`}, 0))`);
  const [replay] = await tx.select().from(inventoryGrants).where(and(eq(inventoryGrants.playerId, input.playerId), eq(inventoryGrants.idempotencyKey, input.idempotencyKey))).limit(1);
  if (replay) {
    if (replay.rewardDefinitionId !== input.rewardDefinitionId || replay.quantity !== input.quantity || replay.sourceType !== input.sourceType || replay.sourceId !== input.sourceId) throw new AppError("IDEMPOTENCY_CONFLICT", "Inventory grant key was already used for another operation.", 409);
    const [item] = await tx.select().from(playerInventoryItems).where(and(eq(playerInventoryItems.playerId, input.playerId), eq(playerInventoryItems.rewardDefinitionId, input.rewardDefinitionId))).limit(1);
    if (!item) throw new AppError("INVENTORY_STATE_INVALID", "Inventory state is inconsistent.", 500);
    return { grant: replay, item, idempotent: true };
  }
  const [existing] = await tx.select().from(playerInventoryItems).where(and(eq(playerInventoryItems.playerId, input.playerId), eq(playerInventoryItems.rewardDefinitionId, input.rewardDefinitionId))).limit(1).for("update");
  if (uniqueInventoryTypes.includes(input.rewardType) && existing?.quantity && existing.quantity > 0) throw new AppError("ITEM_ALREADY_OWNED", "This item is already owned.", 409);
  const [grant] = await tx.insert(inventoryGrants).values(input).returning();
  if (!grant) throw new AppError("INVENTORY_GRANT_FAILED", "Could not record Inventory grant.", 500);
  const quantity = uniqueInventoryTypes.includes(input.rewardType) ? 1 : (existing?.quantity ?? 0) + input.quantity;
  const [item] = existing
    ? await tx.update(playerInventoryItems).set({ quantity, updatedAt: new Date() }).where(eq(playerInventoryItems.playerInventoryItemId, existing.playerInventoryItemId)).returning()
    : await tx.insert(playerInventoryItems).values({ playerId: input.playerId, rewardDefinitionId: input.rewardDefinitionId, quantity }).returning();
  if (!item) throw new AppError("INVENTORY_GRANT_FAILED", "Could not update Inventory.", 500);
  await insertGameEventInTransaction(tx, { playerId: input.playerId, eventType: "inventory.item.granted", sourceType: input.sourceType, sourceId: input.sourceId, idempotencyKey: `inventory.item.granted:${grant.inventoryGrantId}`, payload: { rewardDefinitionId: input.rewardDefinitionId, rewardType: input.rewardType, quantity: input.quantity, sourceType: input.sourceType } });
  return { grant, item, idempotent: false };
}

export interface InventoryRepository { list(playerId: string): Promise<InventoryDto>; equip(playerId: string, inventoryItemId: string, slot: EquipmentSlot): Promise<InventoryDto>; unequip(playerId: string, slot: EquipmentSlot): Promise<InventoryDto> }
export class InventoryService {
  constructor(private repo: InventoryRepository) {}
  list(playerId: string) { return this.repo.list(playerId); }
  equip(playerId: string, inventoryItemId: string, slot: EquipmentSlot) { if (!equipmentSlots.includes(slot)) throw validationFailed("Invalid equipment slot."); return this.repo.equip(playerId, inventoryItemId, slot); }
  unequip(playerId: string, slot: EquipmentSlot) { if (!equipmentSlots.includes(slot)) throw validationFailed("Invalid equipment slot."); return this.repo.unequip(playerId, slot); }
}

export class DrizzleInventoryRepository implements InventoryRepository {
  constructor(private db: Database) {}
  list(playerId: string) { return readInventory(this.db, playerId); }
  equip(playerId: string, inventoryItemId: string, slot: EquipmentSlot) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${playerId}:equipment`}, 0))`);
      const [owned] = await tx.select({ item: playerInventoryItems, reward: rewardDefinitions }).from(playerInventoryItems).innerJoin(rewardDefinitions, eq(playerInventoryItems.rewardDefinitionId, rewardDefinitions.rewardDefinitionId)).where(and(eq(playerInventoryItems.playerInventoryItemId, inventoryItemId), eq(playerInventoryItems.playerId, playerId))).limit(1).for("update");
      if (!owned) throw new AppError("INVENTORY_ITEM_NOT_FOUND", "Inventory item was not found.", 404);
      if (owned.item.quantity <= 0) throw new AppError("INVENTORY_ITEM_UNAVAILABLE", "Inventory item is not currently owned.", 409);
      if (!slotAccepts(slot, owned.reward.rewardType)) throw new AppError("EQUIPMENT_SLOT_INCOMPATIBLE", "This item cannot be equipped in that slot.", 409);
      const [otherSlot] = await tx.select().from(playerEquipment).where(and(eq(playerEquipment.playerId, playerId), eq(playerEquipment.playerInventoryItemId, inventoryItemId))).limit(1).for("update");
      if (otherSlot && otherSlot.slot !== slot) throw new AppError("ITEM_ALREADY_EQUIPPED", "This item is already equipped in another slot.", 409);
      const [equipment] = await tx.insert(playerEquipment).values({ playerId, slot, playerInventoryItemId: inventoryItemId }).onConflictDoUpdate({ target: [playerEquipment.playerId, playerEquipment.slot], set: { playerInventoryItemId: inventoryItemId, equippedAt: new Date(), updatedAt: new Date() } }).returning();
      await insertGameEventInTransaction(tx, { playerId, eventType: "inventory.item.equipped", sourceType: "PLAYER_EQUIPMENT", sourceId: equipment.playerEquipmentId, idempotencyKey: `inventory.item.equipped:${equipment.playerEquipmentId}:${equipment.equippedAt.toISOString()}`, payload: { rewardDefinitionId: owned.reward.rewardDefinitionId, inventoryItemId, slot } });
      return readInventory(tx, playerId);
    });
  }
  unequip(playerId: string, slot: EquipmentSlot) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${playerId}:equipment`}, 0))`);
      const [equipped] = await tx.select({ equipment: playerEquipment, item: playerInventoryItems }).from(playerEquipment).innerJoin(playerInventoryItems, eq(playerEquipment.playerInventoryItemId, playerInventoryItems.playerInventoryItemId)).where(and(eq(playerEquipment.playerId, playerId), eq(playerEquipment.slot, slot))).limit(1).for("update");
      if (!equipped) return readInventory(tx, playerId);
      await tx.delete(playerEquipment).where(eq(playerEquipment.playerEquipmentId, equipped.equipment.playerEquipmentId));
      await insertGameEventInTransaction(tx, { playerId, eventType: "inventory.item.unequipped", sourceType: "PLAYER_EQUIPMENT", sourceId: equipped.equipment.playerEquipmentId, idempotencyKey: `inventory.item.unequipped:${equipped.equipment.playerEquipmentId}:${crypto.randomUUID()}`, payload: { rewardDefinitionId: equipped.item.rewardDefinitionId, inventoryItemId: equipped.item.playerInventoryItemId, slot } });
      return readInventory(tx, playerId);
    });
  }
}

function slotAccepts(slot: EquipmentSlot, type: RewardDefinitionType) { return (slot === "FRAME" && type === "FRAME") || (slot === "AVATAR" && type === "AVATAR") || (slot.startsWith("BADGE_") && type === "BADGE"); }
export async function readInventory(db: Pick<Database, "select">, playerId: string): Promise<InventoryDto> {
  const rows = await db.select({ item: playerInventoryItems, reward: rewardDefinitions }).from(playerInventoryItems).innerJoin(rewardDefinitions, eq(playerInventoryItems.rewardDefinitionId, rewardDefinitions.rewardDefinitionId)).where(eq(playerInventoryItems.playerId, playerId)).orderBy(asc(playerInventoryItems.firstAcquiredAt), asc(playerInventoryItems.playerInventoryItemId));
  const equipment = await db.select().from(playerEquipment).where(eq(playerEquipment.playerId, playerId));
  const slotsByItem = new Map<string, EquipmentSlot[]>(); const summary: Partial<Record<EquipmentSlot, string>> = {};
  for (const row of equipment) { const slots = slotsByItem.get(row.playerInventoryItemId) ?? []; slots.push(row.slot); slotsByItem.set(row.playerInventoryItemId, slots); summary[row.slot] = row.playerInventoryItemId; }
  return { items: rows.map(({ item, reward }) => ({ inventoryItemId: item.playerInventoryItemId, rewardDefinitionId: reward.rewardDefinitionId, code: reward.code, rewardType: reward.rewardType, name: reward.name, description: reward.description, imageUrl: reward.imageUrl, rarity: reward.rarity, quantity: item.quantity, firstAcquiredAt: item.firstAcquiredAt.toISOString(), equippedSlots: slotsByItem.get(item.playerInventoryItemId) ?? [] })), equipment: summary };
}
