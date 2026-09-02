# Game Event Model

## Purpose

Game events connect authoritative backend actions to missions, activity history, notifications, future realtime updates, and analytics.

## Event Table

Use `game_events` as an internal append-only stream:

- `game_event_id`
- `player_id`
- `event_type`
- `source_type`
- `source_id`
- `payload`
- `idempotency_key`
- `created_at`
- `processed_at`

## Event Types

Core events:

- `player.login`
- `profile.completed`
- `puzzle.added`
- `submission.created`
- `submission.approved`
- `submission.rejected`
- `submission.resubmission_required`
- `personal_best.improved`
- `leaderboard.rank_changed`
- `mission.completed`
- `mission.claimed`
- `points.earned`
- `points.spent`
- `xp.earned`
- `progression.level_up`
- `wheel.spun`
- `store.purchase`
- `coupon.earned`
- `coupon.expiring`
- `badge.unlocked`
- `frame.equipped`
- `friend.requested`
- `friend.added`
- `season.starting`
- `season.ending`

## Event Processing

1. Domain service completes authoritative operation in a transaction.
2. Service inserts one or more `game_events` rows with idempotency keys.
3. Mission evaluator processes matching events.
4. Activity projector materializes user-facing `activity_events`.
5. Notification projector creates `notifications` where appropriate.
6. Future realtime publisher can broadcast selected events after commit.

## Mission Evaluation

Mission definitions are data-driven:

- `missions` stores title/category/date/reset/status.
- `mission_rules` stores event type, target count, optional `puzzle_id`, optional `level_id`, optional completion threshold, and JSON conditions.
- `mission_rewards` stores reward grants.
- `player_mission_progress` stores progress and claim state.

When a game event occurs:

1. Find active missions whose rules match `event_type`.
2. Filter by date window, player eligibility, puzzle, `level_id`, and other conditions.
3. Increment or recompute progress for the current period key.
4. Mark progress `CLAIMABLE` when target is met.
5. Emit `mission.completed` once per player/mission/period.

Mission claim remains a separate player action unless a mission is configured for auto-claim.

## Activity Strategy

Use a hybrid model:

- Financial and XP truth remains in `point_transactions` and `xp_transactions`.
- Reviews, submissions, purchases, and social actions remain in domain tables.
- `activity_events` is a materialized, user-facing timeline generated from domain events.

This avoids expensive timeline unions on every request while preserving authoritative ledgers.

## Idempotency

All event-generating operations should supply deterministic idempotency keys where possible:

- `submission.approved:{submissionId}`
- `mission.claimed:{playerId}:{missionId}:{periodKey}`
- `store.purchase:{requestId}`
- `wheel.spin:{requestId}`
- `puzzle.added:{playerId}:{puzzleId}`

Duplicate events should be ignored or treated as successful replays.
