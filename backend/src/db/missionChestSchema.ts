import { sql } from "drizzle-orm";
import { bigserial, boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { adminUsers, gameEvents, missions, players, playerMissionProgress, pointTransactions, xpTransactions } from "./schema.js";
import type { RewardSnapshot } from "../domain/missionLifecycle.js";

export const missionChests = pgTable("mission_chests", {
  chestId: uuid("chest_id").primaryKey().defaultRandom(), title: text("title").notNull(),
  periodType: text("period_type").notNull(), targetCount: integer("target_count").notNull(),
  active: boolean("active").notNull().default(false),
  activationEffectiveAt: timestamp("activation_effective_at", { withTimezone: true }).notNull().defaultNow(),
  startsAt: timestamp("starts_at", { withTimezone: true }), endsAt: timestamp("ends_at", { withTimezone: true }),
  rewards: jsonb("rewards").$type<RewardSnapshot>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ periodCheck: check("mission_chests_period_check", sql`${t.periodType} IN ('DAILY', 'WEEKLY')`), targetCheck: check("mission_chests_target_check", sql`${t.targetCount} > 0`), windowCheck: check("mission_chests_window_check", sql`${t.endsAt} IS NULL OR ${t.startsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`) }));
export const missionChestEligibility = pgTable("mission_chest_eligibility", {
  eligibilityId: uuid("eligibility_id").primaryKey().defaultRandom(),
  chestId: uuid("chest_id").notNull().references(() => missionChests.chestId, { onDelete: "restrict" }),
  missionId: uuid("mission_id").notNull().references(() => missions.missionId, { onDelete: "restrict" }),
  selected: boolean("selected").notNull().default(true),
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
  periodType: text("period_type").notNull(),
  periodKey: text("period_key").notNull(), rewardSnapshot: jsonb("reward_snapshot").$type<RewardSnapshot>().notNull(),
  pointTransactionId: uuid("point_transaction_id").references(() => pointTransactions.transactionId, { onDelete: "restrict" }),
  xpTransactionId: uuid("xp_transaction_id").references(() => xpTransactions.xpTransactionId, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ periodTypeCheck: check("mission_chest_claims_period_type_check", sql`${t.periodType} IN ('DAILY','WEEKLY')`), playerPeriodUnique: uniqueIndex("mission_chest_claims_player_period_unique").on(t.playerId, t.periodType, t.periodKey), periodUnique: uniqueIndex("mission_chest_claims_period_unique").on(t.playerId, t.chestId, t.periodKey), keyUnique: uniqueIndex("mission_chest_claims_key_unique").on(t.playerId, t.idempotencyKey), progressUnique: uniqueIndex("mission_chest_claims_progress_unique").on(t.playerChestId) }));

// Separate immutable events independently persist product and budget approvals,
// their revocations, configuration snapshots and lifecycle receipts.
export const missionChestAdminEvents = pgTable("mission_chest_admin_events", {
  eventId: bigserial("event_id", { mode: "bigint" }).primaryKey(),
  chestId: uuid("chest_id").notNull().references(() => missionChests.chestId, { onDelete: "restrict" }),
  actorAdminUserId: uuid("actor_admin_user_id").notNull().references(() => adminUsers.adminUserId, { onDelete: "restrict" }),
  action: text("action").notNull(), revision: timestamp("revision", { withTimezone: true }).notNull(), digest: text("digest").notNull(),
  before: jsonb("before").$type<Record<string, unknown>>(), after: jsonb("after").$type<Record<string, unknown>>().notNull(),
  operationKey: uuid("operation_key"), request: jsonb("request").$type<Record<string, unknown>>(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ operationUnique: uniqueIndex("mission_chest_admin_operation_unique").on(t.chestId, t.operationKey),
  historyIndex: index("mission_chest_admin_history_idx").on(t.chestId, t.eventId),
  actionCheck: check("mission_chest_admin_action_check", sql`${t.action} IN ('CREATE','CONFIGURE','APPROVE_PRODUCT','APPROVE_REWARD_BUDGET','REVOKE_PRODUCT','REVOKE_REWARD_BUDGET','ACTIVATE','DEACTIVATE')`),
  digestCheck: check("mission_chest_admin_digest_check", sql`${t.digest} ~ '^[a-f0-9]{64}$'`),
}));
export const missionEventAttempts = pgTable("mission_event_attempts", {
  gameEventId: uuid("game_event_id").primaryKey().references(() => gameEvents.gameEventId, { onDelete: "restrict" }),
  attempts: integer("attempts").notNull().default(0), nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  quarantinedAt: timestamp("quarantined_at", { withTimezone: true }), errorCode: text("error_code").notNull(),
}, t => ({ attemptsCheck: check("mission_event_attempts_count_check", sql`${t.attempts} BETWEEN 0 AND 5`) }));
export const missionProcessingFailures = pgTable("mission_processing_failures", {
  failureId: uuid("failure_id").primaryKey().defaultRandom(), gameEventId: uuid("game_event_id").notNull().references(() => gameEvents.gameEventId, { onDelete: "restrict" }),
  entityType: text("entity_type").notNull(), entityId: uuid("entity_id").notNull(), errorCode: text("error_code").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ failureUnique: uniqueIndex("mission_processing_failures_unique").on(t.gameEventId, t.entityType, t.entityId) }));

export const chestCapacityExceptions = pgTable("chest_capacity_exceptions", {
  exceptionId: uuid("exception_id").primaryKey().defaultRandom(),
  progressId: uuid("progress_id").notNull().unique().references(() => playerMissionChests.playerChestId, { onDelete: "restrict" }),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "restrict" }),
  chestId: uuid("chest_id").notNull().references(() => missionChests.chestId, { onDelete: "restrict" }),
  periodType: text("period_type").notNull(),
  periodKey: text("period_key").notNull(), originalKey: text("original_key").notNull(),
  arrivedAt: timestamp("arrived_at", { withTimezone: true }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  claimDeadline: timestamp("claim_deadline", { withTimezone: true }),
  rewardSnapshot: jsonb("reward_snapshot").$type<RewardSnapshot>().notNull(),
  digest: text("digest").notNull(), xp: integer("xp").notNull(), synapsePoints: integer("synapse_points").notNull(),
}, t => ({
  playerPeriodUnique: uniqueIndex("chest_capacity_player_period_unique").on(t.playerId,t.periodType,t.periodKey),
  digestCheck: check("chest_capacity_digest_check", sql`${t.digest} ~ '^[a-f0-9]{64}$'`),
  timelyCheck: check("chest_capacity_timely_check", sql`${t.claimDeadline} IS NULL OR ${t.arrivedAt} < ${t.claimDeadline}`),
  amountsCheck: check("chest_capacity_amounts_check", sql`${t.xp} >= 0 AND ${t.synapsePoints} >= 0 AND (${t.xp} > 0 OR ${t.synapsePoints} > 0)`),
}));
export const chestCapacityRequests = pgTable("chest_capacity_requests", {
  requestId: uuid("request_id").primaryKey().defaultRandom(),
  exceptionId: uuid("exception_id").notNull().references(() => chestCapacityExceptions.exceptionId, { onDelete: "restrict" }),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "restrict" }),
  key: text("key").notNull(),
}, t => ({ keyUnique: uniqueIndex("chest_capacity_requests_player_key_idx").on(t.playerId, t.key) }));
export const chestCapacityEvents = pgTable("chest_capacity_events", {
  eventId: bigserial("event_id", { mode: "bigint" }).primaryKey(),
  exceptionId: uuid("exception_id").notNull().references(() => chestCapacityExceptions.exceptionId, { onDelete: "restrict" }),
  action: text("action").$type<"OPENED" | "RECOVERY_BLOCKED" | "RECOVERED">().notNull(),
  actorAdminUserId: uuid("actor_admin_user_id").references(() => adminUsers.adminUserId, { onDelete: "restrict" }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  errorCode: text("error_code"), reason: text("reason").notNull(),
  key: uuid("key"), request: jsonb("request").$type<{ expectedEventId: string; digest: string; reason: string }>(),
  claimId: uuid("claim_id").references(() => missionChestClaims.chestClaimId, { onDelete: "restrict" }),
}, t => ({
  keyUnique: uniqueIndex("chest_capacity_events_exception_key_idx").on(t.exceptionId, t.key),
  stateCheck: check("chest_capacity_events_state_check", sql`(${t.action} = 'OPENED' AND ${t.actorAdminUserId} IS NULL AND ${t.key} IS NULL AND ${t.claimId} IS NULL AND ${t.request} IS NULL) OR (${t.action} IN ('RECOVERY_BLOCKED','RECOVERED') AND ${t.actorAdminUserId} IS NOT NULL AND ${t.key} IS NOT NULL AND ${t.request} IS NOT NULL AND (${t.action} = 'RECOVERY_BLOCKED' AND ${t.claimId} IS NULL OR ${t.action} = 'RECOVERED' AND ${t.claimId} IS NOT NULL))`),
}));
