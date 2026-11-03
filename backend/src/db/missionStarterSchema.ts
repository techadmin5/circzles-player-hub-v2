import { sql } from "drizzle-orm";
import { boolean, check, jsonb, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { missions, players, gameEvents, playerMissionProgress, rewardDefinitions } from "./schema.js";

export const missionTrackingConfigs = pgTable("mission_tracking_configs", {
  missionId: uuid("mission_id").primaryKey().references(() => missions.missionId, { onDelete: "restrict" }),
  mode: text("mode").$type<"EVENT_COUNT" | "DISTINCT_UTC_DAYS" | "DISTINCT_MISSIONS">().notNull(),
  firstEver: boolean("first_ever").notNull().default(false),
  eligibleMissionIds: jsonb("eligible_mission_ids").$type<string[]>().notNull().default([]),
  collectibleId: uuid("collectible_id").references(() => rewardDefinitions.rewardDefinitionId, { onDelete: "restrict" }),
}, t => ({ mode: check("mission_tracking_mode_check", sql`${t.mode} IN ('EVENT_COUNT','DISTINCT_UTC_DAYS','DISTINCT_MISSIONS')`), ids: check("mission_tracking_ids_check", sql`jsonb_typeof(${t.eligibleMissionIds}) = 'array'`) }));

export const missionEventContributions = pgTable("mission_event_contributions", {
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "restrict" }),
  missionId: uuid("mission_id").notNull().references(() => missions.missionId, { onDelete: "restrict" }),
  periodKey: text("period_key").notNull(), contributionKey: text("contribution_key").notNull(),
  gameEventId: uuid("game_event_id").notNull().references(() => gameEvents.gameEventId, { onDelete: "restrict" }),
}, t => ({ pk: primaryKey({ columns: [t.playerId, t.missionId, t.periodKey, t.contributionKey] }) }));

// Separate from immutable version-1 XP/SP snapshots. Frozen when the mission is earned.
export const missionEarnedCollectibles = pgTable("mission_earned_collectibles", {
  progressId: uuid("progress_id").primaryKey().references(() => playerMissionProgress.playerMissionProgressId, { onDelete: "restrict" }),
  rewardDefinitionId: uuid("reward_definition_id").notNull().references(() => rewardDefinitions.rewardDefinitionId, { onDelete: "restrict" }),
  rewardType: text("reward_type").$type<"BADGE" | "FRAME">().notNull(),
  disposition: text("disposition").$type<"PENDING" | "GRANTED" | "ALREADY_OWNED">().notNull().default("PENDING"),
}, t => ({ type: check("mission_collectible_type_check", sql`${t.rewardType} IN ('BADGE','FRAME')`), state: check("mission_collectible_state_check", sql`${t.disposition} IN ('PENDING','GRANTED','ALREADY_OWNED')`) }));

export const missionStarterBatchItems = pgTable("mission_starter_batch_items", {
  batchKey: text("batch_key").notNull(), definitionKey: text("definition_key").notNull(),
  missionId: uuid("mission_id").notNull().unique().references(() => missions.missionId, { onDelete: "restrict" }),
  requestDigest: text("request_digest").notNull(),
}, t => ({ pk: primaryKey({ columns: [t.batchKey, t.definitionKey] }) }));
