# Game Event Model

## Purpose

Game events connect authoritative backend actions and verified ecosystem events to missions, activity history, notifications, future realtime updates, and analytics.

CircZles Player Hub V2 is the gamification engine for the whole CircZles ecosystem, not just the dashboard. Events may originate from `circzles.in`, `dashboard.circzles.in`, commerce systems, review/form systems, and admin workflows.

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

Dashboard events:

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

Website events:

- `website.page_visited`
- `website.gem_found`
- `website.quest_completed`
- `website.review_submitted`
- `website.cta_completed`

Commerce events:

- `order.created`
- `puzzle.purchased`
- `coupon.used`

Review/form events:

- `review.submitted`
- `review.verified`
- `form.submitted`

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
2. Filter by date window, player eligibility, event source, page/action/gem identifiers, puzzle, `level_id`, and other conditions.
3. Increment or recompute progress for the current period key.
4. Mark progress `CLAIMABLE` when target is met.
5. Emit `mission.completed` once per player/mission/period.

Mission claim remains a separate player action unless a mission is configured for auto-claim.

## Website Event Validation

Low-value website missions such as a page visit may record a verified page event when the backend can associate it with an authenticated player session and a valid route/action definition.

Valuable missions must never trust raw browser claims such as:

```json
{ "gemFound": true }
```

For events such as `website.gem_found`, `website.quest_completed`, and `website.review_submitted`, the backend must validate:

- authenticated player
- valid mission/event definition
- valid page/gem/action identifier
- eligibility and date window
- whether already completed
- idempotency key or deterministic completion key
- source-system proof where applicable

Review missions should eventually be verified from the real review/form/order system rather than from a dashboard or website button click alone.

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

## Phase 3F-A Implementation

The durable stream is now implemented with extensible text event types and TypeScript validation for currently supported producers. Event insertion accepts an existing Drizzle transaction so authoritative domain state and its event commit or roll back together.

Current producers emit `puzzle.added`, submission lifecycle decisions, `personal_best.improved`, `points.earned`, `xp.earned`, and `progression.level_up`. PB events require an actual insert/improvement; point events require a new credit; XP events require a new grant. Multi-level XP jumps emit one level-up event per crossed configured progression level.

`processed_at` remains null in Phase 3F-A. Phase 3F-B may lock pending rows, evaluate rules, retry safely, and mark them processed. Browsers have no game-event write endpoint.

## Phase 3F-B Processing

The mission processor now consumes pending events transactionally with row locking and `SKIP LOCKED`. Eligibility and UTC daily/ISO-week periods use event creation time. Flat scalar payload equality is the only conditions language. Progress targets are snapshotted per period.

When progress first reaches its target, the processor emits `mission.completed` once with mission, category, period, and completion time. No reward values are represented as granted. In this phase `processed_at` means the event completed mission evaluation; future activity and notification projectors need independent cursors.
