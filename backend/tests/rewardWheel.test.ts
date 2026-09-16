import { describe, expect, it } from "vitest";
import { AppError, insufficientPoints } from "../src/domain/errors.js";
import { RewardWheelService, selectWeightedSegment, type RewardWheelRepository, type RewardWheelSpinInput, type RewardWheelSpinResult, type RewardWheelStatusDto, type WheelRandomInt } from "../src/domain/rewardWheel.js";
import type { RewardDefinitionType } from "../src/domain/rewardCatalog.js";

type Segment = { id: string; position: number; label: string; weight: number; rewardDefinitionId: string; rewardType: RewardDefinitionType; quantity: number; active: boolean };
type Wheel = { id: string; code: string; name: string; active: boolean; cost: number; cooldownSeconds: number; startsAt: Date | null; endsAt: Date | null; segments: Segment[] };
type StoredSpin = RewardWheelSpinResult & { playerId: string; idempotencyKey: string; wheelId: string };

class WheelHarness implements RewardWheelRepository {
  wheel: Wheel | null = configuredWheel();
  wallets = new Map([["player-1", 1000]]);
  xp = new Map<string, number>();
  inventory = new Map<string, number>();
  spins: StoredSpin[] = [];
  debits: Array<{ spinId: string; amount: number }> = [];
  pointCredits: Array<{ spinId: string; amount: number }> = [];
  xpGrants: Array<{ spinId: string; amount: number }> = [];
  inventoryGrants: Array<{ spinId: string; rewardDefinitionId: string; quantity: number }> = [];
  events: Array<{ spinId: string; type: string }> = [];
  failRewardGrant = false;
  private sequence = Promise.resolve();

  async getStatus(playerId: string, now: Date): Promise<RewardWheelStatusDto> {
    const wheel = this.wheel;
    if (!wheel?.active) return { available: false, wheel: null };
    const eligible = this.eligible(playerId, wheel);
    const latest = this.latest(playerId, wheel.id);
    const nextSpinAt = latest && wheel.cooldownSeconds ? new Date(new Date(latest.spunAt).getTime() + wheel.cooldownSeconds * 1000) : null;
    const windowReason = wheel.startsAt && now < wheel.startsAt ? "WHEEL_NOT_STARTED" : wheel.endsAt && now >= wheel.endsAt ? "WHEEL_ENDED" : null;
    const unavailableReason = windowReason ?? (!eligible.length ? "WHEEL_NO_ELIGIBLE_REWARDS" : nextSpinAt && now < nextSpinAt ? "WHEEL_COOLDOWN_ACTIVE" : null);
    return { available: unavailableReason === null || unavailableReason === "WHEEL_COOLDOWN_ACTIVE", wheel: { code: wheel.code, name: wheel.name, costSynapsePoints: wheel.cost, cooldownSeconds: wheel.cooldownSeconds, nextSpinAt: nextSpinAt && now < nextSpinAt ? nextSpinAt.toISOString() : wheel.startsAt && now < wheel.startsAt ? wheel.startsAt.toISOString() : null, canSpin: unavailableReason === null, unavailableReason, segments: wheel.segments.filter((segment) => segment.active).map((segment) => ({ wheelSegmentIndex: segment.position, label: segment.label, rewardType: segment.rewardType, rewardValue: segment.quantity, imageUrl: null, rarity: null, displayMetadata: {} })) } };
  }

  spin(input: Required<RewardWheelSpinInput>, randomInt: WheelRandomInt): Promise<RewardWheelSpinResult> {
    const operation = this.sequence.then(() => this.spinAtomically(input, randomInt));
    this.sequence = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async spinAtomically(input: Required<RewardWheelSpinInput>, randomInt: WheelRandomInt): Promise<RewardWheelSpinResult> {
    const snapshot = { wallets: new Map(this.wallets), xp: new Map(this.xp), inventory: new Map(this.inventory), spins: [...this.spins], debits: [...this.debits], pointCredits: [...this.pointCredits], xpGrants: [...this.xpGrants], inventoryGrants: [...this.inventoryGrants], events: [...this.events] };
    try {
      const replay = this.spins.find((spin) => spin.playerId === input.playerId && spin.idempotencyKey === input.idempotencyKey);
      if (replay) return { ...replay, idempotent: true };
      const wheel = this.wheel;
      if (!wheel?.active || (wheel.startsAt && input.now < wheel.startsAt) || (wheel.endsAt && input.now >= wheel.endsAt)) throw new AppError("WHEEL_NOT_AVAILABLE", "Unavailable.", 409);
      const latest = this.latest(input.playerId, wheel.id);
      if (latest && input.now.getTime() < new Date(latest.spunAt).getTime() + wheel.cooldownSeconds * 1000) throw new AppError("WHEEL_COOLDOWN_ACTIVE", "Cooling down.", 409, { nextSpinAt: latest.nextSpinAt });
      const eligible = this.eligible(input.playerId, wheel);
      if (!eligible.length) throw new AppError("WHEEL_NO_ELIGIBLE_REWARDS", "No eligible rewards.", 409);
      const selected = selectWeightedSegment(eligible, randomInt);
      const balance = this.wallets.get(input.playerId) ?? 0;
      if (balance < wheel.cost) throw insufficientPoints();
      const spinId = `spin-${this.spins.length + 1}`;
      let resultingBalance = balance - wheel.cost;
      if (wheel.cost) { this.wallets.set(input.playerId, resultingBalance); this.debits.push({ spinId, amount: wheel.cost }); }
      if (this.failRewardGrant) throw new Error("simulated reward grant failure");
      if (selected.rewardType === "SYNAPSE_POINTS") { resultingBalance += selected.quantity; this.wallets.set(input.playerId, resultingBalance); this.pointCredits.push({ spinId, amount: selected.quantity }); }
      else if (selected.rewardType === "XP") { this.xp.set(input.playerId, (this.xp.get(input.playerId) ?? 0) + selected.quantity); this.xpGrants.push({ spinId, amount: selected.quantity }); }
      else { const key = `${input.playerId}:${selected.rewardDefinitionId}`; const unique = ["FRAME", "BADGE", "AVATAR", "COSMETIC"].includes(selected.rewardType); this.inventory.set(key, unique ? 1 : (this.inventory.get(key) ?? 0) + selected.quantity); this.inventoryGrants.push({ spinId, rewardDefinitionId: selected.rewardDefinitionId, quantity: selected.quantity }); }
      const result: StoredSpin = { spinId, rewardId: selected.rewardDefinitionId, rewardDefinitionId: selected.rewardDefinitionId, rewardType: selected.rewardType, rewardLabel: selected.label, rewardValue: selected.quantity, resultingBalance, wheelSegmentIndex: selected.position, spunAt: input.now.toISOString(), nextSpinAt: wheel.cooldownSeconds ? new Date(input.now.getTime() + wheel.cooldownSeconds * 1000).toISOString() : null, idempotent: false, playerId: input.playerId, idempotencyKey: input.idempotencyKey, wheelId: wheel.id };
      this.spins.push(result); this.events.push({ spinId, type: "reward_wheel.spun" });
      return result;
    } catch (error) {
      this.wallets = snapshot.wallets; this.xp = snapshot.xp; this.inventory = snapshot.inventory; this.spins = snapshot.spins; this.debits = snapshot.debits; this.pointCredits = snapshot.pointCredits; this.xpGrants = snapshot.xpGrants; this.inventoryGrants = snapshot.inventoryGrants; this.events = snapshot.events;
      throw error;
    }
  }

  private latest(playerId: string, wheelId: string) { return [...this.spins].reverse().find((spin) => spin.playerId === playerId && spin.wheelId === wheelId); }
  private eligible(playerId: string, wheel: Wheel) { return wheel.segments.filter((segment) => segment.active && (!isUnique(segment.rewardType) || !(this.inventory.get(`${playerId}:${segment.rewardDefinitionId}`) ?? 0))); }
}

function isUnique(type: RewardDefinitionType) { return ["FRAME", "BADGE", "AVATAR", "COSMETIC"].includes(type); }
function segment(overrides: Partial<Segment> = {}): Segment { return { id: "segment-1", position: 0, label: "100 SP", weight: 10, rewardDefinitionId: "reward-points", rewardType: "SYNAPSE_POINTS", quantity: 100, active: true, ...overrides }; }
function configuredWheel(overrides: Partial<Wheel> = {}): Wheel { return { id: "wheel-1", code: "DAILY", name: "Daily Wheel", active: true, cost: 50, cooldownSeconds: 3600, startsAt: null, endsAt: null, segments: [segment()], ...overrides }; }
const now = new Date("2026-09-16T12:00:00.000Z");
function input(overrides: Partial<RewardWheelSpinInput> = {}): RewardWheelSpinInput { return { playerId: "player-1", idempotencyKey: "spin-key-1", now, ...overrides }; }
function setup(randomInt: WheelRandomInt = () => 0) { const repo = new WheelHarness(); return { repo, service: new RewardWheelService(repo, randomInt) }; }

describe("Reward Wheel selection", () => {
  it("uses deterministic inclusive/exclusive weighted boundaries", () => {
    const choices = [{ id: "a", weight: 2 }, { id: "b", weight: 3 }, { id: "c", weight: 1 }];
    expect([0, 1, 2, 4, 5].map((roll) => selectWeightedSegment(choices, () => roll).id)).toEqual(["a", "a", "b", "b", "c"]);
  });
  it("rejects invalid RNG output without exposing selection internals", () => expect(() => selectWeightedSegment([{ weight: 1 }], () => 1)).toThrowError(expect.objectContaining({ code: "WHEEL_RNG_FAILED" })));
});

describe("backend-authoritative Reward Wheel", () => {
  it("returns a safe unavailable state and rejects spins when no wheel is active", async () => { const { repo, service } = setup(); repo.wheel = null; expect(await service.getStatus("player-1", now)).toEqual({ available: false, wheel: null }); await expect(service.spin(input())).rejects.toMatchObject({ code: "WHEEL_NOT_AVAILABLE" }); });
  it.each([["future", { startsAt: new Date("2026-09-17T00:00:00Z") }], ["ended", { endsAt: now }]] as const)("enforces the %s active window", async (_label, overrides) => { const { repo, service } = setup(); repo.wheel = configuredWheel(overrides); await expect(service.spin(input())).rejects.toMatchObject({ code: "WHEEL_NOT_AVAILABLE" }); expect(repo.spins).toHaveLength(0); });
  it("handles a zero-cost wheel without fabricating a debit", async () => { const { repo, service } = setup(); repo.wheel = configuredWheel({ cost: 0 }); const result = await service.spin(input()); expect(result.resultingBalance).toBe(1100); expect(repo.debits).toHaveLength(0); });
  it("debits a paid wheel and returns the final balance after an SP reward", async () => { const { repo, service } = setup(); const result = await service.spin(input()); expect(result.resultingBalance).toBe(1050); expect(repo.debits).toEqual([{ spinId: result.spinId, amount: 50 }]); expect(repo.pointCredits).toEqual([{ spinId: result.spinId, amount: 100 }]); });
  it("rejects insufficient SP without a spin or reward", async () => { const { repo, service } = setup(); repo.wallets.set("player-1", 49); await expect(service.spin(input())).rejects.toMatchObject({ code: "INSUFFICIENT_POINTS" }); expect(repo.spins).toHaveLength(0); expect(repo.events).toHaveLength(0); });
  it("grants XP through the XP path while retaining the post-cost wallet balance", async () => { const { repo, service } = setup(); repo.wheel = configuredWheel({ segments: [segment({ rewardType: "XP", rewardDefinitionId: "reward-xp", quantity: 250, label: "250 XP" })] }); const result = await service.spin(input()); expect(result.resultingBalance).toBe(950); expect(repo.xp.get("player-1")).toBe(250); expect(repo.xpGrants).toHaveLength(1); });
  it.each(["RENAME_CARD", "COUPON"] as const)("stacks %s Inventory rewards", async (rewardType) => { const { repo, service } = setup(); repo.wheel = configuredWheel({ cooldownSeconds: 0, segments: [segment({ rewardType, rewardDefinitionId: `reward-${rewardType}`, quantity: 2 })] }); await service.spin(input()); await service.spin(input({ idempotencyKey: "spin-key-2" })); expect(repo.inventory.get(`player-1:reward-${rewardType}`)).toBe(4); });
  it.each(["FRAME", "BADGE", "AVATAR", "COSMETIC"] as const)("grants one unique %s item", async (rewardType) => { const { repo, service } = setup(); repo.wheel = configuredWheel({ segments: [segment({ rewardType, rewardDefinitionId: `reward-${rewardType}`, quantity: 1 })] }); await service.spin(input()); expect(repo.inventory.get(`player-1:reward-${rewardType}`)).toBe(1); });
  it("excludes an already-owned unique segment before weighted selection", async () => { const { repo, service } = setup(() => 0); repo.wheel = configuredWheel({ segments: [segment({ rewardType: "FRAME", rewardDefinitionId: "owned-frame", weight: 100 }), segment({ id: "segment-2", position: 7, rewardDefinitionId: "reward-xp", rewardType: "XP", quantity: 50, label: "50 XP", weight: 1 })] }); repo.inventory.set("player-1:owned-frame", 1); const result = await service.spin(input()); expect(result).toMatchObject({ rewardType: "XP", wheelSegmentIndex: 7 }); });
  it("returns no-eligible-rewards without wallet or spin writes", async () => { const { repo, service } = setup(); repo.wheel = configuredWheel({ segments: [segment({ rewardType: "FRAME", rewardDefinitionId: "owned-frame", quantity: 1 })] }); repo.inventory.set("player-1:owned-frame", 1); await expect(service.spin(input())).rejects.toMatchObject({ code: "WHEEL_NO_ELIGIBLE_REWARDS" }); expect(repo.wallets.get("player-1")).toBe(1000); expect(repo.spins).toHaveLength(0); });
  it("replays exactly after configuration changes with one debit, reward, spin, and semantic event", async () => { const { repo, service } = setup(); const first = await service.spin(input()); repo.wheel = null; const replay = await service.spin(input()); expect(replay).toMatchObject({ spinId: first.spinId, spunAt: first.spunAt, nextSpinAt: first.nextSpinAt, idempotent: true }); expect(repo.spins).toHaveLength(1); expect(repo.debits).toHaveLength(1); expect(repo.pointCredits).toHaveLength(1); expect(repo.events).toEqual([{ spinId: first.spinId, type: "reward_wheel.spun" }]); });
  it("returns replay before cooldown but rejects a new logical spin with nextSpinAt", async () => { const { service } = setup(); const first = await service.spin(input()); expect((await service.spin(input())).idempotent).toBe(true); await expect(service.spin(input({ idempotencyKey: "spin-key-2", now: new Date(now.getTime() + 1000) }))).rejects.toMatchObject({ code: "WHEEL_COOLDOWN_ACTIVE", details: { nextSpinAt: first.nextSpinAt } }); });
  it("serializes concurrent same-key requests to one committed spin", async () => { const { repo, service } = setup(); const [first, replay] = await Promise.all([service.spin(input()), service.spin(input())]); expect(first.spinId).toBe(replay.spinId); expect([first.idempotent, replay.idempotent]).toEqual([false, true]); expect(repo.spins).toHaveLength(1); });
  it("prevents different-key concurrent requests from bypassing cooldown", async () => { const { repo, service } = setup(); const results = await Promise.allSettled([service.spin(input()), service.spin(input({ idempotencyKey: "spin-key-2" }))]); expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1); expect(repo.spins).toHaveLength(1); });
  it("rolls back debit, reward, spin, and event when reward grant fails", async () => { const { repo, service } = setup(); repo.failRewardGrant = true; await expect(service.spin(input())).rejects.toThrow("simulated reward grant failure"); expect(repo.wallets.get("player-1")).toBe(1000); expect(repo.debits).toHaveLength(0); expect(repo.spins).toHaveLength(0); expect(repo.events).toHaveLength(0); });
  it("does not expose weights or RNG internals in the status DTO", async () => { const { service } = setup(); const status = await service.getStatus("player-1", now); const serialized = JSON.stringify(status); expect(serialized).not.toContain("weight"); expect(serialized).not.toContain("roll"); expect(status.wheel?.segments[0]).toMatchObject({ wheelSegmentIndex: 0, label: "100 SP" }); });
});
