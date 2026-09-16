import { describe, expect, it } from "vitest";
import { AppError, insufficientPoints } from "../src/domain/errors.js";
import { RewardWheelService, selectWeightedSegment, validateTierSchedule, type RewardWheelRepository, type RewardWheelSpinInput, type RewardWheelSpinResult, type RewardWheelStatusDto, type WheelRandomInt } from "../src/domain/rewardWheel.js";
import type { RewardDefinitionType } from "../src/domain/rewardCatalog.js";

type Segment = { id: string; position: number; label: string; weight: number; rewardDefinitionId: string; rewardType: RewardDefinitionType; quantity: number; active: boolean };
type Tier = { rewardWheelSpinTierId: string; spinNumber: number; costSynapsePoints: number; active: boolean };
type Wheel = { id: string; code: string; name: string; active: boolean; cycleSeconds: number; startsAt: Date | null; endsAt: Date | null; tiers: Tier[]; segments: Segment[] };
type StoredSpin = RewardWheelSpinResult & { playerId: string; idempotencyKey: string; wheelId: string };

class WheelHarness implements RewardWheelRepository {
  wheel: Wheel | null = configuredWheel();
  wallets = new Map([["player-1", 2000]]);
  xp = new Map<string, number>();
  inventory = new Map<string, number>();
  spins: StoredSpin[] = [];
  debits: Array<{ spinId: string; amount: number }> = [];
  pointCredits: Array<{ spinId: string; amount: number }> = [];
  xpGrants: Array<{ spinId: string; amount: number }> = [];
  inventoryGrants: Array<{ spinId: string; rewardDefinitionId: string; quantity: number }> = [];
  events: Array<{ spinId: string; type: string; spinNumber: number }> = [];
  failRewardGrant = false;
  private sequence = Promise.resolve();

  async getStatus(playerId: string, at: Date): Promise<RewardWheelStatusDto> {
    const wheel = this.wheel;
    if (!wheel?.active) return { available: false, wheel: null };
    const tiers = validateTierSchedule(wheel.tiers.filter((tier) => tier.active));
    const cycle = this.activeCycle(playerId, wheel.id, at);
    const spinsUsed = cycle?.spinNumber ?? 0;
    const nextTier = tiers[spinsUsed] ?? null;
    const eligible = this.eligible(playerId, wheel);
    const windowReason = wheel.startsAt && at < wheel.startsAt ? "WHEEL_NOT_STARTED" : wheel.endsAt && at >= wheel.endsAt ? "WHEEL_ENDED" : null;
    const balance = this.wallets.get(playerId) ?? 0;
    const unavailableReason = windowReason ?? (!eligible.length ? "WHEEL_NO_ELIGIBLE_REWARDS" : !nextTier ? "WHEEL_DAILY_LIMIT_REACHED" : balance < nextTier.costSynapsePoints ? "INSUFFICIENT_POINTS" : null);
    return {
      available: unavailableReason === null || unavailableReason === "WHEEL_DAILY_LIMIT_REACHED" || unavailableReason === "INSUFFICIENT_POINTS",
      wheel: {
        code: wheel.code, name: wheel.name, cycleSeconds: wheel.cycleSeconds,
        cycleStartedAt: cycle?.cycleStartedAt ?? null, cycleEndsAt: cycle?.cycleEndsAt ?? null,
        spinsUsed, maxSpinsPerCycle: tiers.length, spinsRemaining: tiers.length - spinsUsed,
        nextSpinNumber: nextTier?.spinNumber ?? null, nextSpinCostSynapsePoints: nextTier?.costSynapsePoints ?? null,
        nextSpinIsFree: nextTier?.costSynapsePoints === 0, canAffordNextSpin: nextTier ? balance >= nextTier.costSynapsePoints : false,
        canSpin: unavailableReason === null, unavailableReason,
        segments: wheel.segments.filter((entry) => entry.active).map((entry) => ({ wheelSegmentIndex: entry.position, label: entry.label, rewardType: entry.rewardType, rewardValue: entry.quantity, imageUrl: null, rarity: null, displayMetadata: {} })),
      },
    };
  }

  spin(input: Required<RewardWheelSpinInput>, randomInt: WheelRandomInt): Promise<RewardWheelSpinResult> {
    const operation = this.sequence.then(() => this.spinAtomically(input, randomInt));
    this.sequence = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async spinAtomically(input: Required<RewardWheelSpinInput>, randomInt: WheelRandomInt): Promise<RewardWheelSpinResult> {
    const snapshot = { wallets: new Map(this.wallets), xp: new Map(this.xp), inventory: new Map(this.inventory), spins: [...this.spins], debits: [...this.debits], pointCredits: [...this.pointCredits], xpGrants: [...this.xpGrants], inventoryGrants: [...this.inventoryGrants], events: [...this.events] };
    try {
      const replay = this.spins.find((entry) => entry.playerId === input.playerId && entry.idempotencyKey === input.idempotencyKey);
      if (replay) return { ...replay, idempotent: true };
      const wheel = this.wheel;
      if (!wheel?.active || (wheel.startsAt && input.now < wheel.startsAt) || (wheel.endsAt && input.now >= wheel.endsAt)) throw new AppError("WHEEL_NOT_AVAILABLE", "Unavailable.", 409);
      const tiers = validateTierSchedule(wheel.tiers.filter((tier) => tier.active));
      const activeCycle = this.activeCycle(input.playerId, wheel.id, input.now);
      const spinNumber = (activeCycle?.spinNumber ?? 0) + 1;
      const tier = tiers[spinNumber - 1];
      if (!tier) throw new AppError("WHEEL_DAILY_LIMIT_REACHED", "Daily limit reached.", 409, { cycleEndsAt: activeCycle?.cycleEndsAt });
      const eligible = this.eligible(input.playerId, wheel);
      if (!eligible.length) throw new AppError("WHEEL_NO_ELIGIBLE_REWARDS", "No eligible rewards.", 409);
      const selected = selectWeightedSegment(eligible, randomInt);
      const balance = this.wallets.get(input.playerId) ?? 0;
      if (balance < tier.costSynapsePoints) throw insufficientPoints();
      const spinId = `spin-${this.spins.length + 1}`;
      const cycleStartedAt = activeCycle?.cycleStartedAt ?? input.now.toISOString();
      const cycleEndsAt = activeCycle?.cycleEndsAt ?? new Date(input.now.getTime() + wheel.cycleSeconds * 1000).toISOString();
      let resultingBalance = balance - tier.costSynapsePoints;
      if (tier.costSynapsePoints) { this.wallets.set(input.playerId, resultingBalance); this.debits.push({ spinId, amount: tier.costSynapsePoints }); }
      if (this.failRewardGrant) throw new Error("simulated reward grant failure");
      if (selected.rewardType === "SYNAPSE_POINTS") { resultingBalance += selected.quantity; this.wallets.set(input.playerId, resultingBalance); this.pointCredits.push({ spinId, amount: selected.quantity }); }
      else if (selected.rewardType === "XP") { this.xp.set(input.playerId, (this.xp.get(input.playerId) ?? 0) + selected.quantity); this.xpGrants.push({ spinId, amount: selected.quantity }); }
      else { const key = `${input.playerId}:${selected.rewardDefinitionId}`; const unique = isUnique(selected.rewardType); this.inventory.set(key, unique ? 1 : (this.inventory.get(key) ?? 0) + selected.quantity); this.inventoryGrants.push({ spinId, rewardDefinitionId: selected.rewardDefinitionId, quantity: selected.quantity }); }
      const result: StoredSpin = { spinId, rewardId: selected.rewardDefinitionId, rewardDefinitionId: selected.rewardDefinitionId, rewardType: selected.rewardType, rewardLabel: selected.label, rewardValue: selected.quantity, resultingBalance, wheelSegmentIndex: selected.position, spunAt: input.now.toISOString(), spinNumber, chargedSynapsePoints: tier.costSynapsePoints, cycleStartedAt, cycleEndsAt, idempotent: false, playerId: input.playerId, idempotencyKey: input.idempotencyKey, wheelId: wheel.id };
      this.spins.push(result);
      this.events.push({ spinId, type: "reward_wheel.spun", spinNumber });
      return result;
    } catch (error) {
      this.wallets = snapshot.wallets; this.xp = snapshot.xp; this.inventory = snapshot.inventory; this.spins = snapshot.spins; this.debits = snapshot.debits; this.pointCredits = snapshot.pointCredits; this.xpGrants = snapshot.xpGrants; this.inventoryGrants = snapshot.inventoryGrants; this.events = snapshot.events;
      throw error;
    }
  }

  private activeCycle(playerId: string, wheelId: string, at: Date) {
    const latest = [...this.spins].reverse().find((entry) => entry.playerId === playerId && entry.wheelId === wheelId && entry.cycleEndsAt);
    return latest?.cycleEndsAt && at < new Date(latest.cycleEndsAt) ? latest : undefined;
  }

  private eligible(playerId: string, wheel: Wheel) { return wheel.segments.filter((entry) => entry.active && (!isUnique(entry.rewardType) || !(this.inventory.get(`${playerId}:${entry.rewardDefinitionId}`) ?? 0))); }
}

function isUnique(type: RewardDefinitionType) { return ["FRAME", "BADGE", "AVATAR", "COSMETIC"].includes(type); }
function segment(overrides: Partial<Segment> = {}): Segment { return { id: "segment-1", position: 0, label: "100 SP", weight: 10, rewardDefinitionId: "reward-points", rewardType: "SYNAPSE_POINTS", quantity: 100, active: true, ...overrides }; }
function tiers(costs = [0, 300, 450, 700]): Tier[] { return costs.map((costSynapsePoints, index) => ({ rewardWheelSpinTierId: `tier-${index + 1}`, spinNumber: index + 1, costSynapsePoints, active: true })); }
function configuredWheel(overrides: Partial<Wheel> = {}): Wheel { return { id: "wheel-1", code: "DAILY", name: "Daily Wheel", active: true, cycleSeconds: 86400, startsAt: null, endsAt: null, tiers: tiers(), segments: [segment()], ...overrides }; }
const now = new Date("2026-09-16T12:00:00.000Z");
function input(overrides: Partial<RewardWheelSpinInput> = {}): RewardWheelSpinInput { return { playerId: "player-1", idempotencyKey: "spin-key-1", now, ...overrides }; }
function setup(randomInt: WheelRandomInt = () => 0) { const repo = new WheelHarness(); return { repo, service: new RewardWheelService(repo, randomInt) }; }
async function spinAt(service: RewardWheelService, spinNumber: number, at = now) { return service.spin(input({ idempotencyKey: `spin-key-${spinNumber}`, now: at })); }

describe("Reward Wheel selection and configuration", () => {
  it("uses deterministic inclusive/exclusive weighted boundaries", () => {
    const choices = [{ id: "a", weight: 2 }, { id: "b", weight: 3 }, { id: "c", weight: 1 }];
    expect([0, 1, 2, 4, 5].map((roll) => selectWeightedSegment(choices, () => roll).id)).toEqual(["a", "a", "b", "b", "c"]);
  });
  it("rejects invalid RNG output without exposing selection internals", () => expect(() => selectWeightedSegment([{ weight: 1 }], () => 1)).toThrowError(expect.objectContaining({ code: "WHEEL_RNG_FAILED" })));
  it("represents the intended 0, 300, 450, 700 schedule", () => expect(validateTierSchedule(tiers()).map((tier) => tier.costSynapsePoints)).toEqual([0, 300, 450, 700]));
  it.each([["missing", []], ["non-free first tier", tiers([1, 2, 3, 4])], ["non-contiguous", [...tiers()].filter((tier) => tier.spinNumber !== 2)]] as const)("rejects an invalid %s tier schedule", (_label, configured) => expect(() => validateTierSchedule([...configured])).toThrowError(expect.objectContaining({ code: "WHEEL_CONFIGURATION_INVALID" })));
});

describe("backend-authoritative Reward Wheel cycle", () => {
  it("starts without an active cycle and offers a free spin", async () => { const { service } = setup(); expect((await service.getStatus("player-1", now)).wheel).toMatchObject({ cycleStartedAt: null, cycleEndsAt: null, spinsUsed: 0, spinsRemaining: 4, nextSpinNumber: 1, nextSpinCostSynapsePoints: 0, nextSpinIsFree: true, canSpin: true }); });
  it("charges zero and creates no point debit for the first spin", async () => { const { repo, service } = setup(); const result = await spinAt(service, 1); expect(result).toMatchObject({ spinNumber: 1, chargedSynapsePoints: 0, resultingBalance: 2100 }); expect(repo.debits).toHaveLength(0); });
  it("uses escalating authoritative costs for spins two through four", async () => { const { repo, service } = setup(); const results = []; for (let number = 1; number <= 4; number += 1) results.push(await spinAt(service, number)); expect(results.map((result) => result.chargedSynapsePoints)).toEqual([0, 300, 450, 700]); expect(repo.debits.map((debit) => debit.amount)).toEqual([300, 450, 700]); });
  it("retains the free spin's rolling 24-hour boundaries for paid spins", async () => { const { service } = setup(); const first = await spinAt(service, 1); const second = await spinAt(service, 2, new Date(now.getTime() + 3600000)); expect(first.cycleStartedAt).toBe(now.toISOString()); expect(first.cycleEndsAt).toBe(new Date(now.getTime() + 86400000).toISOString()); expect(second).toMatchObject({ cycleStartedAt: first.cycleStartedAt, cycleEndsAt: first.cycleEndsAt }); });
  it("rejects a fifth spin and cannot bypass the limit with another key", async () => { const { repo, service } = setup(); for (let number = 1; number <= 4; number += 1) await spinAt(service, number); await expect(spinAt(service, 5)).rejects.toMatchObject({ code: "WHEEL_DAILY_LIMIT_REACHED" }); await expect(service.spin(input({ idempotencyKey: "different-fifth-key" }))).rejects.toMatchObject({ code: "WHEEL_DAILY_LIMIT_REACHED" }); expect(repo.spins).toHaveLength(4); });
  it("offers a new free spin after cycle expiry even with unused paid spins", async () => { const { repo, service } = setup(); const first = await spinAt(service, 1); const nextCycleAt = new Date(new Date(first.cycleEndsAt!).getTime()); expect((await service.getStatus("player-1", nextCycleAt)).wheel).toMatchObject({ spinsUsed: 0, nextSpinNumber: 1, nextSpinCostSynapsePoints: 0, canSpin: true }); const next = await service.spin(input({ idempotencyKey: "next-cycle", now: nextCycleAt })); expect(next).toMatchObject({ spinNumber: 1, chargedSynapsePoints: 0 }); expect(next.cycleStartedAt).toBe(nextCycleAt.toISOString()); expect(repo.debits).toHaveLength(0); });
  it.each([[2, 300], [3, 450], [4, 700]] as const)("rejects insufficient SP for paid tier %i", async (targetSpin, cost) => { const { repo, service } = setup(); repo.wheel = configuredWheel({ tiers: tiers([0, 3, 4, 7]) }); for (let number = 1; number < targetSpin; number += 1) await spinAt(service, number); repo.wallets.set("player-1", cost === 300 ? 2 : cost === 450 ? 3 : 6); await expect(spinAt(service, targetSpin)).rejects.toMatchObject({ code: "INSUFFICIENT_POINTS" }); });
  it("reports the authoritative next tier and wallet affordability", async () => { const { repo, service } = setup(); await spinAt(service, 1); repo.wallets.set("player-1", 299); expect((await service.getStatus("player-1", now)).wheel).toMatchObject({ spinsUsed: 1, nextSpinNumber: 2, nextSpinCostSynapsePoints: 300, nextSpinIsFree: false, canAffordNextSpin: false, canSpin: false, unavailableReason: "INSUFFICIENT_POINTS" }); });
  it("reports the daily limit with authoritative cycle end", async () => { const { service } = setup(); for (let number = 1; number <= 4; number += 1) await spinAt(service, number); const status = await service.getStatus("player-1", now); expect(status.wheel).toMatchObject({ spinsUsed: 4, spinsRemaining: 0, nextSpinNumber: null, nextSpinCostSynapsePoints: null, canSpin: false, unavailableReason: "WHEEL_DAILY_LIMIT_REACHED" }); expect(status.wheel?.cycleEndsAt).toBe(new Date(now.getTime() + 86400000).toISOString()); });
  it("replays free and paid spins exactly without duplicate writes", async () => { const { repo, service } = setup(); const free = await spinAt(service, 1); const paid = await spinAt(service, 2); expect(await spinAt(service, 1)).toEqual({ ...free, idempotent: true }); expect(await spinAt(service, 2)).toEqual({ ...paid, idempotent: true }); expect(repo.spins).toHaveLength(2); expect(repo.debits).toHaveLength(1); expect(repo.events).toHaveLength(2); });
  it("replays after cycle expiry and tier configuration changes", async () => { const { repo, service } = setup(); const first = await spinAt(service, 1); repo.wheel = configuredWheel({ tiers: tiers([0, 1, 2, 3]) }); const replay = await service.spin(input({ now: new Date(now.getTime() + 90000000) })); expect(replay).toEqual({ ...first, idempotent: true }); expect(repo.spins).toHaveLength(1); });
  it("serializes concurrent first spins so only one is free", async () => { const { repo, service } = setup(); repo.wheel = configuredWheel({ tiers: tiers([0, 5, 6, 7]) }); const results = await Promise.all([service.spin(input()), service.spin(input({ idempotencyKey: "concurrent-2" }))]); expect(results.map((result) => result.spinNumber)).toEqual([1, 2]); expect(results.map((result) => result.chargedSynapsePoints)).toEqual([0, 5]); expect(repo.debits).toHaveLength(1); });
  it("serializes concurrent final-tier requests so no fifth spin commits", async () => { const { repo, service } = setup(); repo.wheel = configuredWheel({ tiers: tiers([0, 1, 1, 1]) }); for (let number = 1; number <= 3; number += 1) await spinAt(service, number); const results = await Promise.allSettled([spinAt(service, 4), service.spin(input({ idempotencyKey: "concurrent-fifth" }))]); expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1); expect(repo.spins).toHaveLength(4); });
  it("returns the final balance after tier debit and SP reward", async () => { const { service } = setup(); await spinAt(service, 1); const result = await spinAt(service, 2); expect(result.resultingBalance).toBe(1900); });
  it("grants XP and Inventory rewards through existing paths", async () => { const xp = setup(); xp.repo.wheel = configuredWheel({ segments: [segment({ rewardType: "XP", rewardDefinitionId: "reward-xp", quantity: 250 })] }); await spinAt(xp.service, 1); expect(xp.repo.xp.get("player-1")).toBe(250); const inventory = setup(); inventory.repo.wheel = configuredWheel({ segments: [segment({ rewardType: "COUPON", rewardDefinitionId: "coupon", quantity: 2 })] }); await spinAt(inventory.service, 1); expect(inventory.repo.inventory.get("player-1:coupon")).toBe(2); });
  it("excludes owned unique rewards and keeps weighted selection valid", async () => { const { repo, service } = setup(); repo.wheel = configuredWheel({ segments: [segment({ rewardType: "FRAME", rewardDefinitionId: "owned", weight: 100 }), segment({ id: "segment-2", position: 7, rewardDefinitionId: "reward-xp", rewardType: "XP", quantity: 50, weight: 1 })] }); repo.inventory.set("player-1:owned", 1); expect(await spinAt(service, 1)).toMatchObject({ rewardType: "XP", wheelSegmentIndex: 7 }); });
  it("rolls back cost, reward, spin, and event atomically", async () => { const { repo, service } = setup(); await spinAt(service, 1); repo.failRewardGrant = true; const balance = repo.wallets.get("player-1"); await expect(spinAt(service, 2)).rejects.toThrow("simulated reward grant failure"); expect(repo.wallets.get("player-1")).toBe(balance); expect(repo.spins).toHaveLength(1); expect(repo.debits).toHaveLength(0); expect(repo.events).toHaveLength(1); });
  it("does not expose weights, probabilities, or RNG internals", async () => { const { service } = setup(); const serialized = JSON.stringify(await service.getStatus("player-1", now)); expect(serialized).not.toContain("weight"); expect(serialized).not.toContain("probab"); expect(serialized).not.toContain("roll"); });
});
