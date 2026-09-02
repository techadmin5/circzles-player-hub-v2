import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const userStatus = pgEnum("user_status", ["ACTIVE", "SUSPENDED", "DELETED"]);
export const sessionStatus = pgEnum("session_status", ["ACTIVE", "REVOKED", "EXPIRED"]);

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
