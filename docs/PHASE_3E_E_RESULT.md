# Phase 3E-E Result

## Scope

Phase 3E-E connects the existing player leaderboard page to the Phase 3E-D leaderboard APIs. This phase changes frontend integration and presentation only. It does not change backend behavior, database schema, migrations, seed data, or authority boundaries.

## API Integration

In API mode, the browser requests:

- `GET /api/leaderboards/catalog`
- `GET /api/leaderboards?puzzleId=<canonical UUID>`

The existing API request infrastructure supplies `credentials: "include"`, so the backend derives the current player from the browser session. The frontend does not send a player ID. The leaderboard page remains a server component; its small `LeaderboardExplorer` client island owns authenticated catalog and leaderboard requests.

## Competition Selection

The page exposes exactly two category tabs:

- Levels, sourced from `MAIN_LEVEL`
- Side Quests, sourced from `SIDE_QUEST`

Category membership is explicit and is never inferred from a fractional `levelId`. Catalog order is preserved. Every selectable competition is identified and requested by its canonical `puzzleId`, allowing multiple puzzle variants to share a name or level safely.

The first main level is selected initially. If there are no main levels, the first side quest becomes the initial selection. Fractional side-quest levels are displayed without coercion.

## Rankings

The selected board displays the authoritative Top 10 response with rank, display name, and formatted best time. The Top 3 receive static visual emphasis. A Top-10 current player is highlighted in place with a subtle You indicator.

When `currentPlayerEntry` is present, the player is shown separately under Your Rank using the exact rank returned by the backend. The frontend does not manufacture rank 11 or any other fallback rank. Unsolved players receive no synthetic standing.

Leaderboard rows do not link to profiles and do not expose internal player UUIDs. Authoritative avatar and equipped-frame fields do not exist in this API contract, so this implementation does not fabricate either value. A richer neutral profile treatment remains deferred with the profile work.

## Request States

Catalog and individual leaderboard requests have separate loading, friendly error, and retry states. In-flight requests are aborted when a selection changes or the component unmounts, preventing stale responses from replacing the latest selection.

Empty states cover:

- no leaderboard challenges
- an empty Levels or Side Quests category
- a selected board with no ranked solves

The category controls use tab semantics, and puzzle controls are semantic buttons with selected state.

## Data Modes

`NEXT_PUBLIC_DATA_MODE=api` uses the real browser-authenticated endpoints and treats backend rank, time, and current-player fields as authoritative.

Mock mode adapts the existing local data to the same catalog and response DTOs. It includes multiple main levels, a fractional side quest, Top-10 rows, and an in-place current-player highlight. Existing Hub and UI Lab previews retain their previous mock-only contract.

## Deferred Work

- Public player popup is deferred to Phase 3E-F.
- Lottie podium and glow treatments are deferred to Phase 3E-G.
- Authoritative avatar and frame integration is deferred until those profile systems exist.

No database migration was created or run.
