import { bigint, boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userStatus = pgEnum("user_status", ["ACTIVE", "SUSPENDED", "DELETED"]);
export const sessionStatus = pgEnum("session_status", ["ACTIVE", "REVOKED", "EXPIRED"]);
export const pointTransactionDirection = pgEnum("point_transaction_direction", ["CREDIT", "DEBIT", "CORRECTION"]);

export const users = pgTable("users", {
  userId: uuid("user_id").primaryKey().defaultRandom(),
  status: userStatus("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const players = pgTable("players", {
  playerId: uuid("player_id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "restrict" }),
  publicPlayerId: text("public_player_id").notNull(),
  displayName: text("display_name").notNull(),
  country: text("country"),
  state: text("state"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdUnique: uniqueIndex("players_user_id_unique").on(table.userId),
  publicPlayerIdUnique: uniqueIndex("players_public_player_id_unique").on(table.publicPlayerId),
  displayNameIndex: index("players_display_name_idx").on(table.displayName),
}));

export const wixIdentityLinks = pgTable("wix_identity_links", {
  wixIdentityLinkId: uuid("wix_identity_link_id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "restrict" }),
  wixMemberId: text("wix_member_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdUnique: uniqueIndex("wix_identity_links_user_id_unique").on(table.userId),
  wixMemberIdUnique: uniqueIndex("wix_identity_links_wix_member_id_unique").on(table.wixMemberId),
}));

export const authSessions = pgTable("auth_sessions", {
  sessionId: uuid("session_id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  status: sessionStatus("status").notNull().default("ACTIVE"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tokenHashUnique: uniqueIndex("auth_sessions_token_hash_unique").on(table.tokenHash),
  userIndex: index("auth_sessions_user_id_idx").on(table.userId),
}));

export const progressionLevels = pgTable("progression_levels", {
  progressionLevelId: uuid("progression_level_id").primaryKey().defaultRandom(),
  progressionLevel: integer("progression_level").notNull(),
  rankName: text("rank_name").notNull(),
  xpRequired: bigint("xp_required", { mode: "number" }).notNull(),
  rewards: jsonb("rewards").$type<unknown[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  progressionLevelUnique: uniqueIndex("progression_levels_level_unique").on(table.progressionLevel),
  xpRequiredCheck: check("progression_levels_xp_required_check", sql`${table.xpRequired} >= 0`),
}));

export const playerProgression = pgTable("player_progression", {
  playerProgressionId: uuid("player_progression_id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "cascade" }),
  totalXp: bigint("total_xp", { mode: "number" }).notNull().default(0),
  progressionLevel: integer("progression_level").notNull(),
  rankName: text("rank_name").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  playerIdUnique: uniqueIndex("player_progression_player_id_unique").on(table.playerId),
  totalXpCheck: check("player_progression_total_xp_check", sql`${table.totalXp} >= 0`),
}));

export const xpTransactions = pgTable("xp_transactions", {
  xpTransactionId: uuid("xp_transaction_id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  reason: text("reason").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id"),
  totalXpAfter: bigint("total_xp_after", { mode: "number" }).notNull(),
  idempotencyKey: text("idempotency_key"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idempotencyKeyUnique: uniqueIndex("xp_transactions_idempotency_key_unique").on(table.idempotencyKey),
  playerCreatedAtIndex: index("xp_transactions_player_created_at_idx").on(table.playerId, table.createdAt),
  sourceIndex: index("xp_transactions_source_idx").on(table.sourceType, table.sourceId),
  amountCheck: check("xp_transactions_amount_check", sql`${table.amount} > 0`),
}));

export const wallets = pgTable("wallets", {
  walletId: uuid("wallet_id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "cascade" }),
  balance: integer("balance").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  playerIdUnique: uniqueIndex("wallets_player_id_unique").on(table.playerId),
  balanceCheck: check("wallets_balance_check", sql`${table.balance} >= 0`),
}));

export const pointTransactions = pgTable("point_transactions", {
  transactionId: uuid("transaction_id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  direction: pointTransactionDirection("direction").notNull(),
  reason: text("reason").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id"),
  balanceAfter: integer("balance_after").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idempotencyKeyUnique: uniqueIndex("point_transactions_idempotency_key_unique").on(table.idempotencyKey),
  playerCreatedAtIndex: index("point_transactions_player_created_at_idx").on(table.playerId, table.createdAt),
  sourceIndex: index("point_transactions_source_idx").on(table.sourceType, table.sourceId),
  amountCheck: check("point_transactions_amount_check", sql`${table.amount} > 0`),
  balanceAfterCheck: check("point_transactions_balance_after_check", sql`${table.balanceAfter} >= 0`),
}));
