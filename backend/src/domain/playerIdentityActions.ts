import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { inventoryConsumptions, playerInventoryItems, players, rewardDefinitions } from "../db/schema.js";
import { AppError, validationFailed } from "./errors.js";
import { insertGameEventInTransaction } from "./gameEvents.js";
import { readInventory, type InventoryDto } from "./inventory.js";

export interface RenameDisplayNameInput {
  playerId: string;
  inventoryItemId: string;
  displayName: string;
  idempotencyKey: string;
}

export interface RenameDisplayNameResult {
  inventoryConsumptionId: string;
  publicPlayerId: string;
  previousDisplayName: string;
  displayName: string;
  inventoryItemId: string;
  remainingQuantity: number;
  consumedAt: string;
  idempotent: boolean;
  inventory: InventoryDto;
}

interface RenameMetadata {
  inventoryItemId: string;
  previousDisplayName: string;
  displayName: string;
  publicPlayerId: string;
}

export function normalizeDisplayName(value: string) {
  if (/[\p{Cc}\p{Cf}]/u.test(value)) throw validationFailed("Display name must be a single line without control characters.");
  const normalized = value.trim();
  const length = [...normalized].length;
  if (length < 2 || length > 32) throw validationFailed("Display name must be between 2 and 32 characters.");
  return normalized;
}

export interface PlayerIdentityActionRepository {
  renameDisplayName(input: RenameDisplayNameInput & { displayName: string }): Promise<RenameDisplayNameResult>;
}

export class PlayerIdentityActionService {
  constructor(private repo: PlayerIdentityActionRepository) {}

  renameDisplayName(input: RenameDisplayNameInput) {
    if (!input.playerId || !input.inventoryItemId || !input.idempotencyKey?.trim() || input.idempotencyKey.trim().length > 200) {
      throw validationFailed("Player, Rename Card, display name, and a valid Idempotency-Key are required.");
    }
    return this.repo.renameDisplayName({ ...input, displayName: normalizeDisplayName(input.displayName), idempotencyKey: input.idempotencyKey.trim() });
  }
}

export class DrizzlePlayerIdentityActionRepository implements PlayerIdentityActionRepository {
  constructor(private db: Database) {}

  renameDisplayName(input: RenameDisplayNameInput & { displayName: string }): Promise<RenameDisplayNameResult> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.playerId}:display-name`}, 0))`);

      const [replay] = await tx.select().from(inventoryConsumptions).where(and(
        eq(inventoryConsumptions.playerId, input.playerId),
        eq(inventoryConsumptions.idempotencyKey, input.idempotencyKey),
      )).limit(1);
      if (replay) {
        const metadata = replay.metadata as Partial<RenameMetadata>;
        if (metadata.inventoryItemId !== input.inventoryItemId || metadata.displayName !== input.displayName || !metadata.previousDisplayName || !metadata.publicPlayerId) {
          throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for another display name change.", 409);
        }
        return resultFromConsumption(replay, metadata as RenameMetadata, await readInventory(tx, input.playerId), true);
      }

      const [player] = await tx.select().from(players).where(eq(players.playerId, input.playerId)).limit(1).for("update");
      if (!player) throw new AppError("PLAYER_NOT_FOUND", "Player was not found.", 404);
      if (player.displayName === input.displayName) throw new AppError("DISPLAY_NAME_UNCHANGED", "Choose a display name different from your current name.", 409);

      const [owned] = await tx.select({ item: playerInventoryItems, reward: rewardDefinitions })
        .from(playerInventoryItems)
        .innerJoin(rewardDefinitions, eq(playerInventoryItems.rewardDefinitionId, rewardDefinitions.rewardDefinitionId))
        .where(and(eq(playerInventoryItems.playerInventoryItemId, input.inventoryItemId), eq(playerInventoryItems.playerId, input.playerId)))
        .limit(1)
        .for("update");
      if (!owned || owned.item.quantity <= 0) throw new AppError("RENAME_CARD_NOT_AVAILABLE", "A Rename Card is not available.", 409);
      if (owned.reward.rewardType !== "RENAME_CARD") throw new AppError("RENAME_CARD_REQUIRED", "This Inventory item is not a Rename Card.", 409);

      const remainingQuantity = owned.item.quantity - 1;
      await tx.update(playerInventoryItems).set({ quantity: remainingQuantity, updatedAt: new Date() })
        .where(eq(playerInventoryItems.playerInventoryItemId, owned.item.playerInventoryItemId));
      await tx.update(players).set({ displayName: input.displayName, updatedAt: new Date() }).where(eq(players.playerId, input.playerId));

      const metadata: RenameMetadata = { inventoryItemId: input.inventoryItemId, previousDisplayName: player.displayName, displayName: input.displayName, publicPlayerId: player.publicPlayerId };
      const [consumption] = await tx.insert(inventoryConsumptions).values({
        playerId: input.playerId,
        playerInventoryItemId: input.inventoryItemId,
        rewardDefinitionId: owned.reward.rewardDefinitionId,
        quantity: 1,
        quantityAfter: remainingQuantity,
        reason: "DISPLAY_NAME_CHANGE",
        idempotencyKey: input.idempotencyKey,
        metadata: { ...metadata },
      }).returning();
      if (!consumption) throw new AppError("INVENTORY_CONSUMPTION_FAILED", "Could not consume Rename Card.", 500);

      await insertGameEventInTransaction(tx, {
        playerId: input.playerId,
        eventType: "inventory.item.consumed",
        sourceType: "INVENTORY_CONSUMPTION",
        sourceId: consumption.inventoryConsumptionId,
        idempotencyKey: `inventory.item.consumed:${consumption.inventoryConsumptionId}`,
        payload: { rewardDefinitionId: owned.reward.rewardDefinitionId, inventoryItemId: input.inventoryItemId, rewardType: "RENAME_CARD", quantity: 1, quantityAfter: remainingQuantity, reason: "DISPLAY_NAME_CHANGE" },
      });
      await insertGameEventInTransaction(tx, {
        playerId: input.playerId,
        eventType: "player.display_name.changed",
        sourceType: "INVENTORY_CONSUMPTION",
        sourceId: consumption.inventoryConsumptionId,
        idempotencyKey: `player.display_name.changed:${consumption.inventoryConsumptionId}`,
        payload: { previousDisplayName: player.displayName, displayName: input.displayName },
      });

      return resultFromConsumption(consumption, metadata, await readInventory(tx, input.playerId), false);
    });
  }
}

function resultFromConsumption(consumption: typeof inventoryConsumptions.$inferSelect, metadata: RenameMetadata, inventory: InventoryDto, idempotent: boolean): RenameDisplayNameResult {
  return {
    inventoryConsumptionId: consumption.inventoryConsumptionId,
    publicPlayerId: metadata.publicPlayerId,
    previousDisplayName: metadata.previousDisplayName,
    displayName: metadata.displayName,
    inventoryItemId: metadata.inventoryItemId,
    remainingQuantity: consumption.quantityAfter,
    consumedAt: consumption.createdAt.toISOString(),
    idempotent,
    inventory,
  };
}
