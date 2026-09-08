# Phase 3E-D Result

Phase 3E-D adds all-time personal-best storage, authenticated leaderboard reads, and the secure admin review mutation now that submission, reward, ledger, and PB effects are atomic.

## Personal Bests

`leaderboard_entries` stores one PB per player and canonical `puzzleId`. It does not store rank, `levelId`, seasons, or visibility. Every approved solve is eligible to insert or improve PB history even when competition settings are missing, hidden, disabled, or later changed.

PB comparison is exact and deterministic: `best_completion_time_ms`, review database `created_at`, submission database `submitted_at`, then submission UUID, all ascending. The conditional PostgreSQL upsert and unique `(player_id, puzzle_id)` constraint safely converge concurrent approvals on the best tuple.

PB processing is separate from the once-per-player/puzzle base reward. A faster later solve may improve PB but cannot repeat the first-completion reward.

## Atomic Review

The existing Phase 3E-C transaction now includes PB processing. Failure rolls back submission status, review history, reward grant, XP/SP ledgers, wallet/progression caches, and leaderboard state. `POST /api/admin/submissions/:submissionId/review` is therefore enabled with server-derived admin identity, `SUBMISSIONS_REVIEW`, required idempotency, and a strict decision/note body.

## Read APIs

`GET /api/leaderboards/catalog` returns explicit `MAIN_LEVEL` and `SIDE_QUEST` navigation for active, leaderboard-enabled settings and active, non-deleted puzzles. `GET /api/leaderboards?puzzleId=<uuid>` returns only the top 10 safe public rows. If the authenticated player is outside the top 10, their actual rank is returned separately; solved top-10 players are flagged in place and unsolved players receive no personal row.

Times are ranked as integer milliseconds and formatted without rounding as `MM:SS.mmm`. No internal player UUID, email, Wix/session/admin data, or invented cosmetic fields are exposed.

## Migration

Migration `0007_organic_cargill.sql` creates `leaderboard_entries` with restrictive FKs, positive completion-time validation, unique player/puzzle identity, and deterministic ranking indexes. It is schema-only and has not been run.

Phase 3E-C migration `0006_rich_tenebrous.sql` was applied and verified on Neon development on 2026-09-08. No Phase 3E-D migration or seed was run.

## Deferred

Frontend leaderboard UI, seasons, country/state/friend scopes, avatars, frames, badges, player popup, Lottie effects, missions, PB bonuses, notifications, chat, Wix integration, and production deployment remain deferred.

## Verification Status

Automated tests use in-memory fakes and make no external calls. PostgreSQL concurrency behavior is enforced by schema uniqueness and atomic upsert design but was not integration-tested against Neon in this implementation phase.
