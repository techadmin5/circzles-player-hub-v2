import type { MissionLifecycleResult } from "../domain/adminMissionLifecycle.js";
import { sql } from "drizzle-orm";
import { bigint, bigserial, check, index, integer, jsonb, uniqueIndex, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { adminUsers, missions, players, playerMissionProgress, missionClaims } from "./schema.js";
import type { RewardSnapshot } from "../domain/missionLifecycle.js";

export type MissionAdminSnapshot = {
  title: string; description: string; displayOrder: number;
  category: string; periodType: string; active: boolean; updatedAt: string;
  rule?: { eventType: string; targetCount: number; sourceType: string | null; puzzleId: string | null; levelId: number | null; conditions: Record<string, string | number | boolean | null>; active: boolean } | null;
  schedule?: { startsAt: string | null; endsAt: string | null; claimDeadline: string | null; activationEffectiveAt: string };
  rewards?: { rewardType: string; amount: number; active: boolean }[];
  lifecycleOperation?: MissionLifecycleResult;
  approval?: { category: "PRODUCT" | "REWARD_BUDGET"; status: "MISSING" | "APPROVED" | "REVOKED" | "INVALIDATED"; approvalId: string | null; revocationId: string | null; revision: string; digest: string; xp: number | null; synapsePoints: number | null };
};

export const missionAdminHistory = pgTable("mission_admin_history", {
  historyId: bigserial("history_id", { mode: "bigint" }).primaryKey(),
  missionId: uuid("mission_id").notNull().references(() => missions.missionId, { onDelete: "restrict" }),
  actorAdminUserId: uuid("actor_admin_user_id").notNull().references(() => adminUsers.adminUserId, { onDelete: "restrict" }),
  action: text("action").$type<"DRAFT_CREATED" | "METADATA_UPDATED" | "RULE_CONFIGURED" | "SCHEDULE_CONFIGURED" | "REWARDS_CONFIGURED" | "APPROVAL_GRANTED" | "APPROVAL_REVOKED" | "MISSION_ACTIVATED" | "MISSION_DEACTIVATED">().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  before: jsonb("before").$type<MissionAdminSnapshot>(),
  after: jsonb("after").$type<MissionAdminSnapshot>().notNull(),
}, table => ({
  missionIndex: index("mission_admin_history_mission_id_history_id_idx").on(table.missionId, table.historyId),
  actionCheck: check("mission_admin_history_action_check", sql`${table.action} IN ('DRAFT_CREATED', 'METADATA_UPDATED', 'RULE_CONFIGURED', 'SCHEDULE_CONFIGURED', 'REWARDS_CONFIGURED', 'APPROVAL_GRANTED', 'APPROVAL_REVOKED', 'MISSION_ACTIVATED', 'MISSION_DEACTIVATED')`),
  snapshotCheck: check("mission_admin_history_snapshot_check", sql`jsonb_typeof(${table.after}) = 'object' AND ((${table.action} = 'DRAFT_CREATED' AND ${table.before} IS NULL) OR (${table.action} IN ('METADATA_UPDATED', 'RULE_CONFIGURED', 'SCHEDULE_CONFIGURED', 'REWARDS_CONFIGURED', 'APPROVAL_GRANTED', 'APPROVAL_REVOKED', 'MISSION_ACTIVATED', 'MISSION_DEACTIVATED') AND ${table.before} IS NOT NULL AND jsonb_typeof(${table.before}) = 'object'))`),
}));

export const missionApprovals = pgTable("mission_approvals", {
  approvalId: bigserial("approval_id", { mode: "bigint" }).primaryKey(),
  missionId: uuid("mission_id").notNull().references(() => missions.missionId, { onDelete: "restrict" }),
  category: text("category").$type<"PRODUCT" | "REWARD_BUDGET">().notNull(),
  configurationRevision: timestamp("configuration_revision", { withTimezone: true }).notNull(),
  configurationDigest: text("configuration_digest").notNull(),
  approverAdminUserId: uuid("approver_admin_user_id").notNull().references(() => adminUsers.adminUserId, { onDelete: "restrict" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  xp: integer("xp").notNull(), synapsePoints: integer("synapse_points").notNull(),
}, table => ({
  missionIndex: index("mission_approvals_mission_category_id_idx").on(table.missionId, table.category, table.approvalId),
  categoryCheck: check("mission_approvals_category_check", sql`${table.category} IN ('PRODUCT', 'REWARD_BUDGET')`),
  digestCheck: check("mission_approvals_digest_check", sql`${table.configurationDigest} ~ '^[a-f0-9]{64}$'`),
  amountsCheck: check("mission_approvals_amounts_check", sql`${table.xp} >= 0 AND ${table.synapsePoints} >= 0 AND (${table.xp} > 0 OR ${table.synapsePoints} > 0)`),
}));
export const missionApprovalRevocations = pgTable("mission_approval_revocations", {
  revocationId: bigserial("revocation_id", { mode: "bigint" }).primaryKey(),
  approvalId: bigint("approval_id", { mode: "bigint" }).notNull().unique().references(() => missionApprovals.approvalId, { onDelete: "restrict" }),
  actorAdminUserId: uuid("actor_admin_user_id").notNull().references(() => adminUsers.adminUserId, { onDelete: "restrict" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull().defaultNow(),
});

export const missionLifecycleOperations = pgTable("mission_lifecycle_operations", {
  operationId: uuid("operation_id").primaryKey(),
  missionId: uuid("mission_id").notNull().references(() => missions.missionId, { onDelete: "restrict" }),
  actorAdminUserId: uuid("actor_admin_user_id").notNull().references(() => adminUsers.adminUserId, { onDelete: "restrict" }),
  action: text("action").$type<"ACTIVATE" | "DEACTIVATE">().notNull(),
  idempotencyKey: uuid("idempotency_key").notNull(),
  request: jsonb("request").$type<{ expectedUpdatedAt: string; configurationDigest: string; idempotencyKey: string }>().notNull(),
  result: jsonb("result").$type<MissionLifecycleResult>().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  keyIndex: uniqueIndex("mission_lifecycle_operations_mission_key_idx").on(table.missionId, table.idempotencyKey),
  actionCheck: check("mission_lifecycle_operations_action_check", sql.raw(`action IN ('ACTIVATE', 'DEACTIVATE')`)),
  payloadCheck: check("mission_lifecycle_operations_payload_check", sql.raw(`jsonb_typeof(request) = 'object' AND jsonb_typeof(result) = 'object'`)),
}));

export const missionCapacityExceptions = pgTable("mission_capacity_exceptions", {
  exceptionId: uuid("exception_id").primaryKey().defaultRandom(),
  progressId: uuid("progress_id").notNull().unique().references(() => playerMissionProgress.playerMissionProgressId, { onDelete: "restrict" }),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "restrict" }),
  missionId: uuid("mission_id").notNull().references(() => missions.missionId, { onDelete: "restrict" }),
  periodKey: text("period_key").notNull(), originalKey: text("original_key").notNull(),
  arrivedAt: timestamp("arrived_at", { withTimezone: true }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  claimDeadline: timestamp("claim_deadline", { withTimezone: true }),
  rewardSnapshot: jsonb("reward_snapshot").$type<RewardSnapshot>().notNull(),
  digest: text("digest").notNull(), xp: integer("xp").notNull(), synapsePoints: integer("synapse_points").notNull(),
}, t => ({
  digestCheck: check("mission_capacity_digest_check", sql`${t.digest} ~ '^[a-f0-9]{64}$'`),
  timelyCheck: check("mission_capacity_timely_check", sql`${t.claimDeadline} IS NULL OR ${t.arrivedAt} < ${t.claimDeadline}`),
  amountsCheck: check("mission_capacity_amounts_check", sql`${t.xp} >= 0 AND ${t.synapsePoints} >= 0 AND (${t.xp} > 0 OR ${t.synapsePoints} > 0)`),
}));
export const missionCapacityRequests = pgTable("mission_capacity_requests", {
  requestId: uuid("request_id").primaryKey().defaultRandom(),
  exceptionId: uuid("exception_id").notNull().references(() => missionCapacityExceptions.exceptionId, { onDelete: "restrict" }),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "restrict" }),
  key: text("key").notNull(),
}, t => ({ keyUnique: uniqueIndex("mission_capacity_requests_player_key_idx").on(t.playerId, t.key) }));
export const missionCapacityEvents = pgTable("mission_capacity_events", {
  eventId: bigserial("event_id", { mode: "bigint" }).primaryKey(),
  exceptionId: uuid("exception_id").notNull().references(() => missionCapacityExceptions.exceptionId, { onDelete: "restrict" }),
  action: text("action").$type<"OPENED" | "RECOVERY_BLOCKED" | "RECOVERED">().notNull(),
  actorAdminUserId: uuid("actor_admin_user_id").references(() => adminUsers.adminUserId, { onDelete: "restrict" }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  errorCode: text("error_code"), reason: text("reason").notNull(),
  key: uuid("key"), request: jsonb("request").$type<{ expectedEventId: string; digest: string; reason: string }>(),
  claimId: uuid("claim_id").references(() => missionClaims.missionClaimId, { onDelete: "restrict" }),
}, t => ({
  keyUnique: uniqueIndex("mission_capacity_events_exception_key_idx").on(t.exceptionId, t.key),
  stateCheck: check("mission_capacity_events_state_check", sql`(${t.action} = 'OPENED' AND ${t.actorAdminUserId} IS NULL AND ${t.key} IS NULL AND ${t.claimId} IS NULL AND ${t.request} IS NULL) OR (${t.action} IN ('RECOVERY_BLOCKED','RECOVERED') AND ${t.actorAdminUserId} IS NOT NULL AND ${t.key} IS NOT NULL AND ${t.request} IS NOT NULL AND (${t.action} = 'RECOVERY_BLOCKED' AND ${t.claimId} IS NULL OR ${t.action} = 'RECOVERED' AND ${t.claimId} IS NOT NULL))`),
}));
