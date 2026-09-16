import { describe, expect, it } from "vitest";
import { AppError } from "../src/domain/errors.js";
import { normalizeDisplayName, PlayerIdentityActionService, type PlayerIdentityActionRepository, type RenameDisplayNameInput, type RenameDisplayNameResult } from "../src/domain/playerIdentityActions.js";

type Item = { inventoryItemId: string; playerId: string; rewardDefinitionId: string; rewardType: string; quantity: number };
type Player = { playerId: string; userId: string; publicPlayerId: string; displayName: string };
type Consumption = RenameDisplayNameResult & { playerId: string; idempotencyKey: string; requestedDisplayName: string };

class RenameHarness implements PlayerIdentityActionRepository {
  players = new Map<string, Player>();
  items = new Map<string, Item>();
  consumptions: Consumption[] = [];
  events: string[] = [];
  failAt: "name" | "consumption" | "event" | null = null;
  private sequence = Promise.resolve();

  renameDisplayName(input: RenameDisplayNameInput & { displayName: string }): Promise<RenameDisplayNameResult> {
    const operation = this.sequence.then(() => this.renameAtomically(input));
    this.sequence = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async renameAtomically(input: RenameDisplayNameInput & { displayName: string }) {
    const snapshot = { players: structuredClone(this.players), items: structuredClone(this.items), consumptions: structuredClone(this.consumptions), events: [...this.events] };
    try {
      const replay = this.consumptions.find((item) => item.playerId === input.playerId && item.idempotencyKey === input.idempotencyKey);
      if (replay) {
        if (replay.inventoryItemId !== input.inventoryItemId || replay.requestedDisplayName !== input.displayName) throw new AppError("IDEMPOTENCY_CONFLICT", "Conflict.", 409);
        return { ...replay, idempotent: true };
      }
      const player = this.players.get(input.playerId);
      if (!player) throw new AppError("PLAYER_NOT_FOUND", "Missing.", 404);
      if (player.displayName === input.displayName) throw new AppError("DISPLAY_NAME_UNCHANGED", "Unchanged.", 409);
      const item = this.items.get(input.inventoryItemId);
      if (!item || item.playerId !== input.playerId || item.quantity <= 0) throw new AppError("RENAME_CARD_NOT_AVAILABLE", "Unavailable.", 409);
      if (item.rewardType !== "RENAME_CARD") throw new AppError("RENAME_CARD_REQUIRED", "Wrong item.", 409);
      item.quantity -= 1;
      if (this.failAt === "name") throw new Error("name update failure");
      const previousDisplayName = player.displayName; player.displayName = input.displayName;
      if (this.failAt === "consumption") throw new Error("consumption failure");
      const result: Consumption = { inventoryConsumptionId: `consumption-${this.consumptions.length + 1}`, playerId: input.playerId, publicPlayerId: player.publicPlayerId, previousDisplayName, displayName: input.displayName, requestedDisplayName: input.displayName, inventoryItemId: input.inventoryItemId, remainingQuantity: item.quantity, consumedAt: "2026-09-16T00:00:00.000Z", idempotent: false, idempotencyKey: input.idempotencyKey, inventory: { items: [], equipment: {} } };
      this.consumptions.push(result);
      this.events.push("inventory.item.consumed");
      if (this.failAt === "event") throw new Error("event failure");
      this.events.push("player.display_name.changed");
      return result;
    } catch (error) {
      this.players = snapshot.players; this.items = snapshot.items; this.consumptions = snapshot.consumptions; this.events = snapshot.events;
      throw error;
    }
  }
}

function setup(quantity = 1, rewardType = "RENAME_CARD", itemPlayerId = "player-1") {
  const repo = new RenameHarness();
  repo.players.set("player-1", { playerId: "player-1", userId: "user-1", publicPlayerId: "CZ-8F42KD", displayName: "Smokey_OP" });
  repo.items.set("item-1", { inventoryItemId: "item-1", playerId: itemPlayerId, rewardDefinitionId: "reward-1", rewardType, quantity });
  return { repo, service: new PlayerIdentityActionService(repo) };
}
const input = (overrides: Partial<RenameDisplayNameInput> = {}): RenameDisplayNameInput => ({ playerId: "player-1", inventoryItemId: "item-1", displayName: "New Knight", idempotencyKey: "rename-1", ...overrides });

describe("display name validation", () => {
  it("trims edges while preserving legitimate Unicode and internal characters", () => expect(normalizeDisplayName("  王 小明  ")).toBe("王 小明"));
  it.each(["", "   ", "A"])("rejects too-short name %j", (name) => expect(() => normalizeDisplayName(name)).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" })));
  it("counts Unicode code points and rejects names over 32", () => expect(() => normalizeDisplayName("😀".repeat(33))).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" })));
  it.each(["Line\nBreak", "\nLeading", "Tab\tName", "Zero\u200BWidth"])("rejects control or format characters", (name) => expect(() => normalizeDisplayName(name)).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" })));
});

describe("Rename Card consumption", () => {
  it.each([[1, 0], [2, 1]])("renames and consumes exactly one card from quantity %i", async (quantity, remaining) => {
    const { repo, service } = setup(quantity); const before = { ...repo.players.get("player-1")! };
    const result = await service.renameDisplayName(input()); const after = repo.players.get("player-1")!;
    expect(result).toMatchObject({ previousDisplayName: "Smokey_OP", displayName: "New Knight", publicPlayerId: before.publicPlayerId, remainingQuantity: remaining, idempotent: false });
    expect(repo.items.get("item-1")?.quantity).toBe(remaining); expect(after.playerId).toBe(before.playerId); expect(after.userId).toBe(before.userId); expect(after.publicPlayerId).toBe(before.publicPlayerId);
    expect(repo.consumptions).toHaveLength(1); expect(repo.events).toEqual(["inventory.item.consumed", "player.display_name.changed"]);
  });

  it("replays the immutable original result without consuming or emitting again", async () => {
    const { repo, service } = setup(2); const first = await service.renameDisplayName(input()); const replay = await service.renameDisplayName(input());
    expect(replay).toMatchObject({ inventoryConsumptionId: first.inventoryConsumptionId, consumedAt: first.consumedAt, previousDisplayName: first.previousDisplayName, displayName: first.displayName, remainingQuantity: 1, idempotent: true });
    expect(repo.items.get("item-1")?.quantity).toBe(1); expect(repo.consumptions).toHaveLength(1); expect(repo.events).toHaveLength(2);
  });

  it.each([[{ displayName: "Another Name" }], [{ inventoryItemId: "item-2" }]])("rejects conflicting key reuse", async (change) => {
    const { service } = setup(2); await service.renameDisplayName(input()); await expect(service.renameDisplayName(input(change))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", statusCode: 409 });
  });

  it("rejects the current name without consuming", async () => { const { repo, service } = setup(); await expect(service.renameDisplayName(input({ displayName: " Smokey_OP " }))).rejects.toMatchObject({ code: "DISPLAY_NAME_UNCHANGED" }); expect(repo.items.get("item-1")?.quantity).toBe(1); });
  it("rejects zero quantity and another player's item safely", async () => { for (const [quantity, rewardType, owner] of [[0, "RENAME_CARD", "player-1"], [1, "RENAME_CARD", "player-2"]] as const) { const { repo, service } = setup(quantity, rewardType, owner); await expect(service.renameDisplayName(input())).rejects.toMatchObject({ code: "RENAME_CARD_NOT_AVAILABLE" }); expect(repo.consumptions).toHaveLength(0); } });
  it.each(["FRAME", "BADGE", "AVATAR", "COUPON", "COSMETIC", "XP", "SYNAPSE_POINTS"])("rejects wrong reward type %s", async (rewardType) => { const { repo, service } = setup(1, rewardType); await expect(service.renameDisplayName(input())).rejects.toMatchObject({ code: "RENAME_CARD_REQUIRED" }); expect(repo.items.get("item-1")?.quantity).toBe(1); });

  it("serializes two final-card attempts so only one succeeds", async () => {
    const { repo, service } = setup(); const results = await Promise.allSettled([service.renameDisplayName(input()), service.renameDisplayName(input({ displayName: "Other Name", idempotencyKey: "rename-2" }))]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1); expect(repo.items.get("item-1")?.quantity).toBe(0); expect(repo.consumptions).toHaveLength(1);
  });

  it.each(["name", "consumption", "event"] as const)("rolls back the whole operation after %s failure", async (failAt) => {
    const { repo, service } = setup(); repo.failAt = failAt; await expect(service.renameDisplayName(input())).rejects.toThrow();
    expect(repo.players.get("player-1")?.displayName).toBe("Smokey_OP"); expect(repo.items.get("item-1")?.quantity).toBe(1); expect(repo.consumptions).toHaveLength(0); expect(repo.events).toHaveLength(0);
  });
});
