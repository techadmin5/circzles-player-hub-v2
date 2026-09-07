import { bigint, boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userStatus = pgEnum("user_status", ["ACTIVE", "SUSPENDED", "DELETED"]);
export const sessionStatus = pgEnum("session_status", ["ACTIVE", "REVOKED", "EXPIRED"]);
export const pointTransactionDirection = pgEnum("point_transaction_direction", ["CREDIT", "DEBIT", "CORRECTION"]);
export const videoUploadStatus = pgEnum("video_upload_status", ["SIGNED", "COMPLETE", "FAILED", "EXPIRED"]);
export const submissionStatus = pgEnum("submission_status", ["PENDING_REVIEW", "APPROVED", "REJECTED", "RESUBMISSION_REQUIRED"]);

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
  playerIdempotencyKeyUnique: uniqueIndex("xp_transactions_player_id_idempotency_key_unique").on(table.playerId, table.idempotencyKey),
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
  playerIdempotencyKeyUnique: uniqueIndex("point_transactions_player_id_idempotency_key_unique").on(table.playerId, table.idempotencyKey),
  playerCreatedAtIndex: index("point_transactions_player_created_at_idx").on(table.playerId, table.createdAt),
  sourceIndex: index("point_transactions_source_idx").on(table.sourceType, table.sourceId),
  amountCheck: check("point_transactions_amount_check", sql`${table.amount} > 0`),
  balanceAfterCheck: check("point_transactions_balance_after_check", sql`${table.balanceAfter} >= 0`),
}));

export const puzzleDesigns = pgTable("puzzle_designs", {
  puzzleDesignId: uuid("puzzle_design_id").primaryKey().defaultRandom(),
  legacyWixId: text("legacy_wix_id"),
  name: text("name").notNull(),
  description: text("description"),
  artwork: text("artwork"),
  status: text("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => ({
  legacyWixIdUnique: uniqueIndex("puzzle_designs_legacy_wix_id_unique").on(table.legacyWixId),
  statusIndex: index("puzzle_designs_status_idx").on(table.status),
}));

export const puzzles = pgTable("puzzles", {
  puzzleId: uuid("puzzle_id").primaryKey().defaultRandom(),
  puzzleDesignId: uuid("puzzle_design_id").notNull().references(() => puzzleDesigns.puzzleDesignId, { onDelete: "restrict" }),
  legacyWixId: text("legacy_wix_id"),
  name: text("name").notNull(),
  runCode: text("run_code"),
  pieceCount: integer("piece_count"),
  sizeLabel: text("size_label"),
  levelId: integer("level_id").notNull(),
  image: text("image"),
  description: text("description"),
  status: text("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => ({
  legacyWixIdUnique: uniqueIndex("puzzles_legacy_wix_id_unique").on(table.legacyWixId),
  designIndex: index("puzzles_puzzle_design_id_idx").on(table.puzzleDesignId),
  levelIdIndex: index("puzzles_level_id_idx").on(table.levelId),
  statusIndex: index("puzzles_status_idx").on(table.status),
  levelIdCheck: check("puzzles_level_id_check", sql`${table.levelId} > 0`),
  pieceCountCheck: check("puzzles_piece_count_check", sql`${table.pieceCount} is null or ${table.pieceCount} > 0`),
}));

export const puzzleClaimPrefixes = pgTable("puzzle_claim_prefixes", {
  puzzleClaimPrefixId: uuid("puzzle_claim_prefix_id").primaryKey().defaultRandom(),
  puzzleId: uuid("puzzle_id").notNull().references(() => puzzles.puzzleId, { onDelete: "restrict" }),
  prefix: text("prefix").notNull(),
  normalizedPrefix: text("normalized_prefix").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => ({
  normalizedPrefixUnique: uniqueIndex("puzzle_claim_prefixes_normalized_prefix_active_unique").on(table.normalizedPrefix).where(sql`${table.deletedAt} is null`),
  puzzleIdIndex: index("puzzle_claim_prefixes_puzzle_id_idx").on(table.puzzleId),
  activeIndex: index("puzzle_claim_prefixes_active_idx").on(table.active),
}));

export const puzzleClaims = pgTable("puzzle_claims", {
  puzzleClaimId: uuid("puzzle_claim_id").primaryKey().defaultRandom(),
  puzzleClaimPrefixId: uuid("puzzle_claim_prefix_id").notNull().references(() => puzzleClaimPrefixes.puzzleClaimPrefixId, { onDelete: "restrict" }),
  puzzleId: uuid("puzzle_id").notNull().references(() => puzzles.puzzleId, { onDelete: "restrict" }),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "cascade" }),
  serialNumber: bigint("serial_number", { mode: "bigint" }).notNull(),
  normalizedCode: text("normalized_code").notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  prefixSerialUnique: uniqueIndex("puzzle_claims_prefix_serial_unique").on(table.puzzleClaimPrefixId, table.serialNumber),
  normalizedCodeUnique: uniqueIndex("puzzle_claims_normalized_code_unique").on(table.normalizedCode),
  playerIndex: index("puzzle_claims_player_id_idx").on(table.playerId),
  puzzleIndex: index("puzzle_claims_puzzle_id_idx").on(table.puzzleId),
  serialNumberCheck: check("puzzle_claims_serial_number_check", sql`${table.serialNumber} > 0`),
}));

export const playerPuzzles = pgTable("player_puzzles", {
  playerPuzzleId: uuid("player_puzzle_id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "cascade" }),
  puzzleId: uuid("puzzle_id").notNull().references(() => puzzles.puzzleId, { onDelete: "restrict" }),
  puzzleClaimId: uuid("puzzle_claim_id").references(() => puzzleClaims.puzzleClaimId, { onDelete: "restrict" }),
  legacyWixId: text("legacy_wix_id"),
  source: text("source").notNull().default("CODE_CLAIM"),
  status: text("status").notNull().default("OWNED"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => ({
  playerPuzzleActiveUnique: uniqueIndex("player_puzzles_player_id_puzzle_id_active_unique").on(table.playerId, table.puzzleId).where(sql`${table.deletedAt} is null`),
  playerIndex: index("player_puzzles_player_id_idx").on(table.playerId),
  puzzleIndex: index("player_puzzles_puzzle_id_idx").on(table.puzzleId),
  claimUnique: uniqueIndex("player_puzzles_puzzle_claim_id_unique").on(table.puzzleClaimId),
}));

export const videoUploads = pgTable("video_uploads", {
  videoUploadId: uuid("video_upload_id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "cascade" }),
  storageProvider: text("storage_provider").notNull(),
  publicId: text("public_id").notNull(),
  originalFilename: text("original_filename"),
  mimeType: text("mime_type").notNull(),
  declaredSizeBytes: bigint("declared_size_bytes", { mode: "number" }).notNull(),
  verifiedSizeBytes: bigint("verified_size_bytes", { mode: "number" }),
  durationMs: integer("duration_ms"),
  status: videoUploadStatus("status").notNull().default("SIGNED"),
  failureCode: text("failure_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => ({
  publicIdUnique: uniqueIndex("video_uploads_public_id_unique").on(table.publicId),
  playerStatusIndex: index("video_uploads_player_status_idx").on(table.playerId, table.status),
  expiresAtIndex: index("video_uploads_expires_at_idx").on(table.expiresAt),
  declaredSizeCheck: check("video_uploads_declared_size_bytes_check", sql`${table.declaredSizeBytes} > 0`),
  verifiedSizeCheck: check("video_uploads_verified_size_bytes_check", sql`${table.verifiedSizeBytes} is null or ${table.verifiedSizeBytes} > 0`),
  durationCheck: check("video_uploads_duration_ms_check", sql`${table.durationMs} is null or ${table.durationMs} >= 0`),
}));

export const submissions = pgTable("submissions", {
  submissionId: uuid("submission_id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "cascade" }),
  playerPuzzleId: uuid("player_puzzle_id").notNull().references(() => playerPuzzles.playerPuzzleId, { onDelete: "restrict" }),
  puzzleId: uuid("puzzle_id").notNull().references(() => puzzles.puzzleId, { onDelete: "restrict" }),
  levelId: integer("level_id").notNull(),
  completionTimeMs: integer("completion_time_ms").notNull(),
  videoUploadId: uuid("video_upload_id").notNull().references(() => videoUploads.videoUploadId, { onDelete: "restrict" }),
  status: submissionStatus("status").notNull().default("PENDING_REVIEW"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  legacyWixId: text("legacy_wix_id"),
  idempotencyKey: text("idempotency_key"),
}, (table) => ({
  videoUploadUnique: uniqueIndex("submissions_video_upload_id_unique").on(table.videoUploadId),
  playerIdempotencyUnique: uniqueIndex("submissions_player_id_idempotency_key_unique").on(table.playerId, table.idempotencyKey),
  playerStatusIndex: index("submissions_player_status_idx").on(table.playerId, table.status),
  puzzleStatusIndex: index("submissions_puzzle_status_idx").on(table.puzzleId, table.status),
  levelStatusIndex: index("submissions_level_status_idx").on(table.levelId, table.status),
  playerPuzzleIndex: index("submissions_player_puzzle_id_idx").on(table.playerPuzzleId),
  completionTimeCheck: check("submissions_completion_time_ms_check", sql`${table.completionTimeMs} > 0`),
  levelIdCheck: check("submissions_level_id_check", sql`${table.levelId} > 0`),
}));
