# Phase 3F-C Result

## Mission Claim Authority

Phase 3F-C implements authenticated `POST /api/missions/:missionId/claim`. The backend derives the player from the session and the current period from server time. The request requires a bounded `Idempotency-Key` and accepts no browser authority for player identity, period, progress, or reward amounts.

The repository validates a currently available mission, locks the current player progress row, requires `CLAIMABLE`, and reads only active persisted reward rows. Positive XP and Synapse Point rows are aggregated and snapshotted; empty, unsupported, non-positive, or oversized configurations fail closed.

## Atomic Grant And Idempotency

One PostgreSQL transaction creates the immutable `mission_claims` row, grants XP/SP through existing game-state ledgers with source type `MISSION_REWARD`, stores ledger references, marks progress `CLAIMED`, and emits `mission.claimed`. Any failure rolls back every claim, ledger, cache, progress, and event change.

Claim keys are player-scoped. An exact same-key retry returns the existing result without another grant; reusing a key for another mission returns `IDEMPOTENCY_CONFLICT`. Unique progress and player/mission/period constraints prevent a different key from claiming the same completion twice. Deterministic ledger and event keys add defense in depth.

## Migration And Verification

Migration `backend/drizzle/0010_medical_gideon.sql` creates `mission_claims`, restrictive foreign keys, non-negative reward checks, uniqueness guards, and the player claim-history index. It contains no drops and no seed data. It was successfully applied to Neon DEVELOPMENT.

The preceding `0009_premium_ozymandias.sql` migration was successfully applied to Neon DEVELOPMENT and verified read-only before this phase. No production database action occurred. Phase 3F-C automated tests use in-memory/fake repositories and make no external calls.

Development runtime verification used player `CZ-8F42KD` and a temporary claimable mission. The player moved from 722 XP / 361 SP to 723 XP / 362 SP. The first claim returned `idempotent=false`; exact replay returned `idempotent=true` with the same `missionClaimId` and canonical `claimedAt`. The temporary mission, rule, and rewards were disabled afterward. Immutable claim, ledger, and audit history intentionally remains. Production and Wix were untouched.
