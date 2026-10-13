import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { gameEvents, missions, players, playerMissionProgress, pointTransactions, xpTransactions } from "./schema.js";
import type { RewardSnapshot } from "../domain/missionLifecycle.js";

export const missionChests = pgTable("mission_chests", {
  chestId: uuid("chest_id").primaryKey().defaultRandom(), title: text("title").notNull(),
  periodType: text("period_type").notNull(), targetCount: integer("target_count").notNull(),
  active: boolean("active").notNull().default(false),
  activationEffectiveAt: timestamp("activation_effective_at", { withTimezone: true }).notNull().defaultNow(),
  startsAt: timestamp("starts_at", { withTimezone: true }), endsAt: timestamp("ends_at", { withTimezone: true }),
  rewards: jsonb("rewards").$type<RewardSnapshot>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ periodCheck: check("mission_chests_period_check", sql`${t.periodType} IN ('DAILY', 'WEEKLY')`), targetCheck: check("mission_chests_target_check", sql`${t.targetCount} > 0`), windowCheck: check("mission_chests_window_check", sql`${t.endsAt} IS NULL OR ${t.startsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`) }));
export const missionChestEligibility = pgTable("mission_chest_eligibility", {
  eligibilityId: uuid("eligibility_id").primaryKey().defaultRandom(),
  chestId: uuid("chest_id").notNull().references(() => missionChests.chestId, { onDelete: "restrict" }),
  missionId: uuid("mission_id").notNull().references(() => missions.missionId, { onDelete: "restrict" }),
  active: boolean("active").notNull().default(false), effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ associationUnique: uniqueIndex("mission_chest_eligibility_unique").on(t.chestId, t.missionId) }));
export const playerMissionChests = pgTable("player_mission_chests", {
  playerChestId: uuid("player_chest_id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "restrict" }),
  chestId: uuid("chest_id").notNull().references(() => missionChests.chestId, { onDelete: "restrict" }),
  periodKey: text("period_key").notNull(), targetCountSnapshot: integer("target_count_snapshot").notNull(), currentCount: integer("current_count").notNull().default(0),
  periodStartsAt: timestamp("period_starts_at", { withTimezone: true }).notNull(), periodEndsAt: timestamp("period_ends_at", { withTimezone: true }).notNull(),
  claimDeadline: timestamp("claim_deadline", { withTimezone: true }).notNull(), rewardSnapshot: jsonb("reward_snapshot").$type<RewardSnapshot>(),
  unlockedAt: timestamp("unlocked_at", { withTimezone: true }), claimedAt: timestamp("claimed_at", { withTimezone: true }), expiredAt: timestamp("expired_at", { withTimezone: true }),
}, t => ({ periodUnique: uniqueIndex("player_mission_chests_period_unique").on(t.playerId, t.chestId, t.periodKey), countCheck: check("player_mission_chests_count_check", sql`${t.targetCountSnapshot} > 0 AND ${t.currentCount} BETWEEN 0 AND ${t.targetCountSnapshot}`), playerIndex: index("player_mission_chests_player_idx").on(t.playerId) }));
export const missionChestCompletions = pgTable("mission_chest_completions", {
  completionId: uuid("completion_id").primaryKey().defaultRandom(),
  playerChestId: uuid("player_chest_id").notNull().references(() => playerMissionChests.playerChestId, { onDelete: "restrict" }),
  missionId: uuid("mission_id").notNull().references(() => missions.missionId, { onDelete: "restrict" }),
  playerMissionProgressId: uuid("player_mission_progress_id").notNull().references(() => playerMissionProgress.playerMissionProgressId, { onDelete: "restrict" }),
  gameEventId: uuid("game_event_id").notNull().references(() => gameEvents.gameEventId, { onDelete: "restrict" }),
  eligibilityId: uuid("eligibility_id").notNull().references(() => missionChestEligibility.eligibilityId, { onDelete: "restrict" }),
  eligibilityEffectiveAt: timestamp("eligibility_effective_at", { withTimezone: true }).notNull(), completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
}, t => ({ distinctMission: uniqueIndex("mission_chest_completions_distinct_unique").on(t.playerChestId, t.missionId) }));
export const missionChestClaims = pgTable("mission_chest_claims", {
  chestClaimId: uuid("chest_claim_id").primaryKey().defaultRandom(),
  playerChestId: uuid("player_chest_id").notNull().references(() => playerMissionChests.playerChestId, { onDelete: "restrict" }),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "restrict" }),
  chestId: uuid("chest_id").notNull().references(() => missionChests.chestId, { onDelete: "restrict" }),
  periodKey: text("period_key").notNull(), rewardSnapshot: jsonb("reward_snapshot").$type<RewardSnapshot>().notNull(),
  pointTransactionId: uuid("point_transaction_id").references(() => pointTransactions.transactionId, { onDelete: "restrict" }),
  xpTransactionId: uuid("xp_transaction_id").references(() => xpTransactions.xpTransactionId, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ periodUnique: uniqueIndex("mission_chest_claims_period_unique").on(t.playerId, t.chestId, t.periodKey), keyUnique: uniqueIndex("mission_chest_claims_key_unique").on(t.playerId, t.idempotencyKey), progressUnique: uniqueIndex("mission_chest_claims_progress_unique").on(t.playerChestId) }));
export const missionEventAttempts = pgTable("mission_event_attempts", {
  gameEventId: uuid("game_event_id").primaryKey().references(() => gameEvents.gameEventId, { onDelete: "restrict" }),
  attempts: integer("attempts").notNull().default(0), nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  quarantinedAt: timestamp("quarantined_at", { withTimezone: true }), errorCode: text("error_code").notNull(),
}, t => ({ attemptsCheck: check("mission_event_attempts_count_check", sql`${t.attempts} BETWEEN 0 AND 5`) }));
export const missionProcessingFailures = pgTable("mission_processing_failures", {
  failureId: uuid("failure_id").primaryKey().defaultRandom(), gameEventId: uuid("game_event_id").notNull().references(() => gameEvents.gameEventId, { onDelete: "restrict" }),
  entityType: text("entity_type").notNull(), entityId: uuid("entity_id").notNull(), errorCode: text("error_code").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ failureUnique: uniqueIndex("mission_processing_failures_unique").on(t.gameEventId, t.entityType, t.entityId) }));
