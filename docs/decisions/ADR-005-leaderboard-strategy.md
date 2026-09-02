# ADR-005: Leaderboard Strategy

## Status

Accepted for backend blueprint.

## Decision

Store approved personal best rows in `leaderboard_entries`; compute ranks by query/cache per scope.

## Rationale

The frontend needs Global, Country, State, Friends, Season, All-Time, Puzzle, and `levelId` filters. Storing every possible filtered leaderboard would duplicate too much state.

## Consequences

Rows use stable `player_id` and `puzzle_id`, never `displayName` or puzzle name. The server returns rank to the frontend.
