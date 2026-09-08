# Database Schema Blueprint

## Conventions

- PostgreSQL UUID primary keys use `gen_random_uuid()`.
- Timestamps use `timestamptz`.
- Soft deletable tables use `deleted_at`.
- Immutable ledgers and audit tables are append-only.
- Public API DTOs may expose `id`, but database columns should use explicit foreign keys such as `player_id`, `puzzle_id`, and `mission_id`.

## Proposed Table Count

Core first-release tables: 38.

Future chat tables: 3.

## Tables

### users

Purpose: authenticated account owner.

Columns:

| column | type | nullable | default | notes |
|---|---|---:|---|---|
| user_id | uuid | no | gen_random_uuid() | PK |
| wix_member_id | text | yes | null | unique when present |
| email | citext | yes | null | unique when present |
| status | text | no | 'ACTIVE' | CHECK ACTIVE, SUSPENDED, DELETED |
| created_at | timestamptz | no | now() | |
| updated_at | timestamptz | no | now() | |
| deleted_at | timestamptz | yes | null | soft delete |

Indexes: unique `wix_member_id`, unique `email`.

### players

Purpose: game identity and public profile anchor.

Columns:

| column | type | nullable | default | notes |
|---|---|---:|---|---|
| player_id | uuid | no | gen_random_uuid() | PK, frontend `internalId` |
| user_id | uuid | no | | FK users |
| public_player_id | text | no | | unique, frontend `publicPlayerId` |
| display_name | text | no | | frontend `displayName` |
| country | text | yes | | |
| state | text | yes | | |
| avatar_object_key | text | yes | | |
| equipped_frame_item_id | uuid | yes | | FK reward_definitions/store items via inventory |
| status | text | no | 'ACTIVE' | |
| created_at | timestamptz | no | now() | |
| updated_at | timestamptz | no | now() | |
| deleted_at | timestamptz | yes | | |

Constraints: unique `user_id` for first release, unique `public_player_id`, CHECK display name length/characters.

Indexes: `players(public_player_id)`, trigram or full-text search index on `display_name`.

### player_profiles

Purpose: optional private profile fields and settings.

Columns: `player_profile_id` PK, `player_id` FK unique, `first_name`, `last_name`, `notification_settings jsonb`, `sound_settings jsonb`, `created_at`, `updated_at`.

### puzzle_designs

Purpose: reusable puzzle design/art identity. A single design/name can have multiple playable puzzle variants.

Columns: `puzzle_design_id` PK, `legacy_wix_id`, `name`, `description`, `artwork`, `status`, `created_at`, `updated_at`, `deleted_at`.

Indexes: unique `legacy_wix_id`, `status`.

Phase 3C status: implemented.

### puzzles

Purpose: canonical playable puzzle variant catalog.

Columns: `puzzle_id` PK, `puzzle_design_id` FK, `legacy_wix_id`, `name`, `run_code`, `piece_count`, `size_label`, `level_id numeric(4,1)`, `image`, `description`, `status`, `created_at`, `updated_at`, `deleted_at`.

Rules: `puzzle_id` is the stable playable variant id. The same design/name may have multiple playable variants with separate `puzzle_id` values, ownership, submissions, and leaderboards. `level_id` is puzzle difficulty. Do not rename to `levelNumber`.

Constraints: unique `legacy_wix_id`, CHECK `level_id > 0`, CHECK `piece_count is null or piece_count > 0`.

Indexes: `puzzles(puzzle_design_id)`, `puzzles(level_id)`, `puzzles(status)`, `puzzles(legacy_wix_id)`.

### puzzle_competition_settings

Purpose: PostgreSQL-backed leaderboard navigation and future reward configuration keyed to canonical playable `puzzle_id`.

Columns: `puzzle_competition_setting_id` UUID PK, `puzzle_id` FK unique, explicit `category` enum (`MAIN_LEVEL`, `SIDE_QUEST`), `leaderboard_enabled` default false, non-negative `display_order`, `reward_enabled` default false, non-negative `synapse_reward` default 0, non-negative `xp_reward` default 0, `active` default true, `created_at`, `updated_at`.

Rules: one row per puzzle variant. The table does not duplicate `level_id`; consumers join the canonical puzzle. Side Quests are identified by category, never inferred from fractional values. Only active, leaderboard-enabled settings for active puzzles belong in navigation.

Phase 3C status: implemented.

### puzzle_claim_prefixes

Purpose: active code prefix catalog. Prefixes map physical code families to playable puzzle variants without storing every serial in advance.

Columns: `puzzle_claim_prefix_id` PK, `puzzle_id` FK, `prefix`, `normalized_prefix`, `active`, `created_at`, `updated_at`, `deleted_at`.

Rules: for a code like `CC-11-18-R1-001`, `CC-11-18-R1` is the prefix and `001` is the serial. Prefixes are normalized by trim + uppercase.

Constraints: unique usable `normalized_prefix` through a partial unique index where `deleted_at is null`.

Indexes: `puzzle_claim_prefixes(puzzle_id)`, `puzzle_claim_prefixes(active)`.

Phase 3C status: implemented.

### puzzle_claims

Purpose: record physical puzzle-unit claims as players redeem printed codes.

Columns: `puzzle_claim_id` PK, `puzzle_claim_prefix_id` FK, `puzzle_id` FK, `player_id` FK, `serial_number bigint`, `normalized_code`, `claimed_at`, `created_at`.

Rules: serial is the final hyphen segment, digits only, greater than zero, stored as `bigint`. Leading zeroes do not create distinct units; `CC-11-18-R1-001` and `CC-11-18-R1-1` are the same `normalized_code`.

Constraints: unique `(puzzle_claim_prefix_id, serial_number)`, unique `normalized_code`, CHECK `serial_number > 0`.

Indexes: `puzzle_claims(player_id)`, `puzzle_claims(puzzle_id)`.

Phase 3C status: implemented.

### player_puzzles

Purpose: puzzle ownership.

Columns: `player_puzzle_id` PK, `player_id` FK, `puzzle_id` FK, `puzzle_claim_id` FK nullable, `legacy_wix_id`, `source`, `status`, `claimed_at`, `created_at`, `updated_at`, `deleted_at`.

Constraints: unique active ownership on `(player_id, puzzle_id)`, unique `puzzle_claim_id` when present.

Indexes: `player_puzzles(player_id)`, `player_puzzles(puzzle_id)`.

Phase 3C status: implemented. Code-claim ownership is created in the same transaction as `puzzle_claims`, so a failed ownership insert does not consume a physical code.

### submissions

Purpose: player solve attempts.

Columns: `submission_id` PK, `player_id` FK, `player_puzzle_id` FK, `puzzle_id` FK, `level_id numeric(4,1) not null`, `completion_time_ms int`, `video_upload_id` FK, `status`, `submitted_at`, `created_at`, `updated_at`, `legacy_wix_id`, `idempotency_key`.

Rules: `level_id` is copied from referenced puzzle at creation/recovery for historical query stability.

Constraints: CHECK completion time > 0 when submitted, unique `idempotency_key` when present.

Indexes: `submissions(player_id, status)`, `submissions(puzzle_id, status)`, `submissions(level_id, status)`, `submissions(player_puzzle_id)`.

### video_uploads

Purpose: object storage metadata.

Columns: `video_upload_id` PK, `player_id` FK, `storage_provider`, `bucket`, `object_key`, `mime_type`, `size_bytes`, `duration_ms`, `checksum`, `status`, `created_at`, `completed_at`, `expires_at`.

### submission_reviews

Phase 3E-B1 status: schema foundation only. No code writes review rows yet.

Purpose: future admin review history.

Columns: `submission_review_id` PK, `submission_id` FK, `reviewer_admin_user_id` FK, `decision`, `review_note`, `created_at`, `idempotency_key`.

Decisions: `APPROVED`, `REJECTED`, `RESUBMISSION_REQUIRED`.

Constraints: FKs to `submissions` and `admin_users`; unique `(reviewer_admin_user_id, idempotency_key)`. Approval mutation and reward processing remain deferred.

### submission_reward_grants

Purpose: idempotency guard for approval awards.

Columns: `submission_reward_grant_id` PK, `submission_id` FK unique, `point_transaction_id` FK nullable, `xp_transaction_id` FK nullable, `leaderboard_entry_id` FK nullable, `created_at`.

### leaderboard_entries

Purpose: best approved result for a player within a puzzle/season scope.

Columns: `leaderboard_entry_id` PK, `player_id` FK, `puzzle_id` FK, future fractional-compatible `level_id`, `season_id` FK nullable, `best_submission_id` FK, `best_approved_time_ms int`, `rank_status`, `created_at`, `updated_at`, `disqualified_at`.

Constraints: unique `(player_id, puzzle_id, season_id)` with season null handled by partial unique indexes.

Indexes: `(puzzle_id, season_id, best_approved_time_ms, created_at)`, `(level_id, season_id, best_approved_time_ms)`, `(player_id)`.

### seasons

Purpose: competition windows.

Columns: `season_id` PK, `name`, `artwork_object_key`, `start_at`, `end_at`, `status`, `created_at`, `updated_at`, `deleted_at`.

Indexes: `(status, start_at, end_at)`.

### progression_levels

Purpose: data-driven rank/progression map.

Columns: `progression_level_id` PK, `progression_level int unique`, `rank_name`, `xp_required`, `rewards jsonb`, `active`, `created_at`, `updated_at`.

Rules: progression level is not puzzle `level_id`.

Phase 3B status: implemented. `db:migrate` creates the schema only. `seed:dev` inserts all nine current rank names with temporary configuration values so backend calculations are data-driven in development. These seed values are not final business approval.

Phase 3C seed note: `db:migrate` remains schema-only. `seed:dev` now also inserts temporary development puzzle catalog rows and initializes the dev player; it is the only place the placeholder two-variant puzzle catalog is inserted.

### player_progression

Purpose: current cached XP progression state.

Columns: `player_progression_id` PK, `player_id` FK unique, `total_xp bigint`, `progression_level int`, `rank_name`, `updated_at`.

Consistency: updated transactionally with `xp_transactions`.

Phase 3B status: implemented. One row is ensured per player through idempotent game-state initialization.

### point_transactions

Purpose: immutable Synapse Point ledger.

Columns: `transaction_id` PK, `player_id` FK, `amount int`, `direction`, `reason`, `source_type`, `source_id uuid`, `balance_after int`, `metadata jsonb`, `idempotency_key`, `created_at`.

Constraints: `amount > 0`, direction CHECK CREDIT/DEBIT/CORRECTION, unique `(player_id, idempotency_key)`.

Indexes: `(player_id, created_at desc)`, `(source_type, source_id)`.

Phase 3B status: implemented for internal/domain operations and development-only verification routes.

### wallets

Purpose: cached current Synapse Point balance.

Columns: `wallet_id` PK, `player_id` FK unique, `balance int`, `updated_at`.

Consistency: only updated in same transaction as `point_transactions`; ledger remains source of truth.

Phase 3B status: implemented. One row is ensured per player through idempotent game-state initialization.

### xp_transactions

Purpose: immutable XP ledger.

Columns: `xp_transaction_id` PK, `player_id` FK, `amount int`, `reason`, `source_type`, `source_id uuid`, `total_xp_after bigint`, `idempotency_key`, `created_at`, `metadata jsonb`.

Constraints: `amount > 0`, unique `(player_id, idempotency_key)`.

Indexes: `(player_id, created_at desc)`, `(source_type, source_id)`.

Phase 3B status: implemented for internal/domain operations and development-only verification routes.

### store_items

Purpose: purchasable catalog.

Columns: `store_item_id` PK, `reward_definition_id` FK, `name`, `type`, `cost_points`, `rarity`, `active`, `sold_out_at`, `starts_at`, `ends_at`, `metadata jsonb`, `legacy_wix_id`, `created_at`, `updated_at`, `deleted_at`.

Indexes: `(active, type)`, `(legacy_wix_id)`.

### reward_definitions

Purpose: grantable game rewards.

Columns: `reward_definition_id` PK, `reward_type`, `name`, `rarity`, `stackable boolean`, `metadata jsonb`, `created_at`, `updated_at`, `deleted_at`.

Reward types: Synapse Points, XP, Badge, Frame, Coupon, Item.

### player_inventory

Purpose: owned items.

Columns: `player_inventory_id` PK, `player_id` FK, `reward_definition_id` FK, `quantity int`, `equipped boolean`, `acquired_source_type`, `acquired_source_id`, `acquired_at`, `consumed_at`, `expires_at`, `deleted_at`.

Constraints: unique `(player_id, reward_definition_id)` for non-stackable items; CHECK quantity >= 0.

### coupons

Purpose: internal coupon definition/code pool independent of Wix.

Columns: `coupon_id` PK, `code text unique`, `discount_type`, `discount_value`, `source_type`, `external_wix_coupon_id`, `starts_at`, `expires_at`, `created_at`, `deleted_at`.

### player_coupons

Purpose: player coupon ownership.

Columns: `player_coupon_id` PK, `player_id` FK, `coupon_id` FK, `status`, `created_at`, `used_at`, `expires_at`, `source_type`, `source_id`.

Indexes: `(player_id, status)`.

### missions

Purpose: mission definitions.

Columns: `mission_id` PK, `title`, `description`, `category`, `status`, `starts_at`, `ends_at`, `reset_policy`, `active`, `created_at`, `updated_at`, `deleted_at`.

Indexes: `(category, status, starts_at, ends_at)`.

### mission_rules

Purpose: data-driven conditions.

Columns: `mission_rule_id` PK, `mission_id` FK, `event_type`, `target_count`, `puzzle_id` FK nullable, `level_id int nullable`, `time_threshold_ms nullable`, `conditions jsonb`, `created_at`.

### mission_rewards

Purpose: rewards granted on mission claim.

Columns: `mission_reward_id` PK, `mission_id` FK, `reward_type`, `reward_definition_id` FK nullable, `amount int nullable`, `metadata jsonb`.

### player_mission_progress

Purpose: player progress and claim status.

Columns: `player_mission_progress_id` PK, `player_id` FK, `mission_id` FK, `period_key`, `current_count`, `target_count`, `status`, `claimable boolean`, `claimed_at`, `expires_at`, `updated_at`.

Constraints: unique `(player_id, mission_id, period_key)`.

### wheel_configurations

Purpose: active wheel setup.

Columns: `wheel_configuration_id` PK, `name`, `spin_cost_points`, `starts_at`, `ends_at`, `active`, `cooldown_seconds`, `created_at`, `updated_at`.

### wheel_segments

Purpose: weighted wheel reward entries.

Columns: `wheel_segment_id` PK, `wheel_configuration_id` FK, `segment_index int`, `reward_type`, `reward_definition_id` FK nullable, `amount int nullable`, `weight numeric`, `limit_per_player int nullable`, `active boolean`.

Constraints: unique `(wheel_configuration_id, segment_index)`.

### wheel_spins

Purpose: immutable spin result history.

Columns: `wheel_spin_id` PK, `player_id` FK, `wheel_configuration_id` FK, `wheel_segment_id` FK, `cost_transaction_id` FK, `reward_transaction_id` FK nullable, `inventory_grant_id` FK nullable, `result_payload jsonb`, `idempotency_key`, `created_at`.

Constraints: unique `idempotency_key`.

### friendships

Purpose: accepted social graph.

Columns: `friendship_id` PK, `player_id_low` FK, `player_id_high` FK, `created_at`, `blocked_at`, `removed_at`.

Rules: store ordered player IDs to enforce uniqueness.

Constraints: unique `(player_id_low, player_id_high)`, CHECK different players.

### friend_requests

Purpose: pending/declined friend requests.

Columns: `friend_request_id` PK, `from_player_id` FK, `to_player_id` FK, `status`, `created_at`, `responded_at`.

Constraints: CHECK no self request; partial unique active pending pair.

### notifications

Purpose: persisted notification inbox.

Columns: `notification_id` PK, `player_id` FK, `type`, `title`, `body`, `payload jsonb`, `read_at`, `created_at`.

Indexes: `(player_id, read_at, created_at desc)`.

### activity_events

Purpose: user-facing history, generated from domain events and materialized for fast display.

Columns: `activity_event_id` PK, `player_id` FK, `event_type`, `title`, `detail`, `category`, `source_type`, `source_id`, `payload jsonb`, `created_at`.

Indexes: `(player_id, created_at desc)`, `(source_type, source_id)`.

### game_events

Purpose: internal event stream for missions, activity, notifications, and future realtime.

Columns: `game_event_id` PK, `player_id` FK nullable, `event_type`, `source_type`, `source_id`, `payload jsonb`, `idempotency_key`, `created_at`, `processed_at`.

Constraints: unique `idempotency_key` when present.

### admin_users

Phase 3E-B1 status: implemented.

Purpose: one admin authorization record linked to an authenticated `users` account. Admin identity is deliberately not attached to `players`.

Columns: `admin_user_id` UUID PK, `user_id` FK unique, `role admin_role`, `active boolean`, `created_at`, `updated_at`.

Roles are `SUPER_ADMIN` and `REVIEWER`. Permissions are mapped in backend code: both roles have `SUBMISSIONS_REVIEW`; only `SUPER_ADMIN` has `COMPETITION_CONFIG`.

### admin_roles

Future design only; Phase 3E-B1 does not create this table. Current named roles are represented by the `admin_role` enum and permissions are defined in code.

Columns: `admin_role_id` PK, `name unique`, `permissions jsonb`, `created_at`, `updated_at`.

### admin_user_roles

Future design only; Phase 3E-B1 does not create this table. Each current `admin_users` row has one enum role.

Columns: `admin_user_id` FK, `admin_role_id` FK, `created_at`.

PK: `(admin_user_id, admin_role_id)`.

### audit_logs

Purpose: immutable admin/security history.

Columns: `audit_log_id` PK, `admin_user_id` FK nullable, `action`, `entity_type`, `entity_id`, `before jsonb`, `after jsonb`, `request_id`, `created_at`.

Indexes: `(admin_user_id, created_at desc)`, `(entity_type, entity_id)`.

### feature_flags

Purpose: backend-controlled feature flags.

Columns: `feature_flag_id` PK, `key unique`, `enabled boolean`, `scope`, `metadata jsonb`, `created_at`, `updated_at`.

### Future Chat Tables

- `chat_conversations`
- `chat_members`
- `chat_messages`

Do not implement until social/realtime phase.

## Relationship Summary

- `users 1 -> 1 players` for first release.
- `players 1 -> many player_puzzles`, `submissions`, ledgers, missions, inventory, coupons, notifications, activity.
- `puzzles 1 -> many player_puzzles`, `submissions`, `leaderboard_entries`.
- `submissions 1 -> many submission_reviews`, `1 -> 0/1 submission_reward_grants`.
- `missions 1 -> many mission_rules`, `mission_rewards`, `player_mission_progress`.
- `reward_definitions` powers store, inventory, mission rewards, wheel rewards.

## Phase 3D Implemented Tables

Migration `0003_phase_3d_submissions.sql` adds schema only.

`video_uploads` stores player ownership, provider/public ID, declared file metadata, authoritative verified bytes/duration, `SIGNED|COMPLETE|FAILED|EXPIRED` lifecycle state, expiry/completion times, and a non-sensitive failure code. Public IDs are unique; player/status and expiry are indexed.

`submissions` stores player, active ownership, canonical puzzle and `level_id`, positive millisecond completion time, one verified video upload, review status, timestamps, optional legacy Wix ID, and optional player-scoped idempotency key. A unique video upload constraint prevents reuse. Player/status, puzzle/status, level/status, and ownership indexes support future review and listing queries.

## Phase 3E-A Implemented Tables

Migration `0004_phase_3e_a_competition_configuration.sql` changes `puzzles.level_id` and `submissions.level_id` from integer to `NUMERIC(4,1)` and creates `puzzle_competition_settings` plus its category enum, constraints, FK, and indexes. The migration contains schema only and has not been applied.
