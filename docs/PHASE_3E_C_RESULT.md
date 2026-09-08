# Phase 3E-C Result

Phase 3E-C implements the trusted internal submission-review decision engine and one-time first-completion rewards. Existing admin submission HTTP routes remain read-only.

## First Completion

The first approved solve for `(playerId, canonical puzzleId)` is the only solve eligible for the base completion reward. PostgreSQL enforces this with a unique constraint on `submission_reward_grants(player_id, puzzle_id)`. A later approved solve may participate in future PB processing but cannot receive the base reward again.

Every first approved solve creates an immutable processing record, including when rewards are disabled or zero. This freezes the decision and prevents later settings changes from making an already-processed solve retroactively eligible.

## Reward Authority

Runtime values come only from the persisted `puzzle_competition_settings` row at approval time. An active row with `reward_enabled=true` supplies SP and XP. Missing, inactive, or disabled settings snapshot disabled with zero rewards. Zero reward components do not create zero-value ledger transactions. `mainLevelRewardPreset` is not runtime authority.

Ledger entries use `sourceType=submission.first_completion`, the first approved submission as `sourceId`, canonical puzzle metadata, and deterministic player/puzzle/component idempotency keys.

## Atomicity And Concurrency

The Drizzle review repository executes submission locking, strict review idempotency, review history, status transition, reward snapshot, wallet/progression ledgers, cached state updates, and reward ledger references in one PostgreSQL transaction. The existing Phase 3B ledger implementation was refactored into transaction-aware helpers, preserving row locking, rank calculation, ledger behavior, cache updates, and idempotency without duplicating those algorithms.

The unique player/puzzle reward-grant insert decides concurrent first-completion eligibility. Only the winning transaction credits rewards. Exact reviewer/key/payload replay returns the original result; mismatched key reuse and later conflicting review decisions return controlled conflicts.

## Deferred

`POST /api/admin/submissions/:submissionId/review` intentionally remains absent until Phase 3E-D adds atomic leaderboard/PB effects. Leaderboard storage, ranking, seasons, public player popup, and UI work are not part of Phase 3E-C.

## Migration

Migration `0006_rich_tenebrous.sql` creates `submission_reward_grants` with restrictive foreign keys, nullable ledger references, non-negative reward checks, unique submission identity, and the canonical unique `(player_id, puzzle_id)` guarantee. It is schema-only.

The migration was applied successfully to the Neon development branch on 2026-09-08. Production was not touched and no seed command was run.

Database verification confirmed:

- `submission_reward_grants` exists.
- `synapse_reward >= 0` and `xp_reward >= 0` checks are present.
- All five foreign keys use `ON DELETE RESTRICT`.
- Unique `(player_id, puzzle_id)` is enforced.
- Unique `submission_id` is enforced.

## Verification Status

Automated tests use in-memory transactional fakes and make no external database, Neon, Wix, Cloudinary, or production calls. The concurrency test verifies the model-level uniqueness behavior; real PostgreSQL concurrency has not yet been integration-tested. The Phase 3E-C schema migration itself is now verified on Neon development.

No production migration, seed, Wix change, or `main` branch change occurred.
