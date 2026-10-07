# Reviewed test-player reset before production launch

Production is reported to have exactly 12 disposable test players and migrations through 0020. Their actual UUID/public-ID mapping has not been supplied to this repository. **No production connection, reset, migration, deployment or Hazel account creation was performed.** All execution below is an explicit future operator action.

## Strategy

Keep 0000–0021 unchanged. `0021` remains the correct general sequential-ID migration and works on an empty table. The standalone operator script deletes an exact reviewed test dataset immediately before 0021, applies its actual checked-in statements and inserts its standard SHA-256 hash/timestamp into `drizzle.__drizzle_migrations`, all in ONE transaction. This avoids a production-specific destructive automatic migration and avoids a second reset/restart of an already-live identity sequence. Subsequent normal Drizzle migration runs see 0021 as applied. Do not also run the old backfill rollout first.

Entry point: `backend/src/operations/playerLaunchResetCli.ts`. Implementation/deletion order: `backend/src/operations/playerLaunchReset.ts`. No package startup hook, automatic migration hook or dotenv loading is added. Use the source command from `backend`; the script requires an explicitly set `DATABASE_URL` for the intended target. Do not put the connection string/password in a checked-in file or shell command history.

## Audit and deletion scope

Exact user UUIDs, player UUIDs and current public IDs appear in the saved manifest. It includes the actual verified emails for review, separate exact challenge UUIDs, dependency counts/fingerprints, protected table counts/fingerprints and FK graph. Password hashes, token hashes and OAuth secrets are never printed or included as fields; fingerprints are opaque aggregates computed inside PostgreSQL. Snapshot files contain personal identifiers: store them privately outside Git.

Deletion order (each statement uses the reviewed UUID arrays, never an email pattern, name or date range):

1. `coupon_redemptions`, `coupon_provider_mappings` through owned coupon UUIDs; `reward_wheel_spins`.
2. `inventory_consumptions`, `player_equipment`, `submission_reviews` through submission/reviewer UUIDs; `leaderboard_entries`, `submission_reward_grants`.
3. `mission_claims`, `store_purchases`, `inventory_grants`, `coupon_ownerships`, `player_inventory_items`, `player_mission_progress`, `game_events`.
4. `submissions`, `player_puzzles`, `video_uploads`, `puzzle_claims`, `xp_transactions`, `point_transactions`, `player_progression`, `wallets`.
5. `auth_sessions`, `auth_identities`, `password_credentials`, `auth_challenges` (exact challenge UUIDs), owned `auth_handoff_exchanges`, `wix_identity_links`, `admin_users`, `players`, `users`.

Owned coupon mappings/redemptions are Player Hub records, not storefront configuration. No external Wix/Shopify API is called; externally provisioned test coupons/media are not remotely deleted by this DB script. Unbound handoff rows remain; their replay lifetime is not changed.

Explicitly preserved: `puzzle_designs`, `puzzles`, `puzzle_claim_prefixes`, `progression_levels`, `puzzle_competition_settings`, `missions`, `mission_rules`, `mission_rewards`, `reward_definitions`, `store_listings`, `reward_wheels`, `reward_wheel_spin_tiers`, `reward_wheel_segments`, `auth_rate_limits`, `google_auth_states`, and every other non-reset public table (including any global/business/integration configuration present in production). Protected row counts AND full-row fingerprints, including UUIDs, must match before commit. No TRUNCATE, CASCADE delete, catalog rewrite or production sequence restart is used. No relational social/profile table exists in the audited schema; profile and leaderboard data join player UUIDs. Unknown FK dependents or user-defined triggers block the reset for explicit review.

## Operator procedure

1. Take and verify a restorable database backup BEFORE any reset. Save its restore instructions and identifiers. Pause all writes, background jobs, registrations, OAuth starts, challenge delivery/consumption, gameplay and integration workers. Keep the old backend unavailable until the matching reviewed build is deployed. Wait for live Google authorization states to expire. Restrict registration access so nobody can verify/create a player before Hazel. This is an operator launch gate; no authentication behavior is changed by this branch.
2. With the intended connection securely set, optionally run `docs/player-launch-preflight.sql` for a read-only summary. From `backend`, run:

   ```text
   npx tsx src/operations/playerLaunchResetCli.ts preflight /private/absolute/path/player-launch-reviewed.json
   ```

   Windows: use `npx.cmd` and an absolute Windows path. The file must not already exist; the tool will not overwrite prior evidence. Review all 12 exact UUID pairs/public IDs as the confirmed disposable dataset, the exact challenge IDs, dependency counts and protected data. Save the mapping with the backup. A count of 12 alone does not approve these identities. No actual production mapping is invented or hardcoded here.
3. Preflight fails unless all 12 users have matching players and no extra/unpaired identity exists; 0000–0020 are the exact journal timestamps; 0021, its column and sequence are absent; all known dependencies exist; no unknown FK dependent/trigger exists; no live Google state remains. Unbound challenges must belong to a reviewed identity's exact verified email to be candidates, and deletion still requires their captured UUIDs. Unassociated pending signup challenges block the operation and require separate review; they are never swept away by email heuristics. The manifest exposes every targeted table count and every protected table count/fingerprint.
4. After backup and mapping review, with writes still paused, explicitly run:

   ```text
   npx tsx src/operations/playerLaunchResetCli.ts apply /private/absolute/path/player-launch-reviewed.json --backup-confirmed --writes-paused --reviewed-test-identities
   ```

   These flags are operator attestations, not a substitute for backup/review. The script locks the public tables and journal, recaptures the dataset, and requires exact manifest equality BEFORE deleting anything. A replaced identity, changed dependency row/count, changed protected row/count, added dependency or changed migration history aborts. Reset + 0021 + journal + empty-table/uniqueness/protected-data reconciliation commit together or roll back together. Lock timeout is 10 seconds and statement timeout is 120 seconds; resolve contention rather than bypassing guards.
5. Before signup, run `docs/player-launch-postflight.sql` and:

   ```text
   npx tsx src/operations/playerLaunchResetCli.ts postflight /private/absolute/path/player-launch-reviewed.json
   ```

   All owned player/account/dependency rows must be zero. Unbound handoff records survive. Journal must include 0021, both unique indexes must exist, and sequence state must be `last_value=1, is_called=false`: next allocation is 1. The audit does NOT call `nextval()`. Every protected row/fingerprint must match preflight. Keep writes paused if any check fails.
6. Manually deploy the reviewed matching backend/frontend. Keep general registration closed while the operator uses the production native signup page with **hazel@theqwertyink.com** and a private password: signup → verification email → open verification link → normal verified account/player creation → `hazel_001`. No SQL inserts or plaintext password files are needed. Pending signup itself does not consume a player number. Do not permit competing native verification, Google login or Wix handoff to create a player first. If any competing allocation/failure consumes 1, stop and review; never reset numbers on a live player table to force Hazel's ID.
7. Run `docs/player-launch-hazel-verification.sql`. It asserts exactly one player, the exact verified email, number 1, `hazel_001`, a non-null typed UUID and an existing password credential without exposing its hash. Then reopen normal access. Later numbers have minimum three-digit padding and continue beyond 999; sequence gaps remain normal and numbers are immutable/non-reusable.

## Recovery

Before commit, any error rolls back deletion, DDL and journal insertion. If a post-commit problem requires recovery, keep writes stopped and restore the complete verified pre-reset backup, including the Drizzle journal, into a separate target first; validate saved UUID/public-ID mapping, dependent data and 0020 state, then use the reviewed operator cutover plan. Do not reconstruct passwords/accounts by SQL, restore only players, or reset a live sequence. After real registrations, restoring the old backup loses those new accounts: reconcile new data in a separately reviewed recovery plan. Re-running `apply` after success fails closed because 0021/sequence already exist.

## Validation

Tests apply real historical migrations and the operator reset only on ephemeral embedded PostgreSQL. They cover reviewed dataset drift, explicit UUID targeting, dependencies with restrictive FKs, protected catalog/config UUID preservation, rollback of deletion/DDL/journal, empty-sequence allocation, normal Hazel verification/hashed credential creation, second allocation, gaps and concurrent uniqueness. Existing shell/Hub/ID architecture tests remain unchanged.

Validation completed: backend `npm test -- --maxWorkers=2` passed 756 tests across 41 files; backend lint, typecheck and build passed. Frontend `npm test` passed 88 tests; frontend lint and build passed. An earlier test run concurrent with both builds hit existing five-second native-auth test timeouts; rerunning without the competing builds passed without changing their timeouts or authentication code.
