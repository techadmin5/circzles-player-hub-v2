# Phase 3C Result: Puzzle Catalog, Code Claiming, And Ownership

## Scope Completed

Phase 3C implemented only the real puzzle catalog, physical code claim, and player puzzle ownership foundation.

No puzzles, submissions, missions, leaderboard, store, admin, Wix, Cloudinary, or production reward features were added.

## Migration Created

`backend/drizzle/0002_premium_invisible_woman.sql`

Creates:

- `puzzle_designs`
- `puzzles`
- `puzzle_claim_prefixes`
- `puzzle_claims`
- `player_puzzles`

Migration `0002` is schema-only. It does not seed production or development puzzle catalog data.

## Physical Code Model

For a code such as:

```text
CC-11-18-R1-001
```

Rules:

- `CC-11-18-R1` is the prefix.
- `001` is the serial.
- The prefix is normalized by trim + uppercase.
- The serial must be digits only and greater than zero.
- The serial is stored as `bigint`.
- `CC-11-18-R1-001` and `CC-11-18-R1-1` are the same physical unit.

The system stores claim prefixes in catalog data and stores physical serials only when claimed.

## Ownership Authority

The browser sends only:

```json
{ "code": "CC-11-18-R1-001" }
```

The backend derives the player from the authenticated session. Request bodies containing player or puzzle authority fields are rejected by schema validation.

The claim transaction:

1. Authenticates the session player.
2. Parses and normalizes the code.
3. Resolves the active prefix to a playable `puzzle_id`.
4. Verifies the physical unit is unclaimed.
5. Verifies the player does not already own that playable puzzle variant.
6. Inserts `puzzle_claims`.
7. Inserts `player_puzzles`.
8. Commits both rows or neither.

Database constraints backstop concurrency:

- Unique active ownership on `(player_id, puzzle_id)`.
- Unique physical claim on `(puzzle_claim_prefix_id, serial_number)`.
- Unique normalized physical code.
- Unique `player_puzzles.puzzle_claim_id` when present.

## Development Seed

`npm run seed:dev` now inserts:

- temporary development progression config
- development player initialization
- temporary development puzzle catalog with two same-name `Metamorphosis` playable variants

`npm run db:migrate` remains schema-only.

## Endpoints

- `GET /api/me/puzzles`
- `GET /api/puzzles/:puzzleId`
- `POST /api/puzzles/claim`

## Frontend Contract

`puzzleService.claimBySku` was replaced with `puzzleService.claimByCode`.

Mock mode remains available. API mode calls the real authenticated backend endpoints with browser session cookies.

## Known Limits

- No production puzzle catalog import exists yet.
- No game-event, mission, submission, leaderboard, reward, Cloudinary, admin, Wix, or commerce logic was implemented.
- Concurrency is protected by transaction ordering and database constraints; this phase did not run a real PostgreSQL concurrent integration test.
