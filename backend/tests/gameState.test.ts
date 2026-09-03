import { describe, expect, it } from "vitest";
import { AppError } from "../src/domain/errors.js";
import { GameStateService, temporaryDevelopmentProgressionLevels } from "../src/domain/gameState.js";
import { FakeGameStateRepository } from "./fakes.js";

async function service() {
  const repo = new FakeGameStateRepository();
  const gameState = new GameStateService(repo);
  await gameState.seedProgressionLevels(temporaryDevelopmentProgressionLevels);
  return { repo, gameState };
}

describe("game state progression and economy", () => {
  it("initializes player game state idempotently with zero XP and zero Synapse balance", async () => {
    const { repo, gameState } = await service();
    await gameState.ensurePlayerGameState("player-1");
    await gameState.ensurePlayerGameState("player-1");
    const state = await gameState.getPlayerGameState("player-1");
    expect(repo.states.size).toBe(1);
    expect(repo.wallets.size).toBe(1);
    expect(state.totalXp).toBe(0);
    expect(state.synapsePoints).toBe(0);
    expect(state.progressionLevel).toBe(1);
    expect(state.rankName).toBe("Peasant");
  });

  it("XP grant appends one ledger transaction and updates cached progression", async () => {
    const { repo, gameState } = await service();
    const result = await gameState.grantXp({ playerId: "player-1", amount: 500, reason: "test", sourceType: "test" });
    expect(repo.xpTransactions).toHaveLength(1);
    expect(result.totalXpAfter).toBe(500);
    expect(result.state.totalXp).toBe(500);
    expect(result.state.rankName).toBe("Peasant");
  });

  it("XP crossing a threshold updates rank and progression level", async () => {
    const { gameState } = await service();
    const result = await gameState.grantXp({ playerId: "player-1", amount: 8000, reason: "test", sourceType: "test" });
    expect(result.state.progressionLevel).toBe(15);
    expect(result.state.rankName).toBe("Knight");
    expect(result.state.xpNeeded).toBe(12800);
  });

  it("duplicate XP idempotency key does not double-award", async () => {
    const { repo, gameState } = await service();
    await gameState.grantXp({ playerId: "player-1", amount: 500, reason: "test", sourceType: "test", idempotencyKey: "xp-1" });
    const second = await gameState.grantXp({ playerId: "player-1", amount: 500, reason: "test", sourceType: "test", idempotencyKey: "xp-1" });
    const state = await gameState.getPlayerGameState("player-1");
    expect(second.idempotent).toBe(true);
    expect(repo.xpTransactions).toHaveLength(1);
    expect(state.totalXp).toBe(500);
  });

  it("point credit updates ledger and wallet", async () => {
    const { repo, gameState } = await service();
    const result = await gameState.creditPoints({ playerId: "player-1", amount: 250, reason: "test", sourceType: "test" });
    expect(result.balanceAfter).toBe(250);
    expect(repo.pointTransactions).toHaveLength(1);
    expect((await gameState.getPlayerGameState("player-1")).synapsePoints).toBe(250);
  });

  it("point debit updates ledger and wallet", async () => {
    const { repo, gameState } = await service();
    await gameState.creditPoints({ playerId: "player-1", amount: 250, reason: "test", sourceType: "test" });
    const debit = await gameState.debitPoints({ playerId: "player-1", amount: 100, reason: "test", sourceType: "test" });
    expect(debit.balanceAfter).toBe(150);
    expect(repo.pointTransactions).toHaveLength(2);
    expect((await gameState.getPlayerGameState("player-1")).synapsePoints).toBe(150);
  });

  it("insufficient point debit fails safely", async () => {
    const { repo, gameState } = await service();
    await expect(gameState.debitPoints({ playerId: "player-1", amount: 100, reason: "test", sourceType: "test" })).rejects.toMatchObject({ code: "INSUFFICIENT_POINTS" } satisfies Partial<AppError>);
    expect(repo.pointTransactions).toHaveLength(0);
    expect((await gameState.getPlayerGameState("player-1")).synapsePoints).toBe(0);
  });

  it("duplicate point idempotency does not double-change balance", async () => {
    const { repo, gameState } = await service();
    await gameState.creditPoints({ playerId: "player-1", amount: 250, reason: "test", sourceType: "test", idempotencyKey: "pt-1" });
    const second = await gameState.creditPoints({ playerId: "player-1", amount: 250, reason: "test", sourceType: "test", idempotencyKey: "pt-1" });
    expect(second.idempotent).toBe(true);
    expect(repo.pointTransactions).toHaveLength(1);
    expect((await gameState.getPlayerGameState("player-1")).synapsePoints).toBe(250);
  });
});
