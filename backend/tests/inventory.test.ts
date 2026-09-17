import { describe, expect, it } from "vitest";
import { AppError } from "../src/domain/errors.js";
import { equipmentSlots, InventoryService, isInventorySupported, stackableInventoryTypes, uniqueInventoryTypes, type EquipmentSlot, type InventoryDto, type InventoryRepository } from "../src/domain/inventory.js";
import type { RewardDefinitionType } from "../src/domain/rewardCatalog.js";

type Item = InventoryDto["items"][number] & { playerId: string };
type Grant = { playerId: string; rewardType: RewardDefinitionType; rewardDefinitionId: string; quantity: number; idempotencyKey: string };

class GrantHarness {
  grants: Grant[] = [];
  inventory = new Map<string, number>();

  grant(input: Grant) {
    if (!isInventorySupported(input.rewardType)) throw new AppError("INVENTORY_REWARD_UNSUPPORTED", "Unsupported reward.", 409);
    const replay = this.grants.find((grant) => grant.playerId === input.playerId && grant.idempotencyKey === input.idempotencyKey);
    if (replay) {
      if (replay.rewardDefinitionId !== input.rewardDefinitionId || replay.rewardType !== input.rewardType || replay.quantity !== input.quantity) {
        throw new AppError("IDEMPOTENCY_CONFLICT", "Grant payload differs.", 409);
      }
      return { quantity: this.inventory.get(`${input.playerId}:${input.rewardDefinitionId}`), idempotent: true };
    }
    const key = `${input.playerId}:${input.rewardDefinitionId}`;
    const current = this.inventory.get(key) ?? 0;
    if (uniqueInventoryTypes.includes(input.rewardType as (typeof uniqueInventoryTypes)[number]) && current > 0) {
      throw new AppError("ITEM_ALREADY_OWNED", "Owned.", 409);
    }
    this.grants.push(input);
    this.inventory.set(key, uniqueInventoryTypes.includes(input.rewardType as (typeof uniqueInventoryTypes)[number]) ? 1 : current + input.quantity);
    return { quantity: this.inventory.get(key), idempotent: false };
  }
}

class InventoryHarness implements InventoryRepository {
  items = new Map<string, Item>(); equipment: Partial<Record<EquipmentSlot, string>> = {};
  async list(playerId: string) { return this.dto(playerId); }
  async equip(playerId: string, inventoryItemId: string, slot: EquipmentSlot) {
    const item = this.items.get(inventoryItemId);
    if (!item || item.playerId !== playerId) throw new AppError("INVENTORY_ITEM_NOT_FOUND", "Not found.", 404);
    if (item.quantity <= 0) throw new AppError("INVENTORY_ITEM_UNAVAILABLE", "Unavailable.", 409);
    const compatible = (slot === "FRAME" && item.rewardType === "FRAME") || (slot === "AVATAR" && item.rewardType === "AVATAR") || (slot.startsWith("BADGE_") && item.rewardType === "BADGE");
    if (!compatible) throw new AppError("EQUIPMENT_SLOT_INCOMPATIBLE", "Wrong slot.", 409);
    if (Object.entries(this.equipment).some(([otherSlot, id]) => id === inventoryItemId && otherSlot !== slot)) throw new AppError("ITEM_ALREADY_EQUIPPED", "Already displayed.", 409);
    this.equipment[slot] = inventoryItemId; return this.dto(playerId);
  }
  async unequip(playerId: string, slot: EquipmentSlot) { delete this.equipment[slot]; return this.dto(playerId); }
  add(id: string, rewardType: RewardDefinitionType, playerId = "player-1", quantity = 1) { this.items.set(id, { inventoryItemId: id, rewardDefinitionId: `reward-${id}`, code: id.toUpperCase(), rewardType, name: id, description: "", imageUrl: null, rarity: null, quantity, firstAcquiredAt: "2026-09-12T00:00:00.000Z", equippedSlots: [], playerId }); }
  private dto(playerId: string): InventoryDto { return { items: [...this.items.values()].filter((item) => item.playerId === playerId).map((item) => ({ ...item, equippedSlots: equipmentSlots.filter((slot) => this.equipment[slot] === item.inventoryItemId) })), equipment: { ...this.equipment } }; }
}

describe("Inventory grants", () => {
  const grant = (overrides: Partial<Grant> = {}): Grant => ({ playerId: "player-1", rewardType: "FRAME", rewardDefinitionId: "reward-1", quantity: 1, idempotencyKey: "grant-1", ...overrides });

  it("stores a unique item once and rejects a distinct duplicate grant", () => {
    const repo = new GrantHarness();
    expect(repo.grant(grant())).toEqual({ quantity: 1, idempotent: false });
    expect(() => repo.grant(grant({ idempotencyKey: "grant-2" }))).toThrowError(expect.objectContaining({ code: "ITEM_ALREADY_OWNED" }));
  });

  it("keeps unique item grants at quantity one", () => {
    const repo = new GrantHarness();
    expect(repo.grant(grant()).quantity).toBe(1);
    expect(repo.inventory.get("player-1:reward-1")).toBe(1);
  });

  it("stacks Rename Cards", () => {
    for (const rewardType of stackableInventoryTypes) {
      const repo = new GrantHarness();
      repo.grant(grant({ rewardType, quantity: 2 }));
      expect(repo.grant(grant({ rewardType, quantity: 3, idempotencyKey: "grant-2" }))).toEqual({ quantity: 5, idempotent: false });
    }
  });

  it("replays the same player grant exactly once and scopes keys by player", () => {
    const repo = new GrantHarness();
    repo.grant(grant());
    expect(repo.grant(grant())).toEqual({ quantity: 1, idempotent: true });
    expect(repo.grant(grant({ playerId: "player-2" }))).toEqual({ quantity: 1, idempotent: false });
    expect(repo.grants).toHaveLength(2);
  });

  it("rejects an idempotency key reused with a different grant payload", () => {
    const repo = new GrantHarness();
    repo.grant(grant({ rewardType: "RENAME_CARD", quantity: 2 }));
    expect(() => repo.grant(grant({ rewardType: "RENAME_CARD", quantity: 3 }))).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }));
  });

  it.each(["XP", "SYNAPSE_POINTS", "COUPON"] as const)("rejects unsupported %s grants", (rewardType) => {
    expect(() => new GrantHarness().grant(grant({ rewardType }))).toThrowError(expect.objectContaining({ code: "INVENTORY_REWARD_UNSUPPORTED" }));
  });
});

describe("Inventory equipment", () => {
  it("defines unique, stackable, and unsupported reward semantics", () => { expect(uniqueInventoryTypes).toEqual(["FRAME", "BADGE", "AVATAR", "COSMETIC"]); expect(stackableInventoryTypes).toEqual(["RENAME_CARD"]); expect(isInventorySupported("COUPON")).toBe(false); expect(isInventorySupported("XP")).toBe(false); expect(isInventorySupported("SYNAPSE_POINTS")).toBe(false); });
  it("equips, replaces, and unequips an owned Frame", async () => { const repo = new InventoryHarness(); repo.add("frame-1", "FRAME"); repo.add("frame-2", "FRAME"); const service = new InventoryService(repo); await service.equip("player-1", "frame-1", "FRAME"); expect(repo.equipment.FRAME).toBe("frame-1"); await service.equip("player-1", "frame-2", "FRAME"); expect(repo.equipment.FRAME).toBe("frame-2"); await service.unequip("player-1", "FRAME"); expect(repo.equipment.FRAME).toBeUndefined(); });
  it("equips and replaces an owned Avatar", async () => { const repo = new InventoryHarness(); repo.add("avatar-1", "AVATAR"); repo.add("avatar-2", "AVATAR"); const service = new InventoryService(repo); await service.equip("player-1", "avatar-1", "AVATAR"); await service.equip("player-1", "avatar-2", "AVATAR"); expect(repo.equipment.AVATAR).toBe("avatar-2"); });
  it("displays three different badges and replaces a selected slot", async () => { const repo = new InventoryHarness(); for (let i = 1; i <= 4; i++) repo.add(`badge-${i}`, "BADGE"); const service = new InventoryService(repo); await service.equip("player-1", "badge-1", "BADGE_1"); await service.equip("player-1", "badge-2", "BADGE_2"); await service.equip("player-1", "badge-3", "BADGE_3"); await service.equip("player-1", "badge-4", "BADGE_2"); expect(repo.equipment).toMatchObject({ BADGE_1: "badge-1", BADGE_2: "badge-4", BADGE_3: "badge-3" }); });
  it("prevents one badge occupying multiple slots", async () => { const repo = new InventoryHarness(); repo.add("badge-1", "BADGE"); const service = new InventoryService(repo); await service.equip("player-1", "badge-1", "BADGE_1"); await expect(service.equip("player-1", "badge-1", "BADGE_2")).rejects.toMatchObject({ code: "ITEM_ALREADY_EQUIPPED" }); });
  it.each([["rename", "RENAME_CARD"], ["coupon", "COUPON"], ["frame", "FRAME"]] as const)("rejects incompatible %s equipment", async (id, type) => { const repo = new InventoryHarness(); repo.add(id, type); await expect(new InventoryService(repo).equip("player-1", id, "BADGE_1")).rejects.toMatchObject({ code: "EQUIPMENT_SLOT_INCOMPATIBLE" }); });
  it("rejects unowned, other-player, and zero-quantity items", async () => { const repo = new InventoryHarness(); repo.add("other", "FRAME", "player-2"); repo.add("zero", "FRAME", "player-1", 0); const service = new InventoryService(repo); await expect(service.equip("player-1", "missing", "FRAME")).rejects.toMatchObject({ code: "INVENTORY_ITEM_NOT_FOUND" }); await expect(service.equip("player-1", "other", "FRAME")).rejects.toMatchObject({ code: "INVENTORY_ITEM_NOT_FOUND" }); await expect(service.equip("player-1", "zero", "FRAME")).rejects.toMatchObject({ code: "INVENTORY_ITEM_UNAVAILABLE" }); });
});
