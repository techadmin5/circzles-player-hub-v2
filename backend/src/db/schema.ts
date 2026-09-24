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
export const rewardDefinitionType = pgEnum("reward_definition_type", ["FRAME", "BADGE", "AVATAR", "RENAME_CARD", "COUPON", "SYNAPSE_POINTS", "XP", "COSMETIC"]);
export const couponOwnershipStatus = pgEnum("coupon_ownership_status", ["ACTIVE", "REDEEMED", "REVOKED"]);
export const couponStorefrontTarget = pgEnum("coupon_storefront_target", ["WIX_CIRCZLES_IN", "WIX_CIRCZLES_COM", "WIX_COGZART_IN", "WIX_COGZART_COM", "SHOPIFY_COGZART"]);
export const couponProvider = pgEnum("coupon_provider", ["WIX", "SHOPIFY"]);
export const couponProviderSyncStatus = pgEnum("coupon_provider_sync_status", ["PENDING_CREATE", "ACTIVE", "PENDING_DISABLE", "DISABLED", "ERROR"]);
export const equipmentSlot = pgEnum("equipment_slot", ["FRAME", "AVATAR", "BADGE_1", "BADGE_2", "BADGE_3"]);

export const users = pgTable("users", {
  userId: uuid("user_id").primaryKey().defaultRandom(),
  status: userStatus("status").notNull().default("ACTIVE"),
  verifiedEmail: text("verified_email"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  avatarUrl: text("avatar_url"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  verifiedEmailUnique: uniqueIndex("users_verified_email_unique").on(table.verifiedEmail),
}));

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
  sourceSite: text("source_site").notNull().default("CIRCZLES_COM"),
  identityProvider: text("identity_provider").notNull().default("WIX"),
  wixMemberId: text("wix_member_id").notNull(),
  verifiedEmail: text("verified_email"),
  displayName: text("display_name"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  avatarUrl: text("avatar_url"),
  emailVerified: boolean("email_verified").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sourceMemberUnique: uniqueIndex("wix_identity_links_source_member_unique").on(table.sourceSite, table.wixMemberId),
  userIndex: index("wix_identity_links_user_id_idx").on(table.userId),
  verifiedEmailIndex: index("wix_identity_links_verified_email_idx").on(table.verifiedEmail),
  sourceSiteCheck: check("wix_identity_links_source_site_check", sql`${table.sourceSite} in ('CIRCZLES_COM', 'CIRCZLES_IN')`),
  providerCheck: check("wix_identity_links_provider_check", sql`${table.identityProvider} in ('WIX', 'EMAIL', 'GOOGLE', 'FACEBOOK')`),
}));

export const authSessions = pgTable("auth_sessions", {
  sessionId: uuid("session_id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  status: sessionStatus("status").notNull().default("ACTIVE"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tokenHashUnique: uniqueIndex("auth_sessions_token_hash_unique").on(table.tokenHash),
  userIndex: index("auth_sessions_user_id_idx").on(table.userId),
}));

export const authHandoffExchanges = pgTable("auth_handoff_exchanges", {
  authHandoffExchangeId: uuid("auth_handoff_exchange_id").primaryKey().defaultRandom(),
  tokenIdHash: text("token_id_hash").notNull(),
  sourceSite: text("source_site").notNull(),
  userId: uuid("user_id").references(() => users.userId, { onDelete: "restrict" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tokenIdHashUnique: uniqueIndex("auth_handoff_exchanges_token_id_hash_unique").on(table.tokenIdHash),
  expiresAtIndex: index("auth_handoff_exchanges_expires_at_idx").on(table.expiresAt),
  sourceSiteCheck: check("auth_handoff_exchanges_source_site_check", sql`${table.sourceSite} in ('CIRCZLES_COM', 'CIRCZLES_IN')`),
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

export const missionClaims = pgTable("mission_claims", {
  missionClaimId: uuid("mission_claim_id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "restrict" }),
  missionId: uuid("mission_id").notNull().references(() => missions.missionId, { onDelete: "restrict" }),
  playerMissionProgressId: uuid("player_mission_progress_id").notNull().references(() => playerMissionProgress.playerMissionProgressId, { onDelete: "restrict" }),
  periodKey: text("period_key").notNull(),
  synapseRewardSnapshot: integer("synapse_reward_snapshot").notNull().default(0),
  xpRewardSnapshot: integer("xp_reward_snapshot").notNull().default(0),
  pointTransactionId: uuid("point_transaction_id").references(() => pointTransactions.transactionId, { onDelete: "restrict" }),
  xpTransactionId: uuid("xp_transaction_id").references(() => xpTransactions.xpTransactionId, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  progressUnique: uniqueIndex("mission_claims_player_mission_progress_id_unique").on(table.playerMissionProgressId),
  playerMissionPeriodUnique: uniqueIndex("mission_claims_player_mission_period_unique").on(table.playerId, table.missionId, table.periodKey),
  playerIdempotencyUnique: uniqueIndex("mission_claims_player_id_idempotency_key_unique").on(table.playerId, table.idempotencyKey),
  playerCreatedIndex: index("mission_claims_player_id_created_at_idx").on(table.playerId, table.createdAt),
  synapseRewardCheck: check("mission_claims_synapse_reward_snapshot_check", sql`${table.synapseRewardSnapshot} >= 0`),
  xpRewardCheck: check("mission_claims_xp_reward_snapshot_check", sql`${table.xpRewardSnapshot} >= 0`),
}));

export const rewardDefinitions = pgTable("reward_definitions", {
  rewardDefinitionId: uuid("reward_definition_id").primaryKey().defaultRandom(),
  rewardType: rewardDefinitionType("reward_type").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url"),
  rarity: text("rarity"),
  active: boolean("active").notNull().default(true),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  codeUnique: uniqueIndex("reward_definitions_code_unique").on(table.code),
  activeIndex: index("reward_definitions_active_idx").on(table.active),
}));

export const storeListings = pgTable("store_listings", {
  storeListingId: uuid("store_listing_id").primaryKey().defaultRandom(),
  rewardDefinitionId: uuid("reward_definition_id").notNull().references(() => rewardDefinitions.rewardDefinitionId, { onDelete: "restrict" }),
  priceSynapsePoints: integer("price_synapse_points").notNull(),
  active: boolean("active").notNull().default(true),
  featured: boolean("featured").notNull().default(false),
  displayOrder: integer("display_order").notNull().default(0),
  availableFrom: timestamp("available_from", { withTimezone: true }),
  availableUntil: timestamp("available_until", { withTimezone: true }),
  purchaseLimit: integer("purchase_limit"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  rewardDefinitionIndex: index("store_listings_reward_definition_id_idx").on(table.rewardDefinitionId),
  catalogOrderIndex: index("store_listings_catalog_order_idx").on(table.active, table.featured, table.displayOrder),
  priceCheck: check("store_listings_price_synapse_points_check", sql`${table.priceSynapsePoints} >= 0`),
  displayOrderCheck: check("store_listings_display_order_check", sql`${table.displayOrder} >= 0`),
  purchaseLimitCheck: check("store_listings_purchase_limit_check", sql`${table.purchaseLimit} is null or ${table.purchaseLimit} > 0`),
  availabilityCheck: check("store_listings_availability_check", sql`${table.availableUntil} is null or ${table.availableFrom} is null or ${table.availableUntil} > ${table.availableFrom}`),
}));

export const storePurchases = pgTable("store_purchases", {
  purchaseId: uuid("purchase_id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "restrict" }),
  storeListingId: uuid("store_listing_id").notNull().references(() => storeListings.storeListingId, { onDelete: "restrict" }),
  rewardDefinitionId: uuid("reward_definition_id").notNull().references(() => rewardDefinitions.rewardDefinitionId, { onDelete: "restrict" }),
  priceSynapsePointsSnapshot: integer("price_synapse_points_snapshot").notNull(),
  rewardTypeSnapshot: rewardDefinitionType("reward_type_snapshot").notNull(),
  rewardCodeSnapshot: text("reward_code_snapshot").notNull(),
  rewardNameSnapshot: text("reward_name_snapshot").notNull(),
  raritySnapshot: text("rarity_snapshot"),
  imageUrlSnapshot: text("image_url_snapshot"),
  pointTransactionId: uuid("point_transaction_id").references(() => pointTransactions.transactionId, { onDelete: "restrict" }),
  balanceAfter: integer("balance_after").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  playerIdempotencyUnique: uniqueIndex("store_purchases_player_id_idempotency_key_unique").on(table.playerId, table.idempotencyKey),
  pointTransactionUnique: uniqueIndex("store_purchases_point_transaction_id_unique").on(table.pointTransactionId),
  playerListingIndex: index("store_purchases_player_id_store_listing_id_idx").on(table.playerId, table.storeListingId),
  playerPurchasedAtIndex: index("store_purchases_player_id_purchased_at_idx").on(table.playerId, table.purchasedAt),
  priceCheck: check("store_purchases_price_synapse_points_snapshot_check", sql`${table.priceSynapsePointsSnapshot} >= 0`),
  balanceCheck: check("store_purchases_balance_after_check", sql`${table.balanceAfter} >= 0`),
  ledgerLinkCheck: check("store_purchases_point_transaction_link_check", sql`(${table.priceSynapsePointsSnapshot} = 0 and ${table.pointTransactionId} is null) or (${table.priceSynapsePointsSnapshot} > 0 and ${table.pointTransactionId} is not null)`),
}));

export const inventoryGrants = pgTable("inventory_grants", {
  inventoryGrantId: uuid("inventory_grant_id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "restrict" }),
  rewardDefinitionId: uuid("reward_definition_id").notNull().references(() => rewardDefinitions.rewardDefinitionId, { onDelete: "restrict" }),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  quantity: integer("quantity").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  playerIdempotencyUnique: uniqueIndex("inventory_grants_player_id_idempotency_key_unique").on(table.playerId, table.idempotencyKey),
  playerCreatedIndex: index("inventory_grants_player_id_created_at_idx").on(table.playerId, table.createdAt),
  sourceIndex: index("inventory_grants_source_idx").on(table.sourceType, table.sourceId),
  quantityCheck: check("inventory_grants_quantity_check", sql`${table.quantity} > 0`),
}));

export const couponOwnerships = pgTable("coupon_ownerships", {
  couponOwnershipId: uuid("coupon_ownership_id").primaryKey().defaultRandom(),
  couponCode: text("coupon_code").notNull(),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "restrict" }),
  rewardDefinitionId: uuid("reward_definition_id").notNull().references(() => rewardDefinitions.rewardDefinitionId, { onDelete: "restrict" }),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  issuanceOrdinal: integer("issuance_ordinal").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: couponOwnershipStatus("status").notNull().default("ACTIVE"),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => ({
  playerIdempotencyOrdinalUnique: uniqueIndex("coupon_ownerships_player_id_idempotency_key_ordinal_unique").on(table.playerId, table.idempotencyKey, table.issuanceOrdinal),
  playerSourceOrdinalUnique: uniqueIndex("coupon_ownerships_player_source_ordinal_unique").on(table.playerId, table.sourceType, table.sourceId, table.issuanceOrdinal),
  couponCodeUnique: uniqueIndex("coupon_ownerships_coupon_code_unique").on(table.couponCode),
  playerIssuedAtIndex: index("coupon_ownerships_player_id_issued_at_idx").on(table.playerId, table.issuedAt),
  playerStatusIndex: index("coupon_ownerships_player_id_status_idx").on(table.playerId, table.status),
  sourceIndex: index("coupon_ownerships_source_idx").on(table.sourceType, table.sourceId),
  rewardDefinitionIndex: index("coupon_ownerships_reward_definition_id_idx").on(table.rewardDefinitionId),
  couponCodeCheck: check("coupon_ownerships_coupon_code_check", sql`char_length(${table.couponCode}) between 1 and 20 and ${table.couponCode} ~ '^[A-Z0-9]+$'`),
  issuanceOrdinalCheck: check("coupon_ownerships_issuance_ordinal_check", sql`${table.issuanceOrdinal} > 0`),
  expiryCheck: check("coupon_ownerships_expiry_check", sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.issuedAt}`),
  redeemedAtCheck: check("coupon_ownerships_redeemed_at_check", sql`${table.redeemedAt} is null or ${table.redeemedAt} >= ${table.issuedAt}`),
  revokedAtCheck: check("coupon_ownerships_revoked_at_check", sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.issuedAt}`),
  lifecycleCheck: check("coupon_ownerships_lifecycle_check", sql`(${table.status} = 'ACTIVE' and ${table.redeemedAt} is null and ${table.revokedAt} is null) or (${table.status} = 'REDEEMED' and ${table.redeemedAt} is not null and ${table.revokedAt} is null) or (${table.status} = 'REVOKED' and ${table.redeemedAt} is null and ${table.revokedAt} is not null)`),
}));

export const couponProviderMappings = pgTable("coupon_provider_mappings", {
  couponProviderMappingId: uuid("coupon_provider_mapping_id").primaryKey().defaultRandom(),
  couponOwnershipId: uuid("coupon_ownership_id").notNull().references(() => couponOwnerships.couponOwnershipId, { onDelete: "restrict" }),
  storefrontTarget: couponStorefrontTarget("storefront_target").notNull(),
  provider: couponProvider("provider").notNull(),
  providerCouponId: text("provider_coupon_id"),
  syncStatus: couponProviderSyncStatus("sync_status").notNull().default("PENDING_CREATE"),
  lastSyncAttemptAt: timestamp("last_sync_attempt_at", { withTimezone: true }),
  lastSyncSucceededAt: timestamp("last_sync_succeeded_at", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  lastErrorMessage: text("last_error_message"),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownershipStorefrontUnique: uniqueIndex("coupon_provider_mappings_ownership_storefront_unique").on(table.couponOwnershipId, table.storefrontTarget),
  providerCouponIdUnique: uniqueIndex("coupon_provider_mappings_storefront_provider_coupon_id_unique").on(table.storefrontTarget, table.providerCouponId).where(sql`${table.providerCouponId} is not null`),
  ownershipIndex: index("coupon_provider_mappings_coupon_ownership_id_idx").on(table.couponOwnershipId),
  providerSyncIndex: index("coupon_provider_mappings_provider_sync_status_idx").on(table.provider, table.syncStatus),
  storefrontSyncIndex: index("coupon_provider_mappings_storefront_sync_status_idx").on(table.storefrontTarget, table.syncStatus),
  providerPairCheck: check("coupon_provider_mappings_provider_pair_check", sql`(${table.storefrontTarget} in ('WIX_CIRCZLES_IN', 'WIX_CIRCZLES_COM', 'WIX_COGZART_IN', 'WIX_COGZART_COM') and ${table.provider} = 'WIX') or (${table.storefrontTarget} = 'SHOPIFY_COGZART' and ${table.provider} = 'SHOPIFY')`),
  providerCouponIdCheck: check("coupon_provider_mappings_provider_coupon_id_check", sql`${table.providerCouponId} is null or btrim(${table.providerCouponId}) <> ''`),
  syncTimestampCheck: check("coupon_provider_mappings_sync_timestamp_check", sql`(${table.lastSyncAttemptAt} is null or (${table.lastSyncAttemptAt} >= ${table.createdAt} and ${table.lastSyncAttemptAt} <= ${table.updatedAt})) and (${table.lastSyncSucceededAt} is null or (${table.lastSyncSucceededAt} >= ${table.createdAt} and ${table.lastSyncSucceededAt} <= ${table.updatedAt})) and (${table.disabledAt} is null or (${table.disabledAt} >= ${table.createdAt} and ${table.disabledAt} <= ${table.updatedAt}))`),
  disabledStateCheck: check("coupon_provider_mappings_disabled_state_check", sql`(${table.syncStatus} = 'DISABLED' and ${table.disabledAt} is not null) or (${table.syncStatus} <> 'DISABLED' and ${table.disabledAt} is null)`),
  updatedAtCheck: check("coupon_provider_mappings_updated_at_check", sql`${table.updatedAt} >= ${table.createdAt}`),
}));

export const couponRedemptions = pgTable("coupon_redemptions", {
  couponRedemptionId: uuid("coupon_redemption_id").primaryKey().defaultRandom(),
  couponOwnershipId: uuid("coupon_ownership_id").notNull().references(() => couponOwnerships.couponOwnershipId, { onDelete: "restrict" }),
  storefrontTarget: couponStorefrontTarget("storefront_target").notNull(),
  sourceRedemptionId: text("source_redemption_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownershipUnique: uniqueIndex("coupon_redemptions_coupon_ownership_id_unique").on(table.couponOwnershipId),
  ownershipIdempotencyUnique: uniqueIndex("coupon_redemptions_ownership_idempotency_key_unique").on(table.couponOwnershipId, table.idempotencyKey),
  sourceUnique: uniqueIndex("coupon_redemptions_storefront_source_unique").on(table.storefrontTarget, table.sourceRedemptionId),
  storefrontRedeemedAtIndex: index("coupon_redemptions_storefront_redeemed_at_idx").on(table.storefrontTarget, table.redeemedAt),
  sourceRedemptionIdCheck: check("coupon_redemptions_source_redemption_id_check", sql`btrim(${table.sourceRedemptionId}) <> ''`),
  idempotencyKeyCheck: check("coupon_redemptions_idempotency_key_check", sql`btrim(${table.idempotencyKey}) <> ''`),
}));

export const playerInventoryItems = pgTable("player_inventory_items", {
  playerInventoryItemId: uuid("player_inventory_item_id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "restrict" }),
  rewardDefinitionId: uuid("reward_definition_id").notNull().references(() => rewardDefinitions.rewardDefinitionId, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  firstAcquiredAt: timestamp("first_acquired_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  playerRewardUnique: uniqueIndex("player_inventory_items_player_id_reward_definition_id_unique").on(table.playerId, table.rewardDefinitionId),
  playerIndex: index("player_inventory_items_player_id_idx").on(table.playerId),
  quantityCheck: check("player_inventory_items_quantity_check", sql`${table.quantity} >= 0`),
}));

export const inventoryConsumptions = pgTable("inventory_consumptions", {
  inventoryConsumptionId: uuid("inventory_consumption_id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "restrict" }),
  playerInventoryItemId: uuid("player_inventory_item_id").notNull().references(() => playerInventoryItems.playerInventoryItemId, { onDelete: "restrict" }),
  rewardDefinitionId: uuid("reward_definition_id").notNull().references(() => rewardDefinitions.rewardDefinitionId, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  quantityAfter: integer("quantity_after").notNull(),
  reason: text("reason").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  playerIdempotencyUnique: uniqueIndex("inventory_consumptions_player_id_idempotency_key_unique").on(table.playerId, table.idempotencyKey),
  playerCreatedAtIndex: index("inventory_consumptions_player_id_created_at_idx").on(table.playerId, table.createdAt),
  inventoryItemIndex: index("inventory_consumptions_player_inventory_item_id_idx").on(table.playerInventoryItemId),
  quantityCheck: check("inventory_consumptions_quantity_check", sql`${table.quantity} > 0`),
  quantityAfterCheck: check("inventory_consumptions_quantity_after_check", sql`${table.quantityAfter} >= 0`),
}));

export const playerEquipment = pgTable("player_equipment", {
  playerEquipmentId: uuid("player_equipment_id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "restrict" }),
  slot: equipmentSlot("slot").notNull(),
  playerInventoryItemId: uuid("player_inventory_item_id").notNull().references(() => playerInventoryItems.playerInventoryItemId, { onDelete: "restrict" }),
  equippedAt: timestamp("equipped_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  playerSlotUnique: uniqueIndex("player_equipment_player_id_slot_unique").on(table.playerId, table.slot),
  playerItemUnique: uniqueIndex("player_equipment_player_id_inventory_item_unique").on(table.playerId, table.playerInventoryItemId),
  playerIndex: index("player_equipment_player_id_idx").on(table.playerId),
}));

export const rewardWheels = pgTable("reward_wheels", {
  rewardWheelId: uuid("reward_wheel_id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(false),
  spinCostSynapsePoints: integer("spin_cost_synapse_points").notNull().default(0),
  cooldownSeconds: integer("cooldown_seconds").notNull().default(0),
  cycleSeconds: integer("cycle_seconds").notNull().default(86400),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  codeUnique: uniqueIndex("reward_wheels_code_unique").on(table.code),
  singleActiveUnique: uniqueIndex("reward_wheels_single_active_unique").on(table.active).where(sql`${table.active} = true`),
  activeWindowIndex: index("reward_wheels_active_window_idx").on(table.active, table.startsAt, table.endsAt),
  costCheck: check("reward_wheels_spin_cost_check", sql`${table.spinCostSynapsePoints} >= 0`),
  cooldownCheck: check("reward_wheels_cooldown_check", sql`${table.cooldownSeconds} >= 0`),
  cycleCheck: check("reward_wheels_cycle_seconds_check", sql`${table.cycleSeconds} > 0`),
  availabilityCheck: check("reward_wheels_availability_check", sql`${table.endsAt} is null or ${table.startsAt} is null or ${table.endsAt} > ${table.startsAt}`),
}));

export const rewardWheelSpinTiers = pgTable("reward_wheel_spin_tiers", {
  rewardWheelSpinTierId: uuid("reward_wheel_spin_tier_id").primaryKey().defaultRandom(),
  rewardWheelId: uuid("reward_wheel_id").notNull().references(() => rewardWheels.rewardWheelId, { onDelete: "restrict" }),
  spinNumber: integer("spin_number").notNull(),
  costSynapsePoints: integer("cost_synapse_points").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  wheelSpinNumberUnique: uniqueIndex("reward_wheel_spin_tiers_wheel_id_spin_number_unique").on(table.rewardWheelId, table.spinNumber),
  wheelActiveSpinNumberIndex: index("reward_wheel_spin_tiers_wheel_id_active_spin_number_idx").on(table.rewardWheelId, table.active, table.spinNumber),
  spinNumberCheck: check("reward_wheel_spin_tiers_spin_number_check", sql`${table.spinNumber} > 0`),
  costCheck: check("reward_wheel_spin_tiers_cost_check", sql`${table.costSynapsePoints} >= 0`),
}));

export const rewardWheelSegments = pgTable("reward_wheel_segments", {
  rewardWheelSegmentId: uuid("reward_wheel_segment_id").primaryKey().defaultRandom(),
  rewardWheelId: uuid("reward_wheel_id").notNull().references(() => rewardWheels.rewardWheelId, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  displayLabel: text("display_label").notNull(),
  weight: integer("weight").notNull(),
  rewardDefinitionId: uuid("reward_definition_id").notNull().references(() => rewardDefinitions.rewardDefinitionId, { onDelete: "restrict" }),
  rewardQuantity: integer("reward_quantity").notNull(),
  active: boolean("active").notNull().default(true),
  displayMetadata: jsonb("display_metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  wheelPositionUnique: uniqueIndex("reward_wheel_segments_wheel_id_position_unique").on(table.rewardWheelId, table.position),
  wheelActivePositionIndex: index("reward_wheel_segments_wheel_id_active_position_idx").on(table.rewardWheelId, table.active, table.position),
  rewardDefinitionIndex: index("reward_wheel_segments_reward_definition_id_idx").on(table.rewardDefinitionId),
  positionCheck: check("reward_wheel_segments_position_check", sql`${table.position} >= 0`),
  weightCheck: check("reward_wheel_segments_weight_check", sql`${table.weight} > 0`),
  rewardQuantityCheck: check("reward_wheel_segments_reward_quantity_check", sql`${table.rewardQuantity} > 0`),
}));

export const rewardWheelSpins = pgTable("reward_wheel_spins", {
  rewardWheelSpinId: uuid("reward_wheel_spin_id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.playerId, { onDelete: "restrict" }),
  rewardWheelId: uuid("reward_wheel_id").notNull().references(() => rewardWheels.rewardWheelId, { onDelete: "restrict" }),
  rewardWheelSegmentId: uuid("reward_wheel_segment_id").notNull().references(() => rewardWheelSegments.rewardWheelSegmentId, { onDelete: "restrict" }),
  rewardWheelSpinTierId: uuid("reward_wheel_spin_tier_id").references(() => rewardWheelSpinTiers.rewardWheelSpinTierId, { onDelete: "restrict" }),
  rewardDefinitionId: uuid("reward_definition_id").notNull().references(() => rewardDefinitions.rewardDefinitionId, { onDelete: "restrict" }),
  wheelCodeSnapshot: text("wheel_code_snapshot").notNull(),
  wheelNameSnapshot: text("wheel_name_snapshot").notNull(),
  segmentPositionSnapshot: integer("segment_position_snapshot").notNull(),
  segmentLabelSnapshot: text("segment_label_snapshot").notNull(),
  spinCostSynapsePointsSnapshot: integer("spin_cost_synapse_points_snapshot").notNull(),
  cooldownSecondsSnapshot: integer("cooldown_seconds_snapshot").notNull(),
  spinNumberSnapshot: integer("spin_number_snapshot"),
  cycleStartedAt: timestamp("cycle_started_at", { withTimezone: true }),
  cycleEndsAt: timestamp("cycle_ends_at", { withTimezone: true }),
  rewardQuantitySnapshot: integer("reward_quantity_snapshot").notNull(),
  rewardTypeSnapshot: rewardDefinitionType("reward_type_snapshot").notNull(),
  rewardCodeSnapshot: text("reward_code_snapshot").notNull(),
  rewardNameSnapshot: text("reward_name_snapshot").notNull(),
  rewardRaritySnapshot: text("reward_rarity_snapshot"),
  rewardImageUrlSnapshot: text("reward_image_url_snapshot"),
  resultingSynapsePointBalance: integer("resulting_synapse_point_balance").notNull(),
  costPointTransactionId: uuid("cost_point_transaction_id").references(() => pointTransactions.transactionId, { onDelete: "restrict" }),
  rewardPointTransactionId: uuid("reward_point_transaction_id").references(() => pointTransactions.transactionId, { onDelete: "restrict" }),
  rewardXpTransactionId: uuid("reward_xp_transaction_id").references(() => xpTransactions.xpTransactionId, { onDelete: "restrict" }),
  rewardInventoryGrantId: uuid("reward_inventory_grant_id").references(() => inventoryGrants.inventoryGrantId, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  spunAt: timestamp("spun_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  playerIdempotencyUnique: uniqueIndex("reward_wheel_spins_player_id_idempotency_key_unique").on(table.playerId, table.idempotencyKey),
  playerSpunAtIndex: index("reward_wheel_spins_player_id_spun_at_idx").on(table.playerId, table.spunAt),
  playerWheelSpunAtIndex: index("reward_wheel_spins_player_id_wheel_id_spun_at_idx").on(table.playerId, table.rewardWheelId, table.spunAt),
  wheelSpunAtIndex: index("reward_wheel_spins_wheel_id_spun_at_idx").on(table.rewardWheelId, table.spunAt),
  segmentPositionCheck: check("reward_wheel_spins_segment_position_snapshot_check", sql`${table.segmentPositionSnapshot} >= 0`),
  costCheck: check("reward_wheel_spins_spin_cost_snapshot_check", sql`${table.spinCostSynapsePointsSnapshot} >= 0`),
  cooldownCheck: check("reward_wheel_spins_cooldown_snapshot_check", sql`${table.cooldownSecondsSnapshot} >= 0`),
  spinNumberCheck: check("reward_wheel_spins_spin_number_snapshot_check", sql`${table.spinNumberSnapshot} is null or ${table.spinNumberSnapshot} > 0`),
  cycleWindowCheck: check("reward_wheel_spins_cycle_window_check", sql`(${table.cycleStartedAt} is null and ${table.cycleEndsAt} is null) or (${table.cycleStartedAt} is not null and ${table.cycleEndsAt} > ${table.cycleStartedAt})`),
  rewardQuantityCheck: check("reward_wheel_spins_reward_quantity_snapshot_check", sql`${table.rewardQuantitySnapshot} > 0`),
  balanceCheck: check("reward_wheel_spins_resulting_balance_check", sql`${table.resultingSynapsePointBalance} >= 0`),
  costLedgerLinkCheck: check("reward_wheel_spins_cost_ledger_link_check", sql`(${table.spinCostSynapsePointsSnapshot} = 0 and ${table.costPointTransactionId} is null) or (${table.spinCostSynapsePointsSnapshot} > 0 and ${table.costPointTransactionId} is not null)`),
}));
