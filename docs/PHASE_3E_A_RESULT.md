# Phase 3E-A Result

Phase 3E-A adds the data-model and backend domain foundation for configurable competition navigation and future rewards. It does not implement admin review, reward granting, or leaderboard ranking.

## Fractional levelId

Migration `0004_phase_3e_a_competition_configuration.sql` changes `puzzles.level_id` and `submissions.level_id` from integer to PostgreSQL `NUMERIC(4,1)`. Existing integer values such as 18 and 22 safely become 18.0 and 22.0. Drizzle uses numeric number mode and DTOs return JavaScript `number`, supporting values such as 0.5 and 3.5 without exposing PostgreSQL strings.

`levelId` remains puzzle difficulty/challenge identity. `progressionLevel` remains the separate player XP/RPG progression rank.

## Competition Settings

`puzzle_competition_settings` is unique by canonical `puzzleId` and stores explicit `MAIN_LEVEL` or `SIDE_QUEST` category, leaderboard visibility, display order, reward enablement, SP/XP values, active state, and timestamps. It deliberately does not duplicate `levelId`. Future navigation reads only active, leaderboard-enabled settings joined to active canonical puzzles and orders MAIN_LEVEL before SIDE_QUEST, then by display order.

The internal repository/service supports reading by puzzle, listing navigation settings, and trusted future create/update use. No public or unrestricted mutation endpoint was added.

## Reward Preset

The editable main-level bootstrap preset is:

| Level | SP | XP |
| ---: | ---: | ---: |
| 1 | 300 | 350 |
| 2 | 450 | 500 |
| 3 | 650 | 750 |
| 4 | 900 | 1050 |
| 5 | 1250 | 1500 |
| 6 | 1700 | 2100 |
| 7 | 2250 | 2850 |
| 8 | 3000 | 3800 |
| 9 | 3900 | 5200 |
| 10 | 5000 | 7000 |

This preset is a future admin/bootstrap helper, not permanent runtime logic and not production seed data. No fake Levels 1-10 catalog was created. Side Quest rewards are entirely admin-defined.

## Deferred

Admin submission review, admin configuration routes/UI, reward grants, XP/SP transactions, leaderboard entries, and ranking remain deferred to later Phase 3E work.

## Verification Status

Migration `0004_phase_3e_a_competition_configuration.sql` has not been executed. No Neon migration, seed, production action, deployment, or real Wix data change occurred.
