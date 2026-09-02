# Wix Migration Plan

## Source Collections

- `Import1` / Puzzles
- `PlayerStats`
- `PlayerPuzzles`
- `Submissions`
- `Leaderboard`
- `PlayerInventory`
- `PlayerCoupons`
- `StoreItems`
- `Levels`

## Migration Principles

- Do not mutate the old Wix production system during extraction.
- Preserve useful legacy IDs as `legacy_wix_id`.
- Preserve existing `publicPlayerId`.
- Normalize `playerid` and `playerId` to one canonical `player_id`.
- Derive missing submission `levelId` from the referenced puzzle's canonical difficulty field.
- Do not invent missing values manually.
- Preserve point balances, inventory, coupons, progression, puzzle ownership, submissions, and leaderboard history where trustworthy.

## Collection Mappings

### Import1 / Puzzles -> puzzles

Map:

- Wix `_id` -> `puzzles.legacy_wix_id`
- puzzle name -> `name`
- SKU/code -> `sku`
- existing puzzle level field -> `level_id`
- image/media -> object storage reference or migrated URL metadata

Validation:

- all active puzzle SKUs unique
- all puzzle records have valid `level_id`

### PlayerStats -> users, players, wallets, player_progression

Map:

- Wix member ID -> `users.wix_member_id`
- public Player ID -> `players.public_player_id`
- display/user name -> `players.display_name`
- country/state -> `players.country/state`
- Synapse Point balance -> initial `point_transactions` plus `wallets.balance`
- XP/progression -> initial `xp_transactions` plus `player_progression`

Initial balance/progression should be inserted as ledger entries with reason `MIGRATION_INITIAL_BALANCE` and `MIGRATION_INITIAL_XP`.

### PlayerPuzzles -> player_puzzles

Known inconsistency: both `playerid` and `playerId` exist.

Transform:

1. Resolve both fields to a canonical source player identifier.
2. Map to V2 `player_id`.
3. Map referenced puzzle to `puzzle_id`.
4. Insert one active ownership row per `(player_id, puzzle_id)`.
5. Preserve original Wix `_id` as `legacy_wix_id`.

Duplicates become migration warnings, not duplicate ownership.

### Submissions -> submissions, video_uploads, submission_reviews

Map:

- Wix `_id` -> `legacy_wix_id`
- player reference -> `player_id`
- puzzle reference -> `puzzle_id`
- completion time -> `claimed_completion_ms`
- status -> V2 `SubmissionStatus`
- video URL/file reference -> `video_uploads` metadata if available
- review notes -> `submission_reviews`

Missing `levelId`:

1. Load referenced puzzle.
2. Read puzzle difficulty level.
3. Store as canonical `submissions.level_id`.
4. If puzzle reference is missing, quarantine the submission for manual review.

### Leaderboard -> leaderboard_entries

Map only trusted approved results. Use stable IDs:

- player -> `player_id`
- puzzle -> `puzzle_id`
- puzzle difficulty -> `level_id`
- best time -> `best_approved_time_ms`
- season if known -> `season_id`

Do not identify players by display name or puzzles by puzzle name.

### PlayerInventory -> player_inventory

Map owned frames, badges, rename cards, special items, and consumables to `reward_definitions` and `player_inventory`.

Preserve quantity and equipped state if source data has it.

### PlayerCoupons -> coupons, player_coupons

Map:

- coupon code -> `coupons.code`
- discount -> `discount_type/value`
- player ownership -> `player_coupons`
- expiry/status/used state -> ownership fields
- Wix coupon ID if present -> `external_wix_coupon_id`

### StoreItems -> store_items, reward_definitions

Map item catalog into reward definitions first, then store item rows with cost and active/sold-out status.

### Levels -> progression_levels

Map player progression configuration only.

Important: Wix `Levels` must be reviewed to distinguish player progression levels from puzzle difficulty levels. Player progression maps to `progression_levels.progression_level`, not puzzle `level_id`.

## Migration Validation

Required checks before cutover:

- Wix player count vs V2 user/player count
- unique public Player IDs preserved
- puzzle count and SKU uniqueness
- total puzzle ownership count after duplicate normalization
- submission count
- approved submission count
- submissions missing `level_id` after derivation equals zero, excluding quarantined records
- total point balances by player
- total XP/progression mapping by player
- inventory ownership counts
- coupon counts and active/expired/used status counts
- leaderboard entry counts and best-time spot checks
- sample player full-history reconciliation

## Cutover Strategy

1. Build V2 backend in staging.
2. Run initial migration from Wix export.
3. Perform parallel verification while old Wix system remains live.
4. Fix mapping errors and rerun idempotent migration.
5. Announce short old-system write freeze.
6. Run delta/final migration.
7. Validate counts and critical player samples.
8. Switch Player Hub link to V2.
9. Monitor logs, point balances, submissions, and support reports.
10. Retain Wix backup temporarily.

## Migration Risks

- Ambiguous `playerid` vs `playerId` records.
- Submissions with missing or broken puzzle references cannot derive `levelId`.
- Duplicate public Player IDs must be quarantined.
- Wix media/video URLs may not be durable or private enough for V2.
- Existing leaderboard rows may have been computed from inconsistent historical data.
- Coupon records may represent game ownership, Wix checkout coupons, or both.
