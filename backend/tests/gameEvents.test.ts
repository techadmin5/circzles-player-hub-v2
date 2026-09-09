import { describe, expect, it } from "vitest";
import { GameEventService, type GameEventInput, type GameEventRepository } from "../src/domain/gameEvents.js";

class MemoryGameEventRepository implements GameEventRepository {
  events: Array<GameEventInput & { gameEventId: string; createdAt: Date; processedAt: null }> = [];
  async append(input: GameEventInput) {
    const existing = this.events.find((event) => event.playerId === input.playerId && event.idempotencyKey === input.idempotencyKey);
    if (existing) return { event: existing, idempotent: true };
    const event = { ...input, gameEventId: `event-${this.events.length + 1}`, createdAt: new Date(), processedAt: null };
    this.events.push(event);
    return { event, idempotent: false };
  }
}

const event = (overrides: Partial<GameEventInput> = {}): GameEventInput => ({
  playerId: "player-1", eventType: "submission.created", sourceType: "SUBMISSION", sourceId: "submission-1",
  payload: { submissionId: "submission-1" }, idempotencyKey: "submission.created:submission-1", ...overrides,
});

describe("game event service", () => {
  it("inserts a new pending event", async () => {
    const repo = new MemoryGameEventRepository();
    const result = await new GameEventService(repo).append(event());
    expect(result.idempotent).toBe(false);
    expect(result.event.processedAt).toBeNull();
    expect(repo.events).toHaveLength(1);
  });

  it("treats a duplicate deterministic player key as an idempotent replay", async () => {
    const repo = new MemoryGameEventRepository();
    const service = new GameEventService(repo);
    const first = await service.append(event());
    const replay = await service.append(event());
    expect(replay).toMatchObject({ idempotent: true, event: { gameEventId: first.event.gameEventId } });
    expect(repo.events).toHaveLength(1);
  });

  it("allows the same idempotency key for different players", async () => {
    const repo = new MemoryGameEventRepository();
    const service = new GameEventService(repo);
    await service.append(event());
    await service.append(event({ playerId: "player-2" }));
    expect(repo.events).toHaveLength(2);
  });

  it("creates distinct events for distinct deterministic keys", async () => {
    const repo = new MemoryGameEventRepository();
    const service = new GameEventService(repo);
    await service.append(event());
    await service.append(event({ sourceId: "submission-2", idempotencyKey: "submission.created:submission-2" }));
    expect(repo.events).toHaveLength(2);
  });
});
