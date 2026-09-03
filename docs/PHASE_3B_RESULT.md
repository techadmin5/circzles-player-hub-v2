# Phase 3B Result: Progression, XP, and Synapse Points

## Scope Implemented

Phase 3B implements only:

- Real player progression state
- XP ledger
- Synapse Points wallet
- Synapse Points ledger
- `GET /api/me` integration for real `progressionLevel`, `rank`, `xp`, `xpNeeded`, and `synapsePoints`

No puzzle, submission, mission, store, wheel, inventory, leaderboard, social, notification, admin, Wix SSO, or Cloudinary systems were implemented.

## Migration

New migration:

```bash
backend/drizzle/0001_fair_silk_fever.sql
```

Run against Neon:

```bash
cd backend
npm run db:migrate
```

The migration creates the Phase 3B tables and seeds all nine current rank names with temporary configuration values. These progression thresholds and rewards are development/configuration placeholders, not final business rules.

## Tables Created

- `progression_levels`
- `player_progression`
- `xp_transactions`
- `wallets`
- `point_transactions`
- `point_transaction_direction` enum

Phase 3A tables remain intact and were not recreated.

## Domain Operations

Implemented through backend domain services:

- `seedProgressionLevels`
- `ensurePlayerGameState`
- `getPlayerGameState`
- `grantXp`
- `creditPoints`
- `debitPoints`

XP and point changes are append-only ledger operations with cached state updates inside the same transaction in the Drizzle repository.

## Endpoints

Changed:

- `GET /api/me`
- `POST /api/dev/login`

Both now ensure player game state exists and return DB-backed progression/economy fields.

Development-only endpoints added:

- `POST /api/dev/xp/grant`
- `POST /api/dev/points/credit`
- `POST /api/dev/points/debit`

These endpoints are disabled in production, derive the player from the authenticated session, and reject request bodies that try to select `playerId`, `internalId`, or `publicPlayerId`.

## What Is Real

- Current player XP
- Current player progression level and rank
- Next XP threshold returned as `xpNeeded`
- Current Synapse Points balance
- XP ledger records
- Synapse Points ledger records
- Idempotency for XP and points
- Idempotent player game-state initialization

For maximum rank, `xpNeeded` returns the current total XP as a stable value because there is no later threshold.

## What Remains Mocked

- Puzzles and puzzle ownership
- Submissions and review workflow
- Missions and game events
- Store, inventory, coupons, and wheel
- Leaderboards and placement badges
- Achievements
- Streaks
- Cosmetic frames/avatar storage
- Admin systems
- Wix SSO and Cloudinary uploads

## Verification

Recommended local checks:

```bash
npm run lint
npm run build
cd backend
npm run lint
npm run typecheck
npm test
npm run build
```

After migrating and seeding against Neon:

```bash
cd backend
npm run db:migrate
npm run seed:dev
npm run dev
```

Then authenticate through `POST /api/dev/login`, verify `GET /api/me`, and optionally exercise the development-only grant routes.
