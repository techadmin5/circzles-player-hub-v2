# Phase 3H Result - Backend-Authoritative Reward Wheel

## Status

Phase 3H-A migration `0015_reflective_karen_page.sql` and Phase 3H-B migration `0016_windy_xorn.sql` are both **APPLIED AND VERIFIED on Neon DEVELOPMENT only**. Neither migration has been applied to Production.

Phase 3H-B implements one free spin plus three escalating paid spins per rolling 24-hour cycle. The controlled DEVELOPMENT smoke spin (`99998f6f-249f-4d0a-be08-80ff41515202`) remains immutable historical audit data; no existing spin was deleted or rewritten.

## Daily Cycle

- Spin 1: free.
- Spin 2: 300 SP.
- Spin 3: 450 SP.
- Spin 4: 700 SP.
- A fifth spin is rejected with `WHEEL_DAILY_LIMIT_REACHED`.
- The first committed free spin establishes `cycleStartedAt` from server time and `cycleEndsAt` from configured positive `cycleSeconds` (default `86400`). Later spins persist the same boundaries. At or after expiry, the next committed spin starts a new free cycle even when paid spins from the prior cycle were unused.

Active tier configuration is persisted in `reward_wheel_spin_tiers`, must contain exactly four contiguous tiers beginning with a zero-cost spin 1, and is not exposed to the browser beyond the next authoritative cost/state. Invalid configuration fails with `WHEEL_CONFIGURATION_INVALID` before economy or reward writes.

## Authority And Atomicity

`GET /api/wheel` returns server-derived cycle boundaries, spins used/remaining, next spin number/cost/free status, wallet affordability, and safe segment presentation. The browser never derives tier eligibility, affordability, or free-spin state.

`POST /api/wheel/spin` retains authentication, strict empty body, required player-scoped idempotency key, backend weighted RNG, and backend reward selection. One transaction takes the player wheel advisory lock, resolves replay first, validates configuration, resolves the cycle/tier, locks the wallet, debits the exact tier cost when nonzero, grants the reward, stores immutable snapshots, and emits `reward_wheel.spun`. Free spins create no zero-value point transaction. Same-key replay returns the original reward, charge, spin number, cycle timestamps, and balance after configuration changes or cycle expiry.

## Frontend

API mode renders `Free Spin`, `Spend 300/450/700 SP to Spin`, or the disabled `Next Free Spin in HH:MM:SS` state from backend status. Insufficient balance keeps the exact intended cost visible and explains the requirement. Status is refetched after each confirmed spin. The limit countdown is presentational only; reaching zero refetches the backend and never unlocks locally. Existing wheel animation, reveal, audio, idempotency-key retry, and reduced-motion behavior remain intact.

## Migration Safety

`0015_reflective_karen_page.sql` is unchanged. `0016_windy_xorn.sql` adds the tier table, positive wheel cycle length, and nullable tier/spin/cycle snapshots required to preserve existing `0015` rows. It contains no DROP, DELETE, UPDATE, INSERT, or permanent configuration data. All new foreign keys use restrictive deletion.

Neon DEVELOPMENT verification confirmed the tier table, `cycle_seconds`, all four new spin columns, the tier uniqueness index, five new checks, and two restrictive foreign keys. The migration contained zero tier rows before temporary DEVELOPMENT configuration, preserved the historical Phase 3H-A spin, and set the DEVELOPMENT smoke wheel cycle to `86400` seconds.

## Development Runtime Verification

Authenticated runtime verification used player `CZ-8F42KD` (`Smokey_OP`) and the temporary DEVELOPMENT tier schedule `0 -> 300 -> 450 -> 700` SP.

- Spins 1 through 4 committed with spin numbers `[1,2,3,4]`, charged costs `[0,300,450,700]`, and resulting balances `[2362,2063,1614,915]`. Each awarded 1 SP.
- The free spin established `cycleStartedAt = 2026-09-16T13:12:15.137Z` and `cycleEndsAt = 2026-09-17T13:12:15.137Z`; all three paid spins retained those exact boundaries.
- A fifth spin using a new idempotency key was rejected with `WHEEL_DAILY_LIMIT_REACHED` and created no `reward_wheel_spins` row.
- Locked `GET /api/wheel` reported four of four spins used, zero remaining, null next spin/cost, `nextSpinIsFree = false`, `canSpin = false`, and retained the authoritative cycle end.
- Reconciliation confirmed three paid debit links totaling 1450 SP, four reward credit links totaling 4 SP, four `reward_wheel.spun` events, one shared cycle start/end, and zero rejected-fifth-spin rows.
- Temporary runtime funding was reconciled through two funding transactions, restoring the final wallet balance to exactly 361 SP.
- Historical spin `99998f6f-249f-4d0a-be08-80ff41515202` remains preserved.

## Automated Verification

Backend tests cover the intended `0/300/450/700` schedule, invalid configuration, free-spin no-debit behavior, all paid tiers, maximum enforcement, cycle boundaries/expiry, unused-spin expiry, paid-tier affordability, exact free/paid replay, replay after expiry/configuration changes, serialized first/final-spin races in the deterministic in-memory harness, atomic rollback, SP/XP/Inventory rewards, unique reward exclusion, safe status data, HTTP contracts, and no probability exposure.

The concurrency tests use the repository's deterministic in-memory harness; real PostgreSQL concurrency was not integration-tested. The real DEVELOPMENT runtime verification covered the normal sequential authoritative flow, economy reconciliation, limit enforcement, and audit persistence only.
