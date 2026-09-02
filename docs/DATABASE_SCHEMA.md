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

### puzzles

Purpose: canonical puzzle catalog.

Columns: `puzzle_id` PK, `legacy_wix_id`, `name`, `sku`, `level_id int`, `artwork_object_key`, `description`, `status`, `created_at`, `updated_at`, `deleted_at`.

Rules: `level_id` is puzzle difficulty. Do not rename to `levelNumber`.

Constraints: unique `sku`, CHECK `level_id > 0`.

Indexes: `puzzles(level_id)`, `puzzles(sku)`, `puzzles(legacy_wix_id)`.

### player_puzzles

Purpose: puzzle ownership.

Columns: `player_puzzle_id` PK, `player_id` FK, `puzzle_id` FK, `legacy_wix_id`, `source`, `status`, `claimed_at`, `created_at`, `updated_at`, `deleted_at`.

Constraints: unique active ownership on `(player_id, puzzle_id)`.

Indexes: `player_puzzles(player_id)`, `player_puzzles(puzzle_id)`.

### submissions

Purpose: player solve attempts.

Columns: `submission_id` PK, `player_id` FK, `player_puzzle_id` FK, `puzzle_id` FK, `level_id int not null`, `claimed_completion_ms int`, `video_object_key`, `video_upload_id` FK nullable, `status`, `submitted_at`, `created_at`, `updated_at`, `legacy_wix_id`, `idempotency_key`.

Rules: `level_id` is copied from referenced puzzle at creation/recovery for historical query stability.

Constraints: CHECK completion time > 0 when submitted, unique `idempotency_key` when present.

Indexes: `submissions(player_id, status)`, `submissions(puzzle_id, status)`, `submissions(level_id, status)`, `submissions(player_puzzle_id)`.

### video_uploads

Purpose: object storage metadata.

Columns: `video_upload_id` PK, `player_id` FK, `storage_provider`, `bucket`, `object_key`, `mime_type`, `size_bytes`, `duration_ms`, `checksum`, `status`, `created_at`, `completed_at`, `expires_at`.

### submission_reviews

Purpose: admin review history.

Columns: `submission_review_id` PK, `submission_id` FK, `reviewer_admin_user_id` FK, `decision`, `review_note`, `created_at`, `idempotency_key`.

Constraints: unique `idempotency_key`; one approved reward-processing record per submission via `submission_reward_grants`.

### submission_reward_grants

Purpose: idempotency guard for approval awards.

Columns: `submission_reward_grant_id` PK, `submission_id` FK unique, `point_transaction_id` FK nullable, `xp_transaction_id` FK nullable, `leaderboard_entry_id` FK nullable, `created_at`.

### leaderboard_entries

Purpose: best approved result for a player within a puzzle/season scope.

Columns: `leaderboard_entry_id` PK, `player_id` FK, `puzzle_id` FK, `level_id int`, `season_id` FK nullable, `best_submission_id` FK, `best_approved_time_ms int`, `rank_status`, `created_at`, `updated_at`, `disqualified_at`.

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

### player_progression

Purpose: current cached XP progression state.

Columns: `player_progression_id` PK, `player_id` FK unique, `total_xp bigint`, `progression_level int`, `rank_name`, `updated_at`.

Consistency: updated transactionally with `xp_transactions`.

### point_transactions

Purpose: immutable Synapse Point ledger.

Columns: `transaction_id` PK, `player_id` FK, `amount int`, `direction`, `reason`, `source_type`, `source_id uuid`, `balance_after int`, `metadata jsonb`, `idempotency_key`, `created_at`.

Constraints: `amount > 0`, direction CHECK CREDIT/DEBIT/CORRECTION, unique `idempotency_key`.

Indexes: `(player_id, created_at desc)`, `(source_type, source_id)`.

### wallets

Purpose: cached current Synapse Point balance.

Columns: `wallet_id` PK, `player_id` FK unique, `balance int`, `updated_at`.

Consistency: only updated in same transaction as `point_transactions`; ledger remains source of truth.

### xp_transactions

Purpose: immutable XP ledger.

Columns: `xp_transaction_id` PK, `player_id` FK, `amount int`, `reason`, `source_type`, `source_id uuid`, `total_xp_after bigint`, `idempotency_key`, `created_at`, `metadata jsonb`.

Constraints: `amount > 0`, unique `idempotency_key`.

Indexes: `(player_id, created_at desc)`, `(source_type, source_id)`.

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

Purpose: admin account linkage.

Columns: `admin_user_id` PK, `user_id` FK unique, `status`, `created_at`, `updated_at`.

### admin_roles

Purpose: named permission bundles.

Columns: `admin_role_id` PK, `name unique`, `permissions jsonb`, `created_at`, `updated_at`.

### admin_user_roles

Purpose: admin role assignments.

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
