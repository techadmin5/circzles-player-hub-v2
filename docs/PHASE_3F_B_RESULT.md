# Phase 3F-B Result

## Mission Model

Phase 3F-B adds `missions`, `mission_rules`, `mission_rewards`, and `player_mission_progress`. The MVP permits one active/configured progress rule per mission through a unique `mission_id`; future multi-objective rules can evolve without changing `game_events`. Rewards are configuration previews only and support XP and Synapse Points. No reward is granted in this phase.

Progress is unique per player, mission, and deterministic period key. The first progress row snapshots the rule target, caps progress at that target, and preserves the snapshot if configuration later changes. Historical player, mission, puzzle, and event references use restrictive deletion.

## Evaluation

The processor locks pending events in `created_at, game_event_id` order with `FOR UPDATE SKIP LOCKED`. Each event is processed in its own PostgreSQL transaction. Active rules match event type, optional source type, canonical payload `puzzleId`, fractional `levelId`, and flat scalar JSON equality conditions. Event `created_at`, not processor time, controls eligibility and period assignment.

UTC period keys are `YYYY-MM-DD` for daily, Monday-start ISO `YYYY-Www` for weekly, `lifetime`, and `fixed:{missionId}`. A matching event increments progress once. Crossing the snapshotted target changes status to `CLAIMABLE`, records completion time, and emits one deterministic `mission.completed` event without implying reward delivery. Failures roll back progress and leave the source event pending.

In Phase 3F-B, `game_events.processed_at` means the event completed the current mission-processing pass, including when no mission matched. Future independent projectors require their own cursor rather than relying exclusively on this field.

## Runtime And API

The real backend server starts a lightweight configurable interval runner. In-process ticks cannot overlap; PostgreSQL locks protect multiple instances; errors are logged without crashing HTTP; the interval stops with Fastify. Tests do not start the runner.

Authenticated `GET /api/missions` derives the player from the session and returns currently active mission definitions, authoritative progress or zero-progress defaults, claimability, dates, and reward previews. It exposes no internal player identity. Mission claiming and reward grants remain deferred to Phase 3F-C.

`backend/drizzle/0009_premium_ozymandias.sql` contains schema only and no production mission fixtures. It was successfully applied to the Neon DEVELOPMENT database and verified read-only: `missions`, `mission_rules`, `mission_rewards`, and `player_mission_progress` are present. No production database action occurred.
