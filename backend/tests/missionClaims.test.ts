import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../src/domain/errors.js";
import { GameStateService, temporaryDevelopmentProgressionLevels } from "../src/domain/gameState.js";
import { MissionClaimService, periodKeyFor, type MissionClaimInput, type MissionClaimRepository, type MissionClaimResult } from "../src/domain/missions.js";
import { FakeGameStateRepository } from "./fakes.js";

type Reward = { type: string; amount: number; active: boolean };
type Progress = { id: string; playerId: string; missionId: string; periodKey: string; status: "IN_PROGRESS" | "CLAIMABLE" | "CLAIMED"; claimedAt?: string };

class ClaimHarness implements MissionClaimRepository {
  missions = new Map<string, { active: boolean; startsAt: Date | null; endsAt: Date | null; periodType: "DAILY" | "WEEKLY" | "LIFETIME" | "FIXED" }>();
  progress = new Map<string, Progress>();
  rewards = new Map<string, Reward[]>();
  claims: Array<{ id: string; input: MissionClaimInput; periodKey: string; sp: number; xp: number; claimedAt: string }> = [];
  claimedEvents: string[] = [];
  failAfterRewards = false;
  private sequence = Promise.resolve();
  constructor(public gameRepo: FakeGameStateRepository) {}
  claim(input: MissionClaimInput): Promise<MissionClaimResult> {
    const operation = this.sequence.then(() => this.claimAtomically(input)); this.sequence = operation.then(() => undefined, () => undefined); return operation;
  }
  private async claimAtomically(input: MissionClaimInput) {
    const snapshot = this.snapshot();
    try {
      const replay = this.claims.find((claim) => claim.input.playerId === input.playerId && claim.input.idempotencyKey === input.idempotencyKey);
      if (replay) {
        if (replay.input.missionId !== input.missionId) throw new AppError("IDEMPOTENCY_CONFLICT", "Different claim.", 409);
        return this.result(replay, true);
      }
      const now = input.now ?? new Date("2026-09-09T12:00:00Z"); const mission = this.missions.get(input.missionId);
      if (!mission?.active || (mission.startsAt && now < mission.startsAt) || (mission.endsAt && now >= mission.endsAt)) throw new AppError("MISSION_NOT_AVAILABLE", "Unavailable.", 404);
      const periodKey = periodKeyFor(mission.periodType, now, input.missionId); const key = `${input.playerId}:${input.missionId}:${periodKey}`; const progress = this.progress.get(key);
      if (!progress || progress.status === "IN_PROGRESS") throw new AppError("MISSION_NOT_CLAIMABLE", "Not claimable.", 409);
      if (progress.status === "CLAIMED") throw new AppError("MISSION_ALREADY_CLAIMED", "Already claimed.", 409);
      let sp = 0; let xp = 0;
      for (const reward of (this.rewards.get(input.missionId) ?? []).filter((item) => item.active)) {
        if (reward.amount <= 0 || !["SYNAPSE_POINTS", "XP"].includes(reward.type)) throw new AppError("MISSION_REWARD_CONFIG_INVALID", "Invalid reward.", 500);
        if (reward.type === "SYNAPSE_POINTS") sp += reward.amount; else xp += reward.amount;
      }
      if (!sp && !xp) throw new AppError("MISSION_REWARD_CONFIG_INVALID", "No rewards.", 500);
      const claim = { id: `claim-${this.claims.length + 1}`, input, periodKey, sp, xp, claimedAt: now.toISOString() }; this.claims.push(claim);
      const game = new GameStateService(this.gameRepo); const metadata = { missionId: input.missionId, periodKey, missionClaimId: claim.id };
      if (sp) await game.creditPoints({ playerId: input.playerId, amount: sp, reason: "Mission reward", sourceType: "MISSION_REWARD", sourceId: claim.id, idempotencyKey: `mission.reward.sp:${input.playerId}:${input.missionId}:${periodKey}`, metadata });
      if (xp) await game.grantXp({ playerId: input.playerId, amount: xp, reason: "Mission reward", sourceType: "MISSION_REWARD", sourceId: claim.id, idempotencyKey: `mission.reward.xp:${input.playerId}:${input.missionId}:${periodKey}`, metadata });
      if (this.failAfterRewards) throw new Error("simulated event failure");
      progress.status = "CLAIMED"; progress.claimedAt = claim.claimedAt; this.claimedEvents.push(`mission.claimed:${input.playerId}:${input.missionId}:${periodKey}`);
      return this.result(claim, false);
    } catch (error) { this.restore(snapshot); throw error; }
  }
  private async result(claim: ClaimHarness["claims"][number], idempotent: boolean): Promise<MissionClaimResult> {
    const state = await new GameStateService(this.gameRepo).getPlayerGameState(claim.input.playerId);
    return { missionClaimId: claim.id, missionId: claim.input.missionId, periodKey: claim.periodKey, status: "CLAIMED", claimedAt: claim.claimedAt, idempotent, awarded: { synapsePoints: claim.sp, xp: claim.xp }, playerState: { synapsePoints: state.synapsePoints, xp: state.totalXp, progressionLevel: state.progressionLevel, rankName: state.rankName } };
  }
  private snapshot() { return { progress: structuredClone(this.progress), claims: structuredClone(this.claims), events: structuredClone(this.claimedEvents), states: structuredClone(this.gameRepo.states), wallets: structuredClone(this.gameRepo.wallets), xp: structuredClone(this.gameRepo.xpTransactions), points: structuredClone(this.gameRepo.pointTransactions), gameEvents: structuredClone(this.gameRepo.gameEvents) }; }
  private restore(s: ReturnType<ClaimHarness["snapshot"]>) { this.progress = s.progress; this.claims = s.claims; this.claimedEvents = s.events; this.gameRepo.states = s.states; this.gameRepo.wallets = s.wallets; this.gameRepo.xpTransactions = s.xp; this.gameRepo.pointTransactions = s.points; this.gameRepo.gameEvents = s.gameEvents; }
}

describe("mission claiming", () => {
  let repo: ClaimHarness; let service: MissionClaimService; const now = new Date("2026-09-09T12:00:00Z");
  const input = (overrides: Partial<MissionClaimInput> = {}): MissionClaimInput => ({ playerId: "player-1", missionId: "mission-1", idempotencyKey: "claim-1", now, ...overrides });
  beforeEach(async () => { const game = new FakeGameStateRepository(); await game.seedProgressionLevels(temporaryDevelopmentProgressionLevels); repo = new ClaimHarness(game); service = new MissionClaimService(repo); repo.missions.set("mission-1", { active: true, startsAt: null, endsAt: null, periodType: "DAILY" }); repo.progress.set("player-1:mission-1:2026-09-09", { id: "progress-1", playerId: "player-1", missionId: "mission-1", periodKey: "2026-09-09", status: "CLAIMABLE" }); });

  it.each([["missing", false], ["in progress", true]] as const)("rejects %s progress", async (_name, inProgress) => { if (inProgress) repo.progress.get("player-1:mission-1:2026-09-09")!.status = "IN_PROGRESS"; else repo.progress.clear(); await expect(service.claim(input())).rejects.toMatchObject({ code: "MISSION_NOT_CLAIMABLE" }); });
  it("rejects inactive and expired missions", async () => { repo.missions.get("mission-1")!.active = false; await expect(service.claim(input())).rejects.toMatchObject({ code: "MISSION_NOT_AVAILABLE" }); repo.missions.get("mission-1")!.active = true; repo.missions.get("mission-1")!.endsAt = now; await expect(service.claim(input())).rejects.toMatchObject({ code: "MISSION_NOT_AVAILABLE" }); });
  it.each([
    ["SP only", [{ type: "SYNAPSE_POINTS", amount: 250, active: true }], 250, 0],
    ["XP only", [{ type: "XP", amount: 500, active: true }], 0, 500],
    ["SP and XP", [{ type: "SYNAPSE_POINTS", amount: 250, active: true }, { type: "XP", amount: 500, active: true }], 250, 500],
    ["aggregated", [{ type: "SYNAPSE_POINTS", amount: 100, active: true }, { type: "SYNAPSE_POINTS", amount: 250, active: true }, { type: "XP", amount: 500, active: true }], 350, 500],
  ] as const)("claims %s rewards", async (_name, rewards, sp, xp) => { repo.rewards.set("mission-1", [...rewards]); const result = await service.claim(input()); expect(result.awarded).toEqual({ synapsePoints: sp, xp }); expect(result.playerState).toMatchObject({ synapsePoints: sp, xp }); expect(repo.progress.values().next().value).toMatchObject({ status: "CLAIMED", claimedAt: now.toISOString() }); });
  it.each([[[]], [[{ type: "BAD", amount: 1, active: true }]]])("rejects empty or invalid reward configuration", async (rewards) => { repo.rewards.set("mission-1", rewards); await expect(service.claim(input())).rejects.toMatchObject({ code: "MISSION_REWARD_CONFIG_INVALID" }); });
  it("replays the same key without duplicate claims, ledgers, or events", async () => { repo.rewards.set("mission-1", [{ type: "SYNAPSE_POINTS", amount: 250, active: true }, { type: "XP", amount: 8000, active: true }]); const first = await service.claim(input()); const replay = await service.claim(input()); expect(replay).toMatchObject({ missionClaimId: first.missionClaimId, idempotent: true }); expect(repo.claims).toHaveLength(1); expect(repo.gameRepo.pointTransactions).toHaveLength(1); expect(repo.gameRepo.xpTransactions).toHaveLength(1); expect(repo.claimedEvents).toHaveLength(1); expect(repo.gameRepo.gameEvents.filter((event) => event.eventType === "points.earned")).toHaveLength(1); expect(repo.gameRepo.gameEvents.filter((event) => event.eventType === "xp.earned")).toHaveLength(1); expect(repo.gameRepo.gameEvents.filter((event) => event.eventType === "progression.level_up")).toHaveLength(3); });
  it("conflicts when a key is reused for another mission", async () => { repo.rewards.set("mission-1", [{ type: "XP", amount: 1, active: true }]); await service.claim(input()); await expect(service.claim(input({ missionId: "mission-2" }))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" }); });
  it("allows only one concurrent reward grant", async () => { repo.rewards.set("mission-1", [{ type: "XP", amount: 500, active: true }]); const results = await Promise.allSettled([service.claim(input({ idempotencyKey: "a" })), service.claim(input({ idempotencyKey: "b" }))]); expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1); expect(repo.claims).toHaveLength(1); expect(repo.gameRepo.xpTransactions).toHaveLength(1); });
  it("rolls back claim, ledgers, event, and status on failure", async () => { repo.rewards.set("mission-1", [{ type: "SYNAPSE_POINTS", amount: 250, active: true }, { type: "XP", amount: 500, active: true }]); repo.failAfterRewards = true; await expect(service.claim(input())).rejects.toThrow("simulated event failure"); expect(repo.claims).toHaveLength(0); expect(repo.gameRepo.pointTransactions).toHaveLength(0); expect(repo.gameRepo.xpTransactions).toHaveLength(0); expect(repo.claimedEvents).toHaveLength(0); const progress = repo.progress.values().next().value; expect(progress).toBeDefined(); expect(progress?.status).toBe("CLAIMABLE"); });
});
