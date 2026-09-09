import { bigint, boolean, check, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userStatus = pgEnum("user_status", ["ACTIVE", "SUSPENDED", "DELETED"]);
export const sessionStatus = pgEnum("session_status", ["ACTIVE", "REVOKED", "EXPIRED"]);
export const pointTransactionDirection = pgEnum("point_transaction_direction", ["CREDIT", "DEBIT", "CORRECTION"]);
export const videoUploadStatus = pgEnum("video_upload_status", ["SIGNED", "COMPLETE", "FAILED", "EXPIRED"]);
export const submissionStatus = pgEnum("submission_status", ["PENDING_REVIEW", "APPROVED", "REJECTED", "RESUBMISSION_REQUIRED"]);
export const puzzleCompetitionCategory = pgEnum("puzzle_competition_category", ["MAIN_LEVEL", "SIDE_QUEST"]);
export const adminRole = pgEnum("admin_role", ["SUPER_ADMIN", "REVIEWER"]);
export const submissionReviewDecision = pgEnum("submission_review_decision", ["APPROVED", "REJECTED", "RESUBMISSION_REQUIRED"]);

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

export const gameEvents = pgTable("game_events", {
  gameEventId: uuid("game_event_id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "restrict" }),
  eventType: text("event_type").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (table) => ({
  playerIdempotencyUnique: uniqueIndex("game_events_player_id_idempotency_key_unique").on(table.playerId, table.idempotencyKey),
  playerCreatedAtIndex: index("game_events_player_id_created_at_idx").on(table.playerId, table.createdAt),
  eventTypeCreatedAtIndex: index("game_events_event_type_created_at_idx").on(table.eventType, table.createdAt),
  unprocessedCreatedAtIndex: index("game_events_unprocessed_created_at_idx").on(table.createdAt).where(sql`${table.processedAt} is null`),
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
  levelId: numeric("level_id", { precision: 4, scale: 1, mode: "number" }).notNull(),
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
  levelId: numeric("level_id", { precision: 4, scale: 1, mode: "number" }).notNull(),
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

export const adminUsers = pgTable("admin_users", {
  adminUserId: uuid("admin_user_id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "restrict" }),
  role: adminRole("role").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdUnique: uniqueIndex("admin_users_user_id_unique").on(table.userId),
  activeRoleIndex: index("admin_users_active_role_idx").on(table.active, table.role),
}));

export const submissionReviews = pgTable("submission_reviews", {
  submissionReviewId: uuid("submission_review_id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id").notNull().references(() => submissions.submissionId, { onDelete: "restrict" }),
  reviewerAdminUserId: uuid("reviewer_admin_user_id").notNull().references(() => adminUsers.adminUserId, { onDelete: "restrict" }),
  decision: submissionReviewDecision("decision").notNull(),
  reviewNote: text("review_note"),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  reviewerIdempotencyUnique: uniqueIndex("submission_reviews_reviewer_id_idempotency_key_unique").on(table.reviewerAdminUserId, table.idempotencyKey),
  submissionCreatedIndex: index("submission_reviews_submission_created_at_idx").on(table.submissionId, table.createdAt),
  reviewerCreatedIndex: index("submission_reviews_reviewer_created_at_idx").on(table.reviewerAdminUserId, table.createdAt),
}));

export const submissionRewardGrants = pgTable("submission_reward_grants", {
  submissionRewardGrantId: uuid("submission_reward_grant_id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "restrict" }),
  puzzleId: uuid("puzzle_id").notNull().references(() => puzzles.puzzleId, { onDelete: "restrict" }),
  submissionId: uuid("submission_id").notNull().references(() => submissions.submissionId, { onDelete: "restrict" }),
  rewardEnabledSnapshot: boolean("reward_enabled_snapshot").notNull(),
  synapseReward: integer("synapse_reward").notNull(),
  xpReward: integer("xp_reward").notNull(),
  pointTransactionId: uuid("point_transaction_id").references(() => pointTransactions.transactionId, { onDelete: "restrict" }),
  xpTransactionId: uuid("xp_transaction_id").references(() => xpTransactions.xpTransactionId, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  playerPuzzleUnique: uniqueIndex("submission_reward_grants_player_id_puzzle_id_unique").on(table.playerId, table.puzzleId),
  submissionUnique: uniqueIndex("submission_reward_grants_submission_id_unique").on(table.submissionId),
  synapseRewardCheck: check("submission_reward_grants_synapse_reward_check", sql`${table.synapseReward} >= 0`),
  xpRewardCheck: check("submission_reward_grants_xp_reward_check", sql`${table.xpReward} >= 0`),
}));

export const leaderboardEntries = pgTable("leaderboard_entries", {
  leaderboardEntryId: uuid("leaderboard_entry_id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "restrict" }),
  puzzleId: uuid("puzzle_id").notNull().references(() => puzzles.puzzleId, { onDelete: "restrict" }),
  bestSubmissionId: uuid("best_submission_id").notNull().references(() => submissions.submissionId, { onDelete: "restrict" }),
  bestCompletionTimeMs: integer("best_completion_time_ms").notNull(),
  bestApprovedAt: timestamp("best_approved_at", { withTimezone: true }).notNull(),
  bestSubmittedAt: timestamp("best_submitted_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  playerPuzzleUnique: uniqueIndex("leaderboard_entries_player_id_puzzle_id_unique").on(table.playerId, table.puzzleId),
  rankingIndex: index("leaderboard_entries_puzzle_ranking_idx").on(table.puzzleId, table.bestCompletionTimeMs, table.bestApprovedAt, table.bestSubmittedAt, table.bestSubmissionId),
  playerIndex: index("leaderboard_entries_player_id_idx").on(table.playerId),
  completionTimeCheck: check("leaderboard_entries_best_completion_time_ms_check", sql`${table.bestCompletionTimeMs} > 0`),
}));

export const puzzleCompetitionSettings = pgTable("puzzle_competition_settings", {
  puzzleCompetitionSettingId: uuid("puzzle_competition_setting_id").primaryKey().defaultRandom(),
  puzzleId: uuid("puzzle_id").notNull().references(() => puzzles.puzzleId, { onDelete: "cascade" }),
  category: puzzleCompetitionCategory("category").notNull(),
  leaderboardEnabled: boolean("leaderboard_enabled").notNull().default(false),
  displayOrder: integer("display_order").notNull(),
  rewardEnabled: boolean("reward_enabled").notNull().default(false),
  synapseReward: integer("synapse_reward").notNull().default(0),
  xpReward: integer("xp_reward").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  puzzleIdUnique: uniqueIndex("puzzle_competition_settings_puzzle_id_unique").on(table.puzzleId),
  navigationIndex: index("puzzle_competition_settings_navigation_idx").on(table.active, table.leaderboardEnabled, table.category, table.displayOrder),
  displayOrderCheck: check("puzzle_competition_settings_display_order_check", sql`${table.displayOrder} >= 0`),
  synapseRewardCheck: check("puzzle_competition_settings_synapse_reward_check", sql`${table.synapseReward} >= 0`),
  xpRewardCheck: check("puzzle_competition_settings_xp_reward_check", sql`${table.xpReward} >= 0`),
}));

export const missions = pgTable("missions", {
  missionId: uuid("mission_id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  periodType: text("period_type").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  visibilityIndex: index("missions_visibility_idx").on(table.active, table.startsAt, table.endsAt, table.displayOrder),
  displayOrderCheck: check("missions_display_order_check", sql`${table.displayOrder} >= 0`),
  dateWindowCheck: check("missions_date_window_check", sql`${table.startsAt} is null or ${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`),
}));

export const missionRules = pgTable("mission_rules", {
  missionRuleId: uuid("mission_rule_id").primaryKey().defaultRandom(),
  missionId: uuid("mission_id").notNull().references(() => missions.missionId, { onDelete: "restrict" }),
  eventType: text("event_type").notNull(),
  targetCount: integer("target_count").notNull(),
  sourceType: text("source_type"),
  puzzleId: uuid("puzzle_id").references(() => puzzles.puzzleId, { onDelete: "restrict" }),
  levelId: numeric("level_id", { precision: 4, scale: 1, mode: "number" }),
  conditions: jsonb("conditions").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  missionUnique: uniqueIndex("mission_rules_mission_id_unique").on(table.missionId),
  eventActiveIndex: index("mission_rules_event_type_active_idx").on(table.eventType, table.active),
  targetCountCheck: check("mission_rules_target_count_check", sql`${table.targetCount} > 0`),
  levelIdCheck: check("mission_rules_level_id_check", sql`${table.levelId} is null or ${table.levelId} > 0`),
}));

export const missionRewards = pgTable("mission_rewards", {
  missionRewardId: uuid("mission_reward_id").primaryKey().defaultRandom(),
  missionId: uuid("mission_id").notNull().references(() => missions.missionId, { onDelete: "restrict" }),
  rewardType: text("reward_type").notNull(),
  amount: integer("amount").notNull(),
  active: boolean("active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  missionOrderIndex: index("mission_rewards_mission_id_display_order_idx").on(table.missionId, table.displayOrder),
  amountCheck: check("mission_rewards_amount_check", sql`${table.amount} > 0`),
  displayOrderCheck: check("mission_rewards_display_order_check", sql`${table.displayOrder} >= 0`),
}));

export const playerMissionProgress = pgTable("player_mission_progress", {
  playerMissionProgressId: uuid("player_mission_progress_id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "restrict" }),
  missionId: uuid("mission_id").notNull().references(() => missions.missionId, { onDelete: "restrict" }),
  periodKey: text("period_key").notNull(),
  currentCount: integer("current_count").notNull().default(0),
  targetCountSnapshot: integer("target_count_snapshot").notNull(),
  status: text("status").notNull().default("IN_PROGRESS"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  lastGameEventId: uuid("last_game_event_id").references(() => gameEvents.gameEventId, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  playerMissionPeriodUnique: uniqueIndex("player_mission_progress_player_mission_period_unique").on(table.playerId, table.missionId, table.periodKey),
  playerStatusIndex: index("player_mission_progress_player_status_idx").on(table.playerId, table.status),
  missionPeriodIndex: index("player_mission_progress_mission_period_idx").on(table.missionId, table.periodKey),
  currentCountCheck: check("player_mission_progress_current_count_check", sql`${table.currentCount} >= 0 and ${table.currentCount} <= ${table.targetCountSnapshot}`),
  targetCountCheck: check("player_mission_progress_target_count_snapshot_check", sql`${table.targetCountSnapshot} > 0`),
  statusCheck: check("player_mission_progress_status_check", sql`${table.status} in ('IN_PROGRESS', 'CLAIMABLE', 'CLAIMED')`),
}));
