import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { gameEvents } from "../db/schema.js";
import { AppError, validationFailed } from "./errors.js";
import type { GameStateTransaction } from "./gameState.js";

export const implementedGameEventTypes = [
  "puzzle.added", "submission.created", "submission.approved", "submission.rejected",
  "submission.resubmission_required", "personal_best.improved", "points.earned",
  "xp.earned", "progression.level_up",
  "mission.completed",
  "mission.claimed",
  "store.purchase.completed",
  "coupon.issued",
  "inventory.item.granted", "inventory.item.equipped", "inventory.item.unequipped", "inventory.item.consumed",
  "player.display_name.changed",
  "reward_wheel.spun",
] as const;

export type GameEventType = typeof implementedGameEventTypes[number];

export interface GameEventInput {
  playerId: string;
  eventType: GameEventType;
  sourceType: string;
  sourceId: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

export type GameEvent = typeof gameEvents.$inferSelect;

export interface GameEventRepository {
  append(input: GameEventInput): Promise<{ event: GameEvent; idempotent: boolean }>;
}

export class GameEventService {
  constructor(private repo: GameEventRepository) {}
  append(input: GameEventInput) {
    validateGameEvent(input);
    return this.repo.append(input);
  }
}

export class DrizzleGameEventRepository implements GameEventRepository {
  constructor(private db: Database) {}
  append(input: GameEventInput) {
    validateGameEvent(input);
    return this.db.transaction((tx) => insertGameEventInTransaction(tx, input));
  }
}

export async function insertGameEventInTransaction(tx: GameStateTransaction, input: GameEventInput) {
  validateGameEvent(input);
  const [created] = await tx.insert(gameEvents).values(input).onConflictDoNothing({
    target: [gameEvents.playerId, gameEvents.idempotencyKey],
  }).returning();
  if (created) return { event: created, idempotent: false };
  const [existing] = await tx.select().from(gameEvents).where(and(
    eq(gameEvents.playerId, input.playerId),
    eq(gameEvents.idempotencyKey, input.idempotencyKey),
  )).limit(1);
  if (!existing) throw new AppError("GAME_EVENT_WRITE_FAILED", "Could not record game event.", 500);
  return { event: existing, idempotent: true };
}

function validateGameEvent(input: GameEventInput) {
  if (!input.playerId || !input.sourceType.trim() || !input.sourceId.trim() || !input.idempotencyKey.trim()) {
    throw validationFailed("Game event player, source, and idempotency identifiers are required.");
  }
  if (!implementedGameEventTypes.includes(input.eventType)) throw validationFailed("Unsupported game event type.");
}
