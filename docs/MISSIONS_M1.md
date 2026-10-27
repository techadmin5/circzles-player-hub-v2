# Missions M1: lifecycle, earned rewards and chest foundation

Current release status (2026-10-24): this document describes the original M1 foundation. M2 administration/player/chest features now exist locally. The approved initial-release chest template is **Daily 50 XP / 100 SP; Weekly 200 XP / 250 SP**, with separate recorded per-configuration approvals still required. The older figures below are historical provisional examples, not current defaults. See [the consolidated release review](MISSIONS_RELEASE_CANDIDATE.md) and [M2](MISSIONS_M2.md). No production release is implied.

This branch adds backend infrastructure only. It does not configure or activate missions or chests, seed rewards, build an admin editor, or change the player Missions screen. Planned Daily (five available, any three completed, 25 SP + 20 XP) and Weekly (six available, any four completed, 100 SP + 75 XP) configurations are examples, not seeds or hardcoded eligibility rules.

## UTC lifecycle

Daily periods are `[00:00 UTC, next 00:00 UTC)`; weekly periods are ISO Monday-to-Monday. ISO week-year keys are validated against their actual boundaries. `periodBounds`, `periodKeyFor` and `claimDeadlineFor` are deterministic. Original trusted `game_events.created_at` determines progress attribution, including delayed processing. Lifetime uses `lifetime`; fixed campaigns require explicit UTC start/end and use `fixed:<missionId>`.

Daily/weekly earned rewards expire at period end plus 24 hours, with the deadline excluded. A shortened mission availability window stops new completions but does not shorten that period's earned claim grace. Lifetime rewards have no automatic deadline; an explicitly configured deadline is respected. Fixed rewards likewise have no invented deadline; administrators may explicitly configure a deadline at/after campaign end. Inactive definitions stop new progress; previously earned snapshots remain payable until their frozen deadline. Deactivation does not revoke earned rewards.

Expiry is derived from the frozen deadline, independent of polling schedules. An expired claim returns HTTP 410 and records `expired_at` as that deadline in a committed transaction without reward writes. List endpoints omit expired prior periods. No cron reset, destructive reset, or historical reprocessing occurs.

## Earned reward safety

On the first qualifying completion, the original event transaction freezes a versioned reward envelope, period boundaries and claim deadline. Only positive integer XP/SP amounts are payable in M1; totals must fit PostgreSQL integer limits. Mission targets are frozen when progress starts. Later definition/reward edits cannot change earned payouts. Database triggers reject changes to earned snapshots, identity, target and lifecycle fields.

Claims lock player-owned progress and use ledger idempotency keys, unique player/definition/period constraints and per-player request-key locks. Reward ledgers, claim record, progress status and the claim event commit together. A fresh key cannot pay twice. Successful retries return the original award and current authoritative player state, even after expiry. Reusing an explicit-period request key for another period conflicts. A legacy completed record without a reward snapshot fails closed; M1 never fabricates a historical snapshot or backfills it.

The JSONB envelope is `{ "version": 1, "rewards": [{ "type": "XP", "amount": 20 }] }`. A future envelope version may reference validated real inventory reward definitions (FRAME/BADGE/AVATAR and a supported title/tag type), with atomic inventory grant ledgers. M1 does not accept these payouts, issue placeholders or fabricate IDs.

## Chest model and eligibility

`mission_chests` stores inactive-by-default definitions, DAILY/WEEKLY period, positive target, availability window, activation effective time and configured reward envelope. `mission_chest_eligibility` uniquely associates chest/mission with explicit activation/effective time. Category and period must agree. Configuration validation rejects unsupported periods, invalid windows/rewards, mismatched or inactive associations, and insufficient eligible definitions.

`player_mission_chests` stores player/definition/period progress, frozen target, period/deadline and unlock snapshot. `mission_chest_completions` persists distinct mission IDs, original qualifying event ID, player mission progress ID, completion timestamp, eligibility relationship ID and effective timestamp. Provenance cannot be edited/deleted. Unique chest-progress/mission prevents duplicate counting. Progress caps at target, while additional eligible completion provenance can still be recorded.

Chest progress is updated directly inside the qualifying mission completion transaction; arbitrary `mission.completed` events are never counted. Eligibility, mission/chest activation, UTC period and source completion are checked. No historical scan occurs when eligibility is added or activated. Daily missions cannot feed weekly chests. Mission reward claims never advance chest progress. Unlock grants nothing; a separate manual claim uses the frozen rewards and a 24-hour post-period deadline, with XP/SP ledger references and a dedicated `mission.chest_claimed` event. Earned chest rewards survive later deactivation/configuration edits.

## Authenticated player API

All identities come from the authenticated session. Responses are private/no-store. No frontend/backend implementation imports are required.

| Endpoint | Contract |
|---|---|
| `GET /api/missions` | Existing current-period DTO contract; earned reward previews use snapshots. |
| `POST /api/missions/:missionId/claim` | Existing empty body + Idempotency-Key; selects current period. |
| `GET /api/missions/periods` | `{ missions: [...] }`: current missions plus earned, unclaimed prior periods still within grace; records include missionId, periodKey, status, progress, rewards and claimDeadline. |
| `POST /api/missions/:missionId/periods/:periodKey/claim` | Explicit period, empty body, required Idempotency-Key. URL-encode fixed keys. Existing claim response with original periodKey, award and playerState. |
| `GET /api/mission-chests` | `{ chests: [...] }`: current available definitions plus unclaimed unlocked prior periods within grace. Each has chestId, title, periodType, periodKey, progress, periodStartsAt/periodEndsAt, claimDeadline, status, claimable and configured/frozen reward envelope. |
| `POST /api/mission-chests/:chestId/periods/:periodKey/claim` | Explicit period, empty body, required Idempotency-Key. Returns chestClaimId, chestId, periodKey, CLAIMED status, idempotent flag, claimedAt, awarded `{xp,synapsePoints}`, playerState. |

New consumers must identify cards and retry keys by `(definitionId, periodKey)`, not definition ID alone. Claim errors include `MISSION_NOT_CLAIMABLE`/`CHEST_NOT_CLAIMABLE` (409), `MISSION_ALREADY_CLAIMED`/`CHEST_ALREADY_CLAIMED` (409), deadline expiry (410), and key conflict (409). A claim never accepts browser reward amounts, eligibility, player ID or completion status. The original page remains unchanged; prior-period cards and chest controls belong to a later frontend phase.

## Processor recovery

Each event is committed atomically. A database advisory lock serializes event selection across server instances; event row locks and transactional `processed_at` prevent duplicate increments after restart. This favors predictable safety over parallel throughput. The runner prevents local overlapping ticks and logs sanitized failures.

Nested savepoints isolate invalid mission/chest configurations. `mission_processing_failures` records event/entity IDs and a safe error code; healthy unrelated definitions continue. The event is marked processed with explicit failure provenance, not silently dropped. Fixing configuration does not automatically replay failed historical matches. A future operator recovery workflow must review affected event/definition IDs and authorize any replay separately.

Unexpected event failures roll back all progress. `mission_event_attempts` stores exponential retry delays (2, 4, 8, 16 seconds), with quarantine on the fifth failure. Quarantined events retain null `processed_at`; unrelated eligible events proceed. Restarts honor persisted delays/quarantine. If the database is unavailable before event selection or while persisting retry state, no event is acknowledged; the runner logs and retries on a later tick. Inspect both diagnostics tables and queue age; no diagnostic admin dashboard/release-quarantine API is included.

Mission completion/claim/chest-claim event types cannot be rule triggers. Mission/chest reward-sourced XP/SP and progression events are excluded through payload source and authoritative XP-ledger source lookup. Ordinary existing XP/SP events remain usable. This prevents rewards feeding back into mission/chest progression.

## Migration and rollout review

Apply existing migrations through 0025 first, then **0026_missions_lifecycle_chests.sql**, using the normal transactional Drizzle migrator. It adds:

- `missions`: activation_effective_at (default migration time for existing definitions), claim_deadline.
- `player_mission_progress`: reward_snapshot, period_starts_at, period_ends_at, claim_deadline, expired_at (nullable; no historical updates).
- Seven tables: mission_chests, mission_chest_eligibility, player_mission_chests, mission_chest_completions, mission_chest_claims, mission_event_attempts, mission_processing_failures.
- Foreign keys; unique association/provenance/player-period/request-key constraints; positive/capped target, valid chest period/window and bounded attempt checks; player lookup indexes.
- Triggers freezing earned snapshots/provenance and advancing activation/effective timestamps on inactive-to-active transitions.

There are no INSERT seeds, destructive DDL, UPDATE backfills or balance/ownership/submission/competition writes. Existing inactive mission defaults conservatively prevent pre-migration pending events being awarded after activation.

**Coordinated rollout is required:** pause old mission workers/claims, review existing earned records for missing snapshots (without inventing payouts), apply the additive migration, then deploy M1 backend before resuming workers/claims. Old code can structurally operate after the additive migration but cannot produce completion snapshots; do not mix old/new workers. No rollback should drop provenance or snapshots. Keep missions/chests inactive until reviewed configuration and live verification in a separately authorized rollout. This branch is not a claim of production readiness.

The schema-independent controls-only commit is deployed first on schema 0025. Follow [the deployment-controls procedure](MISSIONS_DEPLOYMENT_CONTROLS.md) for exact switches, drain/timeout behavior and Render redeployment sequencing. Follow [isolated PostgreSQL verification](MISSIONS_POSTGRES_VERIFICATION.md) before production sign-off. No separate runtime-control migration or mission activation is introduced.

## Future objective and Admin Builder design

Future admin APIs should reuse validation, lock definition/configuration rows, validate the whole eligibility set before activation, assign effective times, record actor/version/change history and prevent retroactive timestamps. New reward/rule versions affect future progress, never earned envelopes. Activation triggers provide a conservative database floor; direct SQL imports are not a substitute for that future audited admin workflow.

| Future objective | Required extension |
|---|---|
| Check-in / distinct login days | Trusted server login/check-in event and unique player/day receipts; no client date authority. |
| Accepted friends | Mutual accepted-friend event; distinct relationship receipts. |
| Profile completion | Authoritative completeness transitions, not arbitrary profile writes. |
| Wheel spins | Existing reward_wheel.spun, with audited count/source restrictions. |
| Specific canonical solve / improved PB | Existing approval/PB events filtered by canonical puzzle ID, independent of manufacturing run. |
| Distinct solves / theme-set ownership/completion | Versioned objective type and distinct canonical puzzle receipt/set-definition tables. |
| Leaderboard placement | Trusted ranked snapshot/competition-finalization event and explicitly frozen result policy. |
| Verified CogZart attendance | Server-verified attendance source with unique attendee/event receipts. |
| Mission chains | Versioned prerequisite DAG, cycle checks and activation-time rules; no reward-event recursion. |
| Cosmetics | Envelope version with validated rewardDefinitionId and atomic inventory grant ledger. |
| Seasonal achievements | Explicit season/occurrence association with immutable UTC boundaries and claim policy. |

These are design notes only. M1 retains one existing scalar-equality/count rule per mission, with no new objective sources or inventory grants. Retry release tooling, a full admin builder, metrics/alerts, timezone customization, historical reconciliation and player chest UI remain deferred. Database-backed tests use disposable PGlite; PostgreSQL multi-connection lock behavior still needs staging verification.

## Branch validation

The initial M1 commit was validated with 977 passing backend tests across 50 files, including 28 database-backed M1 regression cases; 222 passing frontend tests. Backend lint/typecheck/build, frontend lint/TypeScript/production build and git diff whitespace checks passed. The frontend build required network access for the existing Google Fonts. The pre-existing next-env.d.ts modification was restored byte-for-byte after Next.js generated its build types. No production connection, migration, import, activation or deployment was performed for implementation/testing.

The deployment-safety patch additionally passed 970 backend tests on the controls-only branch based on production main/schema 0025; updated M1 passed 1000 backend tests across 52 files, with nine real-PostgreSQL opt-in cases skipped because Docker/PostgreSQL were unavailable. The frontend suite passed all 222 tests. Both backend variants passed lint/typecheck/build; frontend lint/TypeScript/production build and whitespace checks passed. See the linked operator procedure to execute the PostgreSQL tests on a new isolated local database. Neither feature branch has been deployed, merged, migrated against production or used to activate definitions.
