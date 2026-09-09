# Phase 3F-A Result

## Durable Game Events

Phase 3F-A adds the append-only `game_events` stream. Each row has `game_event_id`, required `player_id`, `event_type`, `source_type`, `source_id`, JSONB `payload`, required `idempotency_key`, database-generated `created_at`, and nullable `processed_at`. The player foreign key uses `ON DELETE RESTRICT`; `(player_id, idempotency_key)` is unique.

Indexes support player history, event-type history, and future pending-event processing. `processed_at = NULL` means the event is pending future Phase 3F-B mission/activity processing. Phase 3F-A does not mark events processed.

## Producers And Atomicity

Existing authoritative puzzle claim, submission creation, submission review, personal-best update, point credit, XP grant, and progression transitions now append their required event in the same PostgreSQL transaction. An unexpected event-write failure rolls back the enclosing operation. No best-effort post-commit writes are used.

Implemented events are `puzzle.added`, `submission.created`, `submission.approved`, `submission.rejected`, `submission.resubmission_required`, `personal_best.improved`, `points.earned`, `xp.earned`, and `progression.level_up`.

Personal-best events are emitted only when an approved submission inserts or improves the canonical player/puzzle PB. Point events are emitted only for new positive credits, never debits or replays. XP events are emitted only for new positive XP ledgers. A multi-level XP jump emits one deterministic `progression.level_up` event for every crossed configured progression level.

## Idempotency And Safety

Event keys are deterministic and player-scoped by the database constraint. They are based on canonical puzzle, submission, review, point transaction, XP transaction, and crossed progression identities. Replays return the existing event rather than appending another row.

Payloads contain canonical IDs and mission-relevant server-derived facts only. They exclude sessions, credentials, secrets, email, physical claim-code plaintext, and private reviewer identity. There is no public game-event write or history API.

## Migration Status

`backend/drizzle/0008_blue_doctor_strange.sql` was applied to Neon DEVELOPMENT after Phase 3F-A. Read-only verification confirmed the `game_events` table, its player-scoped idempotency unique index, and its player foreign key. Production remained untouched.
