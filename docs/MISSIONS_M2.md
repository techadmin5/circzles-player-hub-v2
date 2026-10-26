# M2 slices 1-8: inactive mission configuration, approvals and reward safety

Latest consolidated status, 2026-10-24: Slices 1-10 and Daily/Weekly chests are implemented locally. **Approved initial-release chest templates: Daily 50 XP / 100 SP; Weekly 200 XP / 250 SP.** Earlier provisional amounts and pending-budget statements in the chronological sections below are superseded by this product decision, without constituting recorded per-chest approval. See [the final local candidate report](MISSIONS_RELEASE_CANDIDATE.md) for the current feature inventory, 0026-0035 upgrade evidence, exact release gates and file inventory.

Local implementation on top of M1 release `ed217f60253614b99eb32545d3b3c922609e3698`. Slices 2-5 add audit migrations 0027-0030. Slices 6-7 add readiness, shared reward arithmetic guards and a read-only approval-contract foundation without schema changes. All validation uses synthetic in-memory databases. No production connection, activation or deployment is included.

## Available screen

`/admin/missions` replaces the old mock-service form and nonfunctional activation buttons. In API mode the existing authenticated admin layout checks the Missions access endpoint before mounting the page. The admin header includes a Missions link.

The screen provides title search, bounded pagination, explicit loading/empty/error states and an inline detail view. Details show the stored category/period, UTC availability and activation-effective timestamps, explicit claim deadline, rule and filters, configured rewards, and configuration issues from existing M1 validators. Definition lifecycle is derived as INACTIVE, SCHEDULED, ACTIVE or ENDED; this is separate from player progress, claimability, configuration validity and worker maintenance flags. The builder does not load player identities, progress or reward ledgers. Administrator history exposes the administrator ID, mission ID and allowlisted definition metadata, including rule, schedule and reward snapshots for their corresponding changes.

The metadata form saves only an inactive definition's title, description and display order. Slices 3-5 add separate inactive rule, UTC scheduling and XP/SP reward editors described below. Active definitions, including scheduled/ended active definitions, are read-only. All configuration saves require the same loaded updatedAt revision; conflicts retain the draft and offer Reload details. A successful reload discards the draft. The server validates strict inputs, locks the definition in a transaction and checks active state/revision. XP/SP rewards are editable separately; the event eligibility cutoff and mission activation remain read-only.

## API and security

All routes require an active server-authenticated administrator with `MISSIONS_MANAGE`, granted only to SUPER_ADMIN. REVIEWER has no access. The frontend boundary is not authorization authority.

| Method | Path | Response / input |
|---|---|---|
| GET | `/api/admin/missions/access` | `{ allowed: true }` after authorization |
| GET | `/api/admin/missions` | `{ missions, limit, offset, hasMore }`; strict optional title `search`, `limit` 1–100 (default 25), `offset` 0–1000000 |
| GET | `/api/admin/missions/:missionId` | Definition detail; strict UUID; 404 for unknown ID |
| GET | `/api/admin/missions/:missionId/readiness` | Persisted configuration checks, mission revision, evaluation UTC time and blocked safety/product gates; no query parameters or activation |
| POST | `/api/admin/missions` | Exactly `title`, `description`, existing `category`, integer `displayOrder`; returns inactive detail with HTTP 201 |
| GET | `/api/admin/missions/:missionId/history` | `{ entries, limit, offset, hasMore }`; strict pagination limits as above; newest history ID first |
| PATCH | `/api/admin/missions/:missionId` | Exactly `title` (1–200 trimmed characters), `description` (0–4000), integer `displayOrder` (0–2147483647), ISO `expectedUpdatedAt`; returns saved detail |
| GET | `/api/admin/missions/rule-options` | Supported event labels and sources, under the same SUPER_ADMIN authorization |
| PATCH | `/api/admin/missions/:missionId/rule` | Strict complete rule configuration plus expectedUpdatedAt; returns saved definition, which remains inactive |
| PATCH | `/api/admin/missions/:missionId/schedule` | Strict UTC startsAt, endsAt, claimDeadline (strings or null), plus expectedUpdatedAt; returns the inactive saved definition |
| PATCH | `/api/admin/missions/:missionId/rewards` | Explicit xp and synapsePoints (positive integers or null), plus expectedUpdatedAt; at least one currency required; returns inactive detail |

Responses are private/no-store. Production requires the existing Player Hub proxy secret. Mutation origin and cross-site checks follow catalog administration. Request identity comes only from the session. Invalid input is 400, missing/expired authentication 401, insufficient permissions/proxy/origin 403, active-definition edits or stale revision 409. There is no delete, activate, deactivate or payout endpoint.

Frontend DTOs are JSON-only and do not import backend implementation. A backend typecheck assertion keeps both DTO contracts aligned. The frontend graph boundary regression remains in validation.

## Existing functionality and prerequisites

M1 already supplies mission definitions, rules/rewards, UTC lifecycle, earned snapshots, claim safety and chest processing. No existing backend admin mission editor was found. This slice reuses those contracts instead of creating another mission engine. Configuration warnings describe existing data; they do not repair or activate it.

Slice 5 requires the M1 schema through 0026 and additive audit migrations 0027-0030. Production remains on 0025 and must not receive this work before a separately authorized M1 rollout. Release commits and the controls-only branch remain unchanged. The current backend .env is not a safe local test configuration: do not start the server with live Neon credentials.

Tests use new in-memory PGlite databases with migrations through 0030 and synthetic records, plus Fastify injection and mocked browser requests. They do not start mission runners or external integrations. No existing local database or fixtures are reset. Build validation uses a loopback API placeholder and preserves the existing next-env.d.ts bytes.

## Deferred M2 work

Advanced rule conditions and other event families, configuring chest eligibility, activating definitions, immutable definition versions, diagnostics/retry tooling and player-facing chest controls are not implemented here. These need explicit product rules, immutable-earned-reward guarantees and reviewed activation/change-history contracts. Reward amounts and new objectives must not be inferred from examples.

The next prerequisite is to agree reward-budget/overflow decisions and a recorded approval contract before implementing approval or activation mutations. Read-only readiness is available in Slice 6. Chest configuration, activation/deactivation, diagnostics and M3-M7 remain unfinished.

## Changed files and validation

- `backend/src/domain/adminMissions.ts`: listing/detail DTOs, M1 configuration diagnostics, locked revision-checked metadata update.
- `backend/src/domain/adminAuth.ts`: SUPER_ADMIN-only Missions permission.
- `backend/src/http/adminMissionRoutes.ts`: authorized, proxy/origin-protected endpoints.
- `backend/src/http/app.ts` and `backend/src/server.ts`: optional route dependency and runtime wiring.
- `backend/tests/adminMissions.test.ts`: synthetic database, security, lifecycle, metadata-only writes, stale revisions and frontend contract checks.
- `src/types/adminMissions.ts`: frontend-safe JSON contracts.
- `src/components/admin/MissionAdmin.tsx`: list, inline detail and inactive metadata form.
- `src/components/admin/CatalogAdminBoundary.tsx`: separate Missions authorization and navigation.
- `src/app/admin/missions/page.tsx`: real component replaces placeholder.
- `src/components/admin/missionAdmin.test.mjs`: browser behavior, permission boundaries, failure and save handling.
- `package.json`: includes the new frontend tests in the existing test command; no dependency change.
- `docs/MISSIONS_M2.md`: scope, API, prerequisites and deferred decisions.

Focused backend validation passed 219 tests across the new admin suite, existing HTTP suite, mission maintenance controls and M1 lifecycle suite (25 tests are new admin cases). Frontend validation passed 38 tests across the new UI suite, existing catalog UI and import-boundary regressions (8 tests are new Missions cases). The original cold-start backend run had one five-second test timeout; the database-backed HTTP cases now have a bounded fifteen-second timeout and the final regression run passed without failures. Neither suite connects to an external database.

Backend and frontend lint, typechecks and production builds passed, as did `git diff --check`. The Next.js build includes `/admin/missions` and used loopback-only application targets. Existing `next-env.d.ts` and backend lockfile hashes were preserved. No dependencies or release commit IDs changed. This was Slice 1 validation; Slice 2 results follow below.

## Slice 2: creation and audit guarantees

Create Mission Draft opens an inline form at /admin/missions. Title (trimmed, 1?200), description (trimmed, up to 4000, empty allowed), category and integer display order (0?2147483647) are required in the API. The category must be one of M1's DAILY, WEEKLY, ACHIEVEMENT, SPRINT, SEASON or EVENT values. The server derives the existing period mapping: DAILY?DAILY, WEEKLY?WEEKLY, ACHIEVEMENT?LIFETIME, others?FIXED. Clients cannot set period, actor, active, dates, rule, reward, progress or payout fields.

Existing missions columns support partial drafts without a new status or sentinel values: the API explicitly writes active=false, null windows/deadline, and no rule/reward/progress rows. The legacy database active default remains unchanged and is never relied upon by this API. FIXED drafts intentionally show missing-window warnings until a separately specified configuration workflow exists. Missing rules/rewards are shown as incomplete, not auto-filled. M1 player listing/processing excludes inactive definitions and requires enabled rules; a new draft has no earned progress for claims. Inactive historical earned rewards on older missions retain M1 behavior.

Creation and every real metadata change insert mission_admin_history in the same transaction as the mission write. History stores a monotonic bigint ID (JSON string), mission ID, authenticated admin_users ID, DRAFT_CREATED, METADATA_UPDATED or (from Slice 3) RULE_CONFIGURED, UTC occurrence timestamp, null-before for creation and allowlisted before/after snapshots. Metadata snapshots contain title, description, display order, category, period, active and revision timestamp. Rule change snapshots also contain the complete before/after rule, with null before the first rule is configured. Earlier snapshots remain readable. Actor IDs come from the authorized request context, not the body. No email, session, credentials or unrelated player data is captured. Before/after snapshots are read-only in the detail view; pagination is bounded and refreshes after a save. Earlier edits are not fabricated or backfilled.

Metadata mutation retains the row lock, active-state check and loaded revision check. Identical metadata submissions do not advance the revision or create a fake change. Stale/failed attempts do not create history. If history insertion fails, the mission insert/update rolls back. Successful history is protected from UPDATE, DELETE and TRUNCATE by database triggers; privileged database owners could disable/drop these guards, so this is not an external tamper-proof audit system. Foreign keys restrict deletion of referenced missions/administrators.

0027_mission_admin_history.sql adds only the history table, bigint sequence, two foreign keys, snapshot/action checks, lookup index and append-only triggers/function. The Drizzle schema configuration includes missionAdminSchema.ts, a new 0027 snapshot is generated, and the journal appends one entry. No 0000?0026 SQL/snapshots or earlier journal entries are rewritten. The opt-in M1 PostgreSQL suite's successful-migration row-count expectation now derives from the local journal, so 0027 does not break its old hardcoded count; that real-PostgreSQL suite is not rerun in this slice.

### Slice 2 changed files (relative to Slice 1)

- backend/drizzle.config.ts
- backend/drizzle/0027_mission_admin_history.sql
- backend/drizzle/meta/0027_snapshot.json
- backend/drizzle/meta/_journal.json (append only)
- backend/src/db/missionAdminSchema.ts
- backend/src/domain/adminMissions.ts
- backend/src/http/adminMissionRoutes.ts
- backend/tests/adminMissions.test.ts (explicit synthetic audit actor; creation/history access regression)
- backend/tests/adminMissionDrafts.test.ts
- backend/tests/missionPostgres.test.ts (migration-count expectation only)
- src/types/adminMissions.ts
- src/components/admin/MissionAdmin.tsx
- src/components/admin/MissionHistory.tsx
- src/components/admin/missionAdmin.test.mjs
- docs/MISSIONS_M2.md

### Slice 2 validation

Focused backend suites: 247 passed (including 28 new draft/history cases), zero failed. Frontend admin/catalog/import-boundary suites: 43 passed (including 5 new draft/history UI cases), zero failed. Backend/frontend lint, typechecks, production builds and whitespace checks passed. New revision-race tests run against isolated PGlite; they are not a claim of new multi-pool PostgreSQL verification. The opt-in nine-test real PostgreSQL suite was not rerun. Existing local databases were not opened or reset.

## Slice 3: audited inactive rule configuration

### Existing M1 processing, verified scope

`gameEvents.ts` registers 21 events. `missions.ts` accepts the following 18 non-recursive event types for rules: `puzzle.added`, `submission.created`, `submission.approved`, `submission.rejected`, `submission.resubmission_required`, `personal_best.improved`, `points.earned`, `xp.earned`, `progression.level_up`, `store.purchase.completed`, `coupon.issued`, `coupon.redeemed`, `inventory.item.granted`, `inventory.item.equipped`, `inventory.item.unequipped`, `inventory.item.consumed`, `player.display_name.changed`, and `reward_wheel.spun`. Their emitters exist in the corresponding domain services. The processor excludes mission-generated rewards and rejects the recursive `mission.completed`, `mission.claimed` and `mission.chest_claimed` rule types.

Every matching event contributes **one** to the target count. Rules do not sum amounts, XP, SP or completion time, and do not provide distinct-design or distinct-day objectives. M1 compares an optional source type, canonical puzzle ID and numeric level exactly; its flat scalar `conditions` also use exact equality. It checks mission windows/activation timing and retains existing earned snapshots. This slice does not modify that engine or any emitter.

The builder deliberately exposes six verified claim/submission events whose emitters all supply canonical `puzzleId` and numeric `levelId`:

| Event | Builder label | Optional exact source filter | Emitter |
|---|---|---|---|
| `puzzle.added` | CircZles added | `PUZZLE_CLAIM` | `puzzles.ts` |
| `submission.created` | Submission created | `SUBMISSION` | `submissions.ts` |
| `submission.approved` | Submission approved | `SUBMISSION_REVIEW` | `submissionReviews.ts` |
| `submission.rejected` | Submission rejected | `SUBMISSION_REVIEW` | `submissionReviews.ts` |
| `submission.resubmission_required` | Resubmission requested | `SUBMISSION_REVIEW` | `submissionReviews.ts` |
| `personal_best.improved` | Personal best improved | `SUBMISSION` | `submissionReviews.ts` |

The other 12 existing M1 event types and advanced equality conditions remain read-only in this builder; they are not removed from M1. No trigger, objective, event or reward semantics are invented. Review rejection/resubmission targets count those existing events, not an inferred successful completion.

### Editor and strict API contract

Configure rule opens an inline editor in mission details at `/admin/missions`. Supported labels/sources are loaded on demand from the authorized rule-options endpoint; loading failure supplies no fallback options. Existing rules with unsupported events, sources or nonempty conditions remain read-only rather than silently losing parameters. Active definitions cannot open/save the editor. XP/SP reward configuration and scheduling are available in later slices; mission activation remains unavailable.

`PATCH /api/admin/missions/:missionId/rule` requires exactly:

- `eventType`: one of the six builder events above.
- `targetCount`: integer 1 through 2147483647 (PostgreSQL integer bound).
- `sourceType`: null or that event's verified source above.
- `puzzleId`: null or an existing canonical puzzle UUID. No catalog records are created or changed.
- `levelId`: null or a positive numeric level with at most one decimal, up to 999.9 (existing numeric(4,1) bound). If both filters are set, the puzzle's current level must match.
- `conditions`: exactly an empty object. Nested, array, nonempty or malformed conditions are rejected independently of the M1 validation gap noted below.
- `active`: boolean enabling/disabling the **rule**, never the mission. A newly opened rule form defaults disabled; no rule/reward is supplied by draft creation.
- `expectedUpdatedAt`: the loaded mission revision in ISO format.

Frontend controls validate count/UUID/level and construct only this complete payload. The server independently validates strict JSON, invokes the existing M1 rule validator and checks catalog references. Unsupported events/sources, extra fields (including reward/actor overrides), invalid parameters and malformed revisions are 400. Unknown mission is 404. Active missions return 409 `MISSION_RULE_LOCKED`; stale metadata or rule revisions return 409 `MISSION_REVISION_CONFLICT`. Authorization, private/no-store, production proxy, origin and cross-site protections apply independently to both new routes.

### Atomic writes and inactivity

The transaction locks the parent mission first, checks inactivity and revision, then locks its single rule. It inserts or replaces only that rule, advances the same mission revision used by metadata, and inserts `RULE_CONFIGURED` history with the session actor, UTC timestamp and complete allowlisted before/after snapshots. The first rule has `before.rule=null`; subsequent changes include both full rules. No-op saves do not advance revisions or create audit entries. An audit failure rolls back the rule and revision. Concurrent rule/rule or rule/metadata saves permit one writer per loaded revision. PGlite tests cover these conflicts and rollback; no new claim of multi-connection PostgreSQL verification is made.

Saving never changes `missions.active`, dates, rewards, existing progress/target snapshots, claim records, chests, player records or XP/SP ledgers. A new draft remains inactive and reward-free after rule configuration, even if its rule is enabled. Inactive historical missions can still have previously earned claims under unchanged M1 rules; configuration neither creates nor revokes those earned claims. On any future separately authorized reactivation, existing in-progress target snapshots retain their old target under M1; changing a rule is not a progress reset or immutable definition versioning feature.

### Schema and existing limitation

`0028_mission_admin_rule_history.sql` changes only the two history action/snapshot CHECK constraints to accept `RULE_CONFIGURED` alongside the established actions. It adds no table and changes no M1 gameplay schema, triggers or foreign keys. Existing metadata-only snapshots remain valid and readable. The Drizzle journal appends one entry, with a new 0028 snapshot. Migration 0026, migration 0027 and the 0027 snapshot are preserved byte-for-byte. The upgrade regression populates a synthetic 0027 history table, applies 0028 in a transaction, checks the old row, writes a rule audit and verifies append-only guards still reject deletion/truncation. No migration is run against an existing local or remote database.

One pre-existing M1 validator limitation was found: `validateMissionRule` calls `conditionsMatch(conditions, {})`, whose `every()` short-circuits on the first unequal value. A later malformed/nested condition can therefore escape complete validation. This slice does not silently change gameplay behavior. Its strict empty-condition input prevents the gap from entering through this editor, and existing advanced rules are not simplified. Full scalar-condition validation needs a separately scoped M1 correction before advanced-condition editing is offered.

### Slice 3 changed files (relative to Slice 2)

- `backend/drizzle/0028_mission_admin_rule_history.sql`
- `backend/drizzle/meta/0028_snapshot.json`
- `backend/drizzle/meta/_journal.json` (one appended entry)
- `backend/src/db/missionAdminSchema.ts`
- `backend/src/domain/adminMissionRules.ts`
- `backend/src/domain/adminMissions.ts`
- `backend/src/http/adminMissionRoutes.ts`
- `backend/tests/adminMissionRules.test.ts`
- `src/types/adminMissions.ts`
- `src/components/admin/MissionRuleEditor.tsx`
- `src/components/admin/MissionAdmin.tsx`
- `src/components/admin/MissionHistory.tsx`
- `src/components/admin/missionAdmin.test.mjs`
- `docs/MISSIONS_M2.md`

### Slice 3 validation

Focused backend suites: **292 passed, 0 failed** across admin rules, drafts, metadata, M1 lifecycle, maintenance controls and HTTP regression suites. This includes **45 new rule/upgrade cases**. Frontend admin/catalog/import-boundary suites: **51 passed, 0 failed**, including **8 new rule/history UI cases**. Backend/frontend lint, typechecks and production builds pass, alongside whitespace checks. Frontend build includes `/admin/missions`, uses loopback-only application targets and preserves `next-env.d.ts`. No dependencies changed and no existing local database was opened/reset. The completed nine-test real PostgreSQL suite and full 1,000-test regression were not repeated. No commit, push, merge, activation, payout, production access or deployment occurs in this slice.

## Slice 4: audited inactive scheduling

### Editable fields and existing time model

The only editable fields are `startsAt`, `endsAt` and `claimDeadline`, plus the required shared revision token `expectedUpdatedAt`. They are the existing M1 timestamp columns, not a new scheduling model. The event eligibility cutoff, `activationEffectiveAt`, stays read-only: it belongs to the later reviewed activation workflow, and changing it could invalidate existing chest eligibility. Mission category, period type, recurrence, timezone, chest configuration, rewards and activation cannot be supplied to this endpoint.

| M1 category / period | Availability | Reward claim expiry |
|---|---|---|
| DAILY / DAILY | Optional start and/or end; inclusive start, exclusive end | UTC daily period end plus 24 hours; explicit deadline must be null |
| WEEKLY / WEEKLY | Optional start and/or end; inclusive start, exclusive end | UTC ISO weekly period end plus 24 hours; explicit deadline must be null |
| ACHIEVEMENT / LIFETIME | Optional start and/or end | Optional explicit deadline; null means no explicit claim expiry |
| SPRINT, SEASON, EVENT / FIXED | Both start and end required when saving a configured schedule | Optional explicit deadline; no automatically added grace |

`missionLifecycle.ts` and the M1 mission validator remain unchanged. Daily boundaries are midnight-to-midnight UTC. ISO weekly boundaries are Monday 00:00 UTC to the following Monday 00:00 UTC, including ISO year rollover. An availability window can begin/end inside a period; it does not move, clip or restart those recurring period boundaries. FIXED uses one `fixed:<missionId>` period; LIFETIME uses one `lifetime` period. No local timezone, cron, custom reset interval or recurrence selector is introduced.

Availability controls eligible event times, not the duration of earned reward claims. The processor additionally requires `missions.active`, an enabled rule and an event time at/after the stored event cutoff. Stored claim deadlines are exclusive: claims expire at the deadline itself. Already earned mission snapshots retain their recorded period/reward/deadline data after definition scheduling changes.

Chest grace is separately owned by M1 chest periods. Daily/weekly chests also use their own period end plus 24 hours, recorded in their earned state. This form does not edit chest definitions, eligibility, windows, grace or snapshots. Chest eligibility/window compatibility must be reviewed by the future activation workflow; scheduling does not activate either entity or repair associations.

### API and validation

`PATCH /api/admin/missions/:missionId/schedule` accepts the complete strict object:

```json
{
  "startsAt": "2030-02-11T00:00:00.000Z",
  "endsAt": "2030-02-12T00:00:00.000Z",
  "claimDeadline": null,
  "expectedUpdatedAt": "2030-02-10T12:00:00.000Z"
}
```

The three schedule fields are required keys, individually nullable where permitted above. Non-null dates must be real ISO UTC dates with seconds, ending in `Z`, with zero to three fractional digits and years 0001-9999. The API rejects local datetime strings, numeric timestamps, timezone offsets, invalid calendar dates and unsupported precision rather than silently guessing/truncating. Dates are normalized to JavaScript millisecond precision and returned/audited as UTC ISO strings. The existing revision token retains the established ISO-offset-compatible revision format.

The server reuses `validateMissionDefinition` against the stored category/period plus the proposed window. It enforces required fixed endpoints, end strictly after start, no explicit recurring deadline, and explicit fixed/lifetime deadline not before availability end. A deadline equal to availability end is permitted by M1 and preserved. Two additional editor consistency checks derive directly from actual M1 eligibility/expiry comparisons: end must be after the unchanged event cutoff, and any explicit deadline must be after the earliest eligible event time (`max(start, cutoff)`). These reject empty earning/claim intervals; no minimum duration, future-only start, preset grace or new gameplay semantics is added.

All previous authentication, SUPER_ADMIN permission, proxy/origin/cross-site checks and private/no-store responses apply server-side. Invalid/unsupported input is 400; unknown mission is 404. Active definitions, including active scheduled/ended definitions, return 409 `MISSION_SCHEDULE_LOCKED`. Stale revisions return 409 `MISSION_REVISION_CONFLICT`. The definition remains inactive even after configured start/end dates pass.

### UI, atomic audit and preservation

Mission details at `/admin/missions` now include Configure schedule. The inline form uses explicitly labelled UTC text inputs rather than browser-local `datetime-local` conversion. Fixed endpoints are required. Recurring explicit deadlines are disabled and submitted as null, with their period-end grace explained. The current event cutoff is displayed read-only. Start/end inclusivity, UTC periods, reward deadlines and separate chest grace are explained beside the controls. Invalid input remains editable; server failures and revision conflicts preserve unsaved values. Reload details discards stale edits. A successful save refreshes the detail and history, reports that the mission remains inactive, and does not optimistically fabricate a successful schedule.

The transaction locks the mission, verifies inactivity/revision, validates its existing M1 category/period, then updates only the three timestamps and the shared revision. It inserts `SCHEDULE_CONFIGURED` history with the session administrator ID, UTC occurrence time and before/after snapshots containing all three schedule fields plus the unchanged event cutoff. Metadata remains included as context. Audit failure rolls back timestamps and revision. Identical normalized schedules create no audit entry and do not advance revisions. Rule, metadata and schedule writes compete using the same revision and parent row lock.

No timer, activation worker, backfill, gameplay event, progress reset, claim or payout is introduced. New drafts still start inactive with no rule or reward rows. Scheduling does not change reward records, rules, player records, existing earned progress, chest records or XP/SP ledgers. Synthetic preservation tests verify those records remain unchanged; no real player data is opened.

### Migration and focused validation

`0029_mission_admin_schedule_history.sql` changes only the two history CHECK constraints to accept `SCHEDULE_CONFIGURED`. It adds no gameplay columns, tables, triggers or foreign keys. Older metadata/rule snapshots remain valid. The journal appends one entry and a 0029 schema snapshot is generated. Migrations 0026-0028 and all earlier SQL/snapshots are preserved. The upgrade regression creates a new synthetic database through 0028, records draft/rule history, applies 0029 transactionally, verifies prior history and append-only guards, and then records a schedule audit.

The existing 0028 upgrade test now explicitly stops its fixture at migration 0027 before applying 0028; excluding only the 0028 filename would incorrectly apply future migrations first. No established migration is changed and no existing database receives a migration.

Focused backend suites: **353 passed, 0 failed**, including **61 new scheduling cases**. Frontend admin/catalog/import-boundary suites: **62 passed, 0 failed**, including **11 new scheduling cases**. Coverage includes all existing categories, nullable/fixed windows, invalid dates and timezone formats, exact UTC start/end and ISO year boundaries, DST-independent period lengths, recurring grace, fixed/lifetime explicit deadlines, active restrictions, authorization/proxy/origin, no-ops, shared revision races, audit rollback, snapshot preservation and migration compatibility. Revision races use isolated PGlite, not a new multi-pool PostgreSQL concurrency claim. No real PostgreSQL integration rerun is needed for this editor-only change.

Backend/frontend lint, typechecks, builds and `git diff --check` all passed. The frontend build includes `/admin/missions`, uses loopback application targets and preserves `next-env.d.ts`. No existing database, production service, mission worker or payout process is started.

### Slice 4 changed files (relative to Slice 3)

- `backend/drizzle/0029_mission_admin_schedule_history.sql`
- `backend/drizzle/meta/0029_snapshot.json`
- `backend/drizzle/meta/_journal.json` (one appended entry)
- `backend/src/db/missionAdminSchema.ts`
- `backend/src/domain/adminMissionScheduling.ts`
- `backend/src/domain/adminMissions.ts`
- `backend/src/http/adminMissionRoutes.ts`
- `backend/tests/adminMissionScheduling.test.ts`
- `backend/tests/adminMissionRules.test.ts` (bound the 0028 upgrade fixture to its actual predecessor)
- `src/types/adminMissions.ts`
- `src/components/admin/MissionScheduleEditor.tsx`
- `src/components/admin/MissionAdmin.tsx`
- `src/components/admin/MissionHistory.tsx`
- `src/components/admin/missionAdmin.test.mjs`
- `docs/MISSIONS_M2.md`

### Remaining M2 work

Reviewed activation/deactivation, chest configuration/eligibility, immutable definition versioning and operational diagnostics remain unfinished. Other event families/advanced conditions remain read-only, including the previously documented M1 condition-validation issue. Slice 5 adds audited XP/SP configuration. Slice 6 adds that read-only preview; reward-budget/overflow decisions and a recorded approval contract are now required before any activation endpoint. Production remains on 0025; publication, migrations and deployment require separate authorization.

## Slice 5: audited inactive XP/SP reward configuration

### Existing end-to-end reward contract

M1's `mission_rewards` table stores `rewardType`, positive integer `amount`, `active` and `displayOrder`. `freezeRewards` in `missionLifecycle.ts` accepts only `XP` and `SYNAPSE_POINTS`, aggregates enabled rows by type, requires at least one positive reward, and caps each currency's aggregate at **2147483647**. `snapshotTotals` validates frozen version-1 snapshots through the same validator. The database also rejects zero/negative reward rows. A mission may reward XP only, SP only, or both. The cap applies separately to each currency, not their sum.

No zero-valued reward row or empty/all-zero payable snapshot is supported. An omitted currency becomes zero only when M1 derives award totals from a valid one-currency snapshot; the claim path skips that currency's ledger grant. A new inactive draft may remain incomplete with no reward rows, but this is not a valid payable reward configuration. The editor therefore does not offer a clear-all or zero-reward completion mode.

The existing claim transaction locks progress, validates the earned snapshot and deadline, inserts the claim, grants positive XP/SP with deterministic per-period idempotency keys, links ledger IDs and marks progress claimed atomically. Player/period uniqueness, player/idempotency uniqueness and row/advisory locks provide existing duplicate-claim protection. This slice does not modify or invoke that path. Configuration reads no player balances and calls only the existing pure reward snapshot validator.

### Strict API and explicit editor inputs

`PATCH /api/admin/missions/:missionId/rewards` requires exactly:

```json
{
  "xp": 5,
  "synapsePoints": null,
  "expectedUpdatedAt": "2030-02-10T12:00:00.000Z"
}
```

Both currency keys are required. Each value must be a JSON integer from 1 to 2147483647 or explicit null to omit that currency. Both null is rejected through M1's validator. Zero, negative, fractional, non-finite, excessive, missing and string-coerced values are rejected. Arbitrary reward arrays/types, activation, actor, inventory/cosmetic/chest fields and unknown properties are rejected. The server independently authorizes SUPER_ADMIN, preserves proxy/origin/cross-site protections and uses private/no-store responses. Invalid input is 400, unknown mission 404, active definitions 409 `MISSION_REWARDS_LOCKED`, and stale shared revisions 409 `MISSION_REVISION_CONFLICT`.

Configure rewards opens an inline form in mission details. Both currency choices start unselected and every amount input starts blank, including on existing missions: stored values and placeholders are never copied. A selected currency requires an explicitly entered amount. Unselecting/reselecting it or reopening the editor clears that input. Saving replaces the effective enabled XP/SP configuration; unselected currencies are omitted. Existing values remain visible in the read-only detail above. The UI explains optional-currency versus unsupported zero/empty rewards, preserves unsaved inputs on server/revision errors and accepts only server-confirmed saved detail/history. Reload requires fresh entry.

Definitions containing any reward type other than XP/SP, even disabled rows, remain read-only in this editor and return 409 `MISSION_REWARDS_UNSUPPORTED`. This avoids silently overwriting or repurposing out-of-scope reward records. Chests, cosmetics and inventory are not configurable here.

### Atomic writes, revision protection and historical safety

The transaction locks the mission first, verifies inactive status and the loaded shared revision, then locks its reward rows in stable order. It compares the proposed frozen totals with existing valid enabled totals; an effective no-op creates no revision or audit entry, including valid duplicate XP/SP rows whose sums already match. An explicitly supplied valid configuration can repair an invalid aggregate XP/SP total. Unsupported types cannot be repaired by this editor.

For an actual change, selected types reuse an existing row ID where available, with the explicitly supplied amount. Omitted currencies and duplicate rows are disabled, not deleted. Missing types get a new positive enabled row; layout order is deterministic and no economic amount is defaulted. Existing disabled configuration rows retain positive amounts. The single mission revision advances once and `REWARDS_CONFIGURED` history is inserted in the same transaction. Before/after snapshots contain allowlisted type, amount and enabled state for all definition reward rows, with metadata/revision context, session administrator ID and UTC occurrence time. History failure rolls back inserts, amount changes, disabled flags and revision together.

Metadata, rule, schedule and reward edits use the same revision and parent row lock. PGlite races cover each competing writer; this is not a new multi-connection PostgreSQL concurrency claim. Earlier metadata/rule/schedule history remains readable and append-only.

Only current definition reward configuration and revision change. The API never sets `missions.active`, resets progress or updates earned/completed snapshots, claims, XP/SP ledgers, balances, progression, chests or inventory. A configured draft remains inactive; it still needs separately reviewed activation. Existing earned snapshots retain their old amounts even after definition reward changes. Tests insert synthetic historical claim/ledger/balance fixtures directly and verify they are unchanged; no payout, claim or processor is executed by the new reward suite.

### Existing limitation requiring a later decision

The per-currency reward cap is a storage/snapshot constraint, not an approved business reward budget. M1 has no lower mission reward policy cap. The SP wallet and SP ledger balance-after columns are signed PostgreSQL integers: a valid configured SP amount can still cause an integer overflow when added to an existing positive balance. The existing transaction would roll back; this editor neither checks every player's future headroom nor silently changes caps/storage or grants partial rewards. Product reward budgets and controlled overflow handling need review before activating high-value rewards. XP grant amounts are integers; cumulative XP uses bigint columns mapped to JavaScript numbers, so that representation is not an unlimited-precision economy either. No reward economy expansion or ledger change is made here.

### Migration, changed files and validation

`0030_mission_admin_reward_history.sql` changes only the existing history action/snapshot CHECK constraints to accept `REWARDS_CONFIGURED`. It changes no reward, claim, ledger or gameplay table, foreign key or trigger. A new 0030 snapshot and one journal entry are added. All preceding SQL/snapshots, including 0026-0029, remain byte-for-byte unchanged. The upgrade test creates synthetic 0029 draft/metadata/rule/schedule history, applies 0030 in a transaction, verifies the old entries, appends a reward audit and confirms deletion/truncation remain blocked. No existing local or production database receives a migration.

Changed files relative to Slice 4:

- `backend/drizzle/0030_mission_admin_reward_history.sql`
- `backend/drizzle/meta/0030_snapshot.json`
- `backend/drizzle/meta/_journal.json` (one appended entry)
- `backend/src/db/missionAdminSchema.ts`
- `backend/src/domain/adminMissionRewards.ts`
- `backend/src/domain/adminMissions.ts`
- `backend/src/http/adminMissionRoutes.ts`
- `backend/tests/adminMissionRewards.test.ts`
- `src/types/adminMissions.ts`
- `src/components/admin/MissionRewardEditor.tsx`
- `src/components/admin/MissionAdmin.tsx`
- `src/components/admin/MissionHistory.tsx`
- `src/components/admin/missionAdmin.test.mjs`
- `docs/MISSIONS_M2.md`

Focused backend suites: **405 passed, 0 failed**, including **52 new reward cases**. Frontend admin/catalog/import-boundary suites: **74 passed, 0 failed**, including **12 new reward cases**. Coverage includes minimum/maximum values, one/both currencies, no defaults, zero/empty rejection, invalid input, permission/proxy/origin protection, active-state rejection, duplicate aggregate/no-op handling, inactive row reuse, audit rollback, shared revision races, unchanged historical rewards/ledgers/balances and migration compatibility. Backend/frontend lint, typechecks, production builds and whitespace checks all passed, with loopback-only frontend build application targets and preserved `next-env.d.ts`. Completed full PostgreSQL and 1,000-test regression runs are not repeated. No production access, activation, real claim/grant, commit, push, merge or deployment occurs.

Slice 6 adds read-only activation-readiness diagnostics below. The next prerequisite is an agreed reward-budget/overflow policy and recorded approval contract. Chest configuration, reviewed activation/deactivation, immutable definition versions and diagnostics remain unfinished. The earlier advanced-condition validation gap remains unchanged and advanced conditions stay read-only.

## Slice 6: read-only activation-readiness preview

### Endpoint, persisted inputs and consistency

`GET /api/admin/missions/:missionId/readiness` requires the existing server-side SUPER_ADMIN Missions permission, valid session and production proxy protection. It returns private/no-store responses. The UUID is validated and query parameters (including approval, reward or active assertions) are rejected. No POST/PATCH/PUT/DELETE readiness route exists. Active missions can be inspected but receive an inactive-state blocker; the preview never deactivates them.

The evaluator reads the mission, its rule/reward rows, enabled chest links and any referenced active canonical puzzle/design filters in a **repeatable-read READ ONLY transaction**. It takes no row locks and calls no processor, claim, grant, ledger-write or activation function. There is no persisted readiness state, audit write, approval flag, migration or schema change. Session authorization is also SELECT-only. No wallet balances, player identities, XP totals or ledgers are read: structural future overflow exposure does not require or justify a player scan.

The JSON response includes `missionId`, `missionRevision` (stored updatedAt), `evaluatedAt` in UTC, `configurationStatus`, `overallStatus`, `activationReady`, `productApproval`, derived `rewardSafety` and a checklist. Every checklist item has a stable `code`, `status` (PASS/BLOCKED/WARNING), `category` (CONFIGURATION/SAFETY/PRODUCT/ADVISORY), affected `field` and human-readable explanation.

`configurationStatus=PASS` means the checked persisted configuration satisfies the existing M1/M2 supported subset, not that activation is safe or approved. Safety and product blockers independently determine overall status. The current implementation always returns `productApproval=NOT_RECORDED` and blocks overall readiness: there is no application mechanism recording approved reward budgets or mission product approval. Existing administrator configuration history is not reinterpreted as approval. Even the smallest technically valid positive reward is not economically approved by this preview.

### Checks and issue codes

Existing `validateMissionDefinition`, `validateMissionRule`, strict M2 rule/schedule parsing, `validateAdminMissionSchedule`, `freezeRewards`, `snapshotTotals` and UTC period/deadline helpers are reused. Unsupported advanced conditions are independently blocked, including malformed values that M1's short-circuit validator can miss. The six builder events remain the only reviewed event subset; recognition by M1's larger registry is not expanded into activation approval.

| Code | Classification and behavior |
|---|---|
| `MISSION_INACTIVE` | CONFIGURATION PASS only when inactive; active/scheduled-active/ended-active definitions BLOCKED |
| `METADATA_VALID` | CONFIGURATION checks existing title/description limits |
| `LIFECYCLE_VALID` | CONFIGURATION reuses M1 category/period/order/definition validation |
| `SCHEDULE_VALID` | CONFIGURATION validates finite supported UTC timestamps and existing window/deadline/cutoff relationships |
| `AVAILABILITY_NOT_EXPIRED` | CONFIGURATION BLOCKED when end is at/before evaluation time |
| `CLAIM_DEADLINE_NOT_EXPIRED` | CONFIGURATION BLOCKED when explicit deadline is at/before evaluation time |
| `FUTURE_EVENT_WINDOW` | ADVISORY WARNING for a future start/cutoff; never implies automatic activation |
| `UTC_PERIOD_CONTRACT` | CONFIGURATION checks existing daily/ISO-week/fixed/lifetime period helpers; explains separate period-end claim/chest grace |
| `RULE_MISSING` | CONFIGURATION BLOCKED for an incomplete draft with no rule |
| `RULE_ENABLED` | CONFIGURATION BLOCKED for a disabled rule |
| `RULE_M1_VALID` | CONFIGURATION reuses M1 event/count/level/conditions validation |
| `RULE_EVENT_SUPPORTED` | CONFIGURATION BLOCKED outside the six supported builder events, including recursive or invented events |
| `ADVANCED_CONDITIONS_UNSUPPORTED` | CONFIGURATION BLOCKED for any nonempty/malformed advanced conditions; no conditions are silently removed |
| `RULE_PARAMETERS_VALID` | CONFIGURATION validates existing emitter source, count bounds, UUID/level and supported builder parameters |
| `RULE_FILTER_RESOLVES` | CONFIGURATION BLOCKED if a specified puzzle/level filter matches no currently active canonical puzzle and design |
| `REWARDS_VALID` | CONFIGURATION requires positive supported enabled XP/SP rewards within M1 per-currency aggregate limits; invalid totals are not assumed zero |
| `REWARD_TYPES_UNSUPPORTED` | CONFIGURATION BLOCKED for out-of-scope reward types, including disabled rows |
| `SP_INTEGER_OVERFLOW_EXPOSURE` | SAFETY BLOCKED for positive SP until a verified mitigation or approved bounded policy exists; PASS for no SP grant |
| `XP_PRECISION_EXPOSURE` | SAFETY BLOCKED for positive XP until cumulative-number precision is addressed or a verified bounded policy exists; PASS for no XP grant |
| `OPEN_CLAIM_WINDOW_UNAPPROVED` | PRODUCT BLOCKED for a fixed/lifetime definition without explicit claim expiry; M1 permits it, but open liability is not recorded as approved |
| `CHEST_LINK_REVIEW` | SAFETY BLOCKED for enabled chest eligibility links pending reviewed activation-time alignment; no enabled links PASS |
| `REWARD_BUDGET_APPROVAL_MISSING` | PRODUCT BLOCKED: no recorded approved maximum reward policy exists; storage limits are not budgets |
| `MISSION_PRODUCT_APPROVAL_MISSING` | PRODUCT BLOCKED: no recorded approval mechanism for objective/recurrence/windows/rewards or reviewed activation workflow |
| `POINT_IN_TIME_ONLY` | ADVISORY WARNING: recheck revision and time-dependent/catalog/chest/policy state; deployment controls are not evaluated |

Enabled chest links are conservatively blocked rather than simulating activation. M1 requires matching mission/chest periods, active missions for active chests and eligibility effective at/after both activation cutoffs. An actual future activation clamps the mission cutoff to activation time, so existing eligibility can become invalid even when it appears aligned now. This slice neither changes associations nor assumes a future cutoff or chest approval.

### Reward overflow findings

M1's technical maximum remains 2147483647 per enabled currency aggregate. No economic cap is invented. For positive configured SP `s`, the signed-integer wallet/balance-after storage admits only pre-claim balances at most `2147483647 - s`; a higher existing balance can overflow in the current addition/ledger insert. The current transaction would roll back, not safely fulfill the reward. The response exposes that derived threshold as `maximumSafeSpBalance`, with `balancesInspected=false`. A currently low balance would not guarantee headroom at a future claim, so no balance scan or assumed eligibility makes this PASS.

Positive XP also has a proven structural exposure: cumulative bigint values are mapped to JavaScript numbers and M1 adds the grant without a safe-integer guard. The derived threshold is `Number.MAX_SAFE_INTEGER - xp`, exposed as `maximumSafeXpTotal`. Above it, some totals cannot be represented exactly. A bounded lifetime policy or reviewed arithmetic/storage mitigation is not recorded, so this is BLOCKED rather than silently advisory. Reward ledgers, claims and arithmetic remain unchanged; no grants are attempted to demonstrate either risk.

For invalid or missing rewards, derived XP/SP amounts are null, not fabricated zero. A valid single-currency configuration correctly reports the omitted currency as zero and its unrelated addition check as PASS. Product approval blockers still apply. Configuration remains separate from safety and economic approval.

### Mission-details UI and freshness

Activation Readiness is a distinct read-only section at `/admin/missions`. Check readiness fetches persisted diagnostics on demand. It shows overall versus configuration status, unrecorded product approval, UTC evaluation time, mission revision, PASS/BLOCKED/WARNING explanations and actionable field-specific issues. It supplies no activation/deactivation/award control. Failed requests do not fabricate results and explanations render as escaped text.

Results are not automatically reused across mission selection or configuration changes. Successful metadata/rule/schedule/reward saves, detail reloads and new admin requests invalidate the old preview. Invalidating at request start also covers a revision-conflict failure that reveals another administrator's edit, without discarding unsaved editor inputs. In-flight old previews are aborted on invalidation; late responses cannot restore an obsolete checklist. If the endpoint's persisted revision differs from displayed details, the checklist is hidden with a reload/recheck message. A matching revision still describes only a point-in-time snapshot: time, related catalog/chest configuration and future policy can change without changing that mission revision. The preview is never activation authorization.

### Files and validation

Changed files relative to Slice 5:

- `backend/src/domain/adminMissionReadiness.ts`
- `backend/src/domain/adminMissions.ts` (readiness delegation only)
- `backend/src/http/adminMissionRoutes.ts`
- `backend/tests/adminMissionReadiness.test.ts`
- `src/types/adminMissions.ts`
- `src/components/admin/MissionReadiness.tsx`
- `src/components/admin/MissionAdmin.tsx`
- `src/components/admin/missionAdmin.test.mjs`
- `docs/MISSIONS_M2.md`

Focused backend suites: **453 passed, 0 failed**, including **48 new readiness cases**. Frontend admin/catalog/import-boundary suites: **85 passed, 0 failed**, including **11 new readiness cases**. Tests cover authorization/proxy, missing/unsupported/disabled rules, malformed advanced conditions, canonical filters, incomplete drafts, lifecycle and UTC conflicts, reward validity and exposure, active states, revision freshness, stale-response suppression and all editor invalidation paths. Backend tests compare every one of the 59 synthetic application tables before/after repeated service and HTTP requests, observe repeatable-read READ ONLY configuration, assert no write/row-lock statements or player-balance reads, reject client approval assertions and verify mutation methods cannot activate or award through this endpoint. Frontend/backend response contracts remain typechecked together.

No new migration is required; all existing SQL, schema snapshots and journal entries are preserved. Existing M1 processing, validators, claim, ledger and chest code are unchanged. Backend/frontend lint, typechecks, production builds and whitespace checks all passed, using loopback-only frontend application targets and preserving protected files and release commits. No production access, existing-database migration, activation, real reward grant, commit, push, merge or deployment occurs.

### Remaining activation prerequisites and next action

Resolve and record approved XP/SP budget/overflow decisions, mission objective/recurrence/window approval and the treatment of open claim expiry. Define approval revision freshness and activation-time cutoff/chest alignment before implementing a separately reviewed activation mutation. Unsupported event families and advanced conditions (including the existing validator gap), chest administration, immutable definition versioning and operational/deployment controls remain unfinished or separately scoped. Readiness does not verify a live deployment or authorize production changes.

The single next M2 action is to agree the reward-budget/overflow policy and recorded product-approval contract, then use those approved requirements for an approval workflow before any activation endpoint. No maximum amounts, approval records or reward policies are created by this slice.

## Slice 7: reward safety and approval contract foundation

### Authoritative arithmetic and atomicity

The shared grant boundaries in gameState.ts serve mission/chest claims, submission review rewards, reward-wheel grants and direct game-state operations; the shared SP debit serves purchases. Existing wallet/progression row locks, idempotency matching, transaction ownership and event semantics are preserved. No caller catches an unsafe-grant error and commits the surrounding reward transaction.

SP wallet and ledger balance-after columns are PostgreSQL signed integers. Previously JavaScript addition could compute a value above 2147483647 and rely on a later database error. XP totals and ledger snapshots are bigint columns mapped to JavaScript numbers; converting totals above Number.MAX_SAFE_INTEGER could already lose precision before addition. A successful SQL bigint write alone therefore did not establish an exact XP award.

New rewardArithmetic.ts guards enforce representation/storage bounds, not a product budget:

- Internal grant/debit amounts must be whole positive integers within the existing integer ledger amount column (1..2147483647). Invalid amounts fail before state initialization.
- After existing locks and idempotency lookup, SP addition/subtraction uses BigInt and rejects balances outside 0..2147483647. Existing insufficient-balance behavior is retained.
- XP progression and replay snapshot totals are selected as exact PostgreSQL text, validated with BigInt, and converted only within 0..9007199254740991. New totals use BigInt addition and reject overflow before conversion, ledger insertion, progression updates or reward events.
- Existing unsafe historical XP is rejected without rounding or rewriting it. Its reconciliation requires a separate, authorized decision. No legacy balances or frozen rewards are changed.
- Safe idempotent replays return their original receipt without adding again, including at the ceiling. An unsafe grant propagates out of the enclosing transaction: any prior SP credit, ledger/event insert, mission/chest claim status or claim key in that transaction rolls back. No amount is clamped, split, substituted or discarded. A failed claim does not reserve its key and may be retried after legitimate capacity resolution.

Error codes are REWARD_AMOUNT_INVALID (400), SP_BALANCE_UNSAFE, SP_BALANCE_LIMIT_EXCEEDED, XP_TOTAL_UNSAFE and XP_TOTAL_LIMIT_EXCEEDED (409). Existing insufficient-points and idempotency-conflict codes remain. These errors require explicit review, not blind retries. Frozen reward snapshots remain authoritative and unchanged.

Readiness keeps the stable SP_INTEGER_OVERFLOW_EXPOSURE and XP_PRECISION_EXPOSURE codes, now WARNING for positive rewards because exact, locked transaction guards prevent corrupted/partial awards. They remain PASS for an omitted currency. This supersedes the unmitigated arithmetic findings in Slice 6 above. A future claim can still be rejected when a wallet has insufficient headroom; product treatment of rejected claims remains undecided. REWARD_BUDGET_APPROVAL_MISSING and MISSION_PRODUCT_APPROVAL_MISSING remain BLOCKED. Technical validity is never economic approval.

### Read-only approval contract, not approval recording

GET /api/admin/missions/:missionId/approval-contract is SUPER_ADMIN-only, proxy-protected, private/no-store, UUID-validated and accepts no query assertions. It reads persisted mission/rule/reward configuration within a repeatable-read READ ONLY transaction. It performs no mutation, takes no row locks and reads no player balances. No mutation method exists for this endpoint.

The response proposes a future record contract containing mission ID, approved configuration revision, SHA-256 configuration digest, approval category, authenticated server approver ID and server UTC approval time. PRODUCT and REWARD_BUDGET are separate categories. Both currently return DECISIONS_REQUIRED and recordedApproval=null; recordingEnabled and allowsActivation are false. These are contract field requirements, not fabricated approver identities, timestamps or approval records.

The binding includes the stored mission revision and a deterministic digest of actual metadata, lifecycle/UTC schedule/cutoff, rule parameters/conditions and reward configuration. Any supported edit supersedes the binding; a legacy writer changing configuration without updating the revision also changes its digest. Binding equality alone does not authenticate an approver or constitute approval. Related policies and chest/catalog state must still be checked by a future reviewed workflow.

Product approval authority, reward-budget authority, economic policy and required review workflow have not been established. SUPER_ADMIN configuration permission is not assumed to confer business approval authority. Consequently approval persistence, approval mutation, approval audit insertion and enforcement are intentionally deferred. A future record must derive its actor/time on the server and write the approval and administrator audit atomically; no client-supplied actor/category assertions can issue an approval today. Existing configuration audit transactions remain unchanged and tested.

/admin/missions includes an on-demand Approval contract foundation section with separate product/budget decisions, current revision, configuration digest and UTC inspection time. It has no approval/activation controls. Configuration requests/reloads invalidate old results and abort pending reads; mismatched revisions are hidden. Existing editors, history and readiness remain available.

### Validation and scope

New synthetic database cases cover exact SP/XP ceilings, invalid amounts, historical unsafe bigint values, safe replay, insufficient debit, frozen mission/chest snapshot preservation, full transaction rollback, retry keys, competing claims and duplicate requests. Approval cases cover DTO parity, authorization, configuration/revision binding, read-only SQL, audit rollback of existing edits, invalid assertions, absent mutation routes and no activation/reward side effects. UI cases cover separate categories, read-only requests, failures, stale revisions, edit invalidation and late-response suppression.

PGlite concurrent-request tests share its single connection: they do not establish real multi-connection PostgreSQL row-lock behavior. Targeted PostgreSQL 18 multi-pool boundary/claim races remain a release verification requirement. The earlier nine PostgreSQL tests are not rerun here. No schema or migration is required; migrations 0026-0030, snapshots and journal are unchanged.

Slice 7 changed files:

- backend/src/domain/rewardArithmetic.ts
- backend/src/domain/gameState.ts
- backend/src/domain/missionApprovalContract.ts
- backend/src/domain/adminMissionReadiness.ts
- backend/src/domain/adminMissions.ts
- backend/src/http/adminMissionRoutes.ts
- backend/tests/rewardArithmeticDb.test.ts
- backend/tests/missionApprovalContract.test.ts
- backend/tests/adminMissionReadiness.test.ts
- src/types/adminMissions.ts
- src/components/admin/MissionApprovalContract.tsx
- src/components/admin/MissionReadiness.tsx
- src/components/admin/MissionAdmin.tsx
- src/components/admin/missionAdmin.test.mjs
- docs/MISSIONS_M2.md

Remaining decisions: product and budget approvers, approved economic policy (no numeric limits invented), review/expiry/revocation workflow, open-claim liability and treatment of capacity-rejected rewards. Activation, chest administration, advanced conditions and immutable definition versions remain separately scoped.

Single next development action: establish product/budget authority and approval policy, then implement revision-bound approval persistence with transactional audit from those approved requirements, before any activation workflow.

Validation results for Slice 7: focused backend **124 passed, 0 failed** (five suites); frontend admin/catalog/boundary **90 passed, 0 failed**. The broader backend run reports **1253 passed, 40 failed, 9 skipped**. All 40 failures occur in unchanged nativeAuth.test.ts beforeEach cleanup: TRUNCATE users ... CASCADE reaches the mission_admin_history table, whose migration 0027 BEFORE TRUNCATE trigger correctly rejects it as append-only. At that validation point this pre-existing M2 test-isolation incompatibility remained unresolved; the stabilization below repairs it without disabling audit protection. The nine opt-in real PostgreSQL tests are deliberately skipped without a disposable database URL. Backend/frontend typechecks, lint and production builds passed; git diff --check passed. next-env.d.ts, backend lockfile, all existing migration SQL/snapshots/journal, catalog audits and both release commit refs match their initial state. No production connection, commit, push, merge, migration or deployment occurred.

## Slice 7 stabilization: disposable authentication test isolation

A fresh JSON-reported reproduction confirmed all 40 nativeAuth.test.ts failures carry the same mission administrator append-only trigger exception. The shared beforeEach TRUNCATE users/auth tables CASCADE traverses user/admin foreign keys to mission_admin_history, whose statement-level BEFORE TRUNCATE trigger rejects the operation even on an empty table. No test-body assertion was reached. Migration 0027 and later history constraints are correct and are not weakened.

The test-only syntheticPglite helper constructs an owned in-memory template, applies the actual migration SQL, snapshots it into a private in-memory Blob, and closes the template. Each auth test opens an independent in-memory clone with newly bound repositories and disposes of it after the test. The legacy migration compatibility fixture is removed inside template initialization before audit-history migrations are established. There is no table reset SQL during per-test cleanup, no connection URL or persistent directory parameter, no environment-based target selection and no access to an existing PostgreSQL database. Invalid initializer/target inputs fail before constructing a database. Existing migrations and runtime audit/approval/reward logic are preserved.

Regression tests verify parallel clone independence, replacement clones with no residual users, preserved audit UPDATE/DELETE/TRUNCATE/CASCADE rejection, foreign keys and action constraints, and rejection of connection URL/path/options inputs. The focused auth/cleanup/reward run passed 65 tests, including every previously failing auth test. Full-suite and final validation results follow below.

The broader run also exposed a separate initial-checkout inconsistency: mission routes require MISSIONS_MANAGE but adminAuth.ts omitted it from both its permission union and SUPER_ADMIN set. Six M2 API tests consequently returned 403 and backend typechecking failed. Restored the already established SUPER_ADMIN-only mission configuration permission and added a direct role regression. REVIEWER retains no mission access; business approval/activation authority is unchanged and approval recording remains disabled. The initial two-worker broad run also encountered a 60-second synthetic fixture setup timeout; final broad validation uses one worker to avoid concurrent PGlite resource pressure. Independent parallel-clone behavior remains explicitly tested.

Stabilization changed files: backend/tests/nativeAuth.test.ts; backend/tests/helpers/syntheticPglite.ts; backend/tests/syntheticPglite.test.ts; backend/src/domain/adminAuth.ts; backend/tests/adminMissions.test.ts; docs/MISSIONS_M2.md. No runtime arithmetic code, reward policy, approval policy, audit migrations or constraints changed.

Final stabilization validation: complete backend suite **1299 passed, 0 failed, 9 skipped**, using --maxWorkers=1. All 40 originally failing native-auth tests and all six separately identified M2 permission-related failures pass. The only skipped tests are the nine opt-in real PostgreSQL integration cases, intentionally not connected in this task. Backend lint, typecheck and git diff --check pass. Reward-arithmetic, mission/chest claim atomicity, idempotency, approval read-only behavior and audit protection regressions pass in the full suite. No real PostgreSQL multi-connection claim/overflow locking guarantee is established by PGlite; dedicated disposable PostgreSQL 18 concurrency verification remains the next recommended development/validation task. No production access, existing-database cleanup, reward payout, migration, commit, push, merge or deployment occurred.

## Slice 7 real PostgreSQL completion ? 2026-10-22

The previously deferred real PostgreSQL boundary/concurrency verification completed on one newly created isolated local PostgreSQL 18.6 database, circzles_m1_verify_20261022_34f2570225ca: **18 PostgreSQL tests passed, 0 failed, 0 skipped**, plus **17 target-guard tests passed**. The retained database contains only synthetic test users and migrations 0000-0030 (31 journal entries). Existing circzles_m1_test was not connected to or modified. Observed multi-connection lock contention, safe SP/XP ceilings, atomic rejected claims, idempotency and frozen snapshots all passed. The only harness correction was normalized host(inet_server_addr()) comparison; no runtime reward logic or migrations changed. See MISSIONS_POSTGRES_VERIFICATION.md for exact isolation, evidence and tool details. Lint/typecheck/whitespace checks passed; unrelated full suites were not repeated.

No technical arithmetic/concurrency blocker remains in the checked Slice 7 scope. Approval recording remains deliberately disabled pending established product/budget authority, economic policy and review/revocation workflow; successful tests are not economic or deployment approval. Next development action: agree those decisions, then implement revision-bound approval persistence and atomic administrator audit from the approved requirements. No mission activation, production access, commit, push, merge or deployment occurred.

## Slice 8: persisted mission approvals and revocations

### Established initial-release policy

Authenticated, active SUPER_ADMIN users alone grant or revoke approvals. PRODUCT and REWARD_BUDGET are independent; the same administrator may grant both. Budget approval explicitly covers the current configured XP/SP amounts, including an omitted currency represented as zero. There is no invented global economic cap: integer storage constraints remain technical validation only. Approvals never expire automatically. Revocation or any new configuration revision invalidates their effective approval, even if values later revert. Both current categories are necessary for future activation. No approval operation activates a mission, assigns progress or grants rewards.

### Database and migration

New local migration 0031_mission_approvals adds mission_approvals (immutable grant records) and mission_approval_revocations (immutable revocation records, unique per grant). They store server-derived administrator identity and UTC time, exact mission revision, deterministic SHA-256 configuration digest, category and approved XP/SP amounts. Foreign keys restrict deletion of referenced missions/administrators/grants. Category, digest and amount checks enforce record structure. UPDATE, DELETE and TRUNCATE triggers protect both new tables. Existing administrator history keeps its immutable triggers; its action/snapshot constraints expand to APPROVAL_GRANTED and APPROVAL_REVOKED. No SQL or snapshots for 0026-0030 are rewritten. The journal appends 0031 and its generated schema snapshot.

Only newly constructed, isolated in-memory PGlite databases receive migration SQL for this slice. No existing local or production PostgreSQL database is migrated. M2 approval functionality now requires schema 0031; do not deploy this backend onto schema 0025-0030. There is no deployment authorization in this task.

### API and authorization

Existing GET /api/admin/missions/:missionId/approval-contract remains a read-only repeatable-read transaction over persisted configuration and approvals. It now returns current MISSING / APPROVED / REVOKED / INVALIDATED status independently per category, latest grant/revocation identities and UTC timestamps, exact approved amounts, current rewards and revision/digest binding. It does not claim that matching technical configuration alone is approval. No older grant is used as a fallback when a newer record is invalidated or revoked.

New endpoints:

- POST /api/admin/missions/:missionId/approvals/:category
- POST /api/admin/missions/:missionId/approvals/:category/revoke

category is strictly PRODUCT or REWARD_BUDGET. Both accept only expectedUpdatedAt, configurationDigest, expectedApprovalId and expectedRevocationId; IDs are loaded decimal strings or explicit nulls. Requests may not supply an actor, server timestamp, reward amount, approval boolean or active state. Authentication, SUPER_ADMIN permission, proxy protection, origin protection, strict query/identifier parsing and private/no-store responses follow existing mission routes. The service independently checks the actor is an active SUPER_ADMIN. Actor IDs come from the authenticated request session; times are server UTC values.

Grants require an inactive technically valid mission, including supported enabled rules, valid schedules/rewards and existing safety checks. Incomplete drafts, active definitions and unsupported technical configurations are rejected. Economic amounts are the exact current valid configuration, not a fabricated threshold. Revocation is allowed for the latest unrevoked grant, including an invalidated record or a synthetic active definition; it does not deactivate anything. A revoked or invalidated grant can be replaced only by a new explicit approval after review. Duplicate/stale requests fail 409 rather than silently creating more records.

### Atomicity and freshness

All grant/revocation transactions first lock the same mission row FOR UPDATE used by configuration edits. They then validate the current revision and digest plus latest category grant/revocation IDs. This serializes edits against approvals and provides an independent optimistic check for approval history changes without changing mission configuration revision. Product and budget grants can therefore approve one configuration independently without invalidating each other.

The mutation and its meaningful administrator before/after audit entry commit in one transaction. Audit insertion failure rolls back the new grant/revocation. Approval/revocation never updates prior approval rows, the mission active flag or mission updatedAt. Supported configuration mutations already advance updatedAt monotonically, by at least one millisecond even under equal test clocks; effective approval is derived from exact revision AND digest equality. Thus edit/revert creates a new revision and cannot revive an old approval. A failed configuration transaction leaves both revision and current approval intact. Existing configuration history provides the audit evidence for invalidation; historical grant/revocation records are retained unchanged.

Readiness reads approval status in its same READ ONLY snapshot. MISSION_PRODUCT_APPROVAL_MISSING and REWARD_BUDGET_APPROVAL_MISSING become PASS only for current, unrevoked matching records. Product approval also covers the exact configured claim window, including an explicitly reviewed open window where M1 permits one. Technical, UTC, unsupported-condition and chest-alignment blockers still apply. activationReady is a calculated future-readiness diagnostic, never a mutation or deployment/activation authorization. Approval records may remain valid while time-dependent availability checks become blocked.

### Admin UI

/admin/missions retains existing editors and adds persisted category status, grant/revocation IDs, approver/revoker, UTC dates, exact approved amounts and revision/digest. Each action requires an explicit confirmation checkbox. The server response supplies the saved state; stale/failed changes clear the old result and require inspection again. Pending changes prevent double submission and disable other configuration actions. Successful approval/revocation refreshes administrator history and invalidates the readiness preview. Configuration changes/reloads invalidate the approval inspection and abort stale reads. No activation/deactivation control exists. History displays approval action labels and before/after snapshots using escaped text.

### Capacity-failure review and release-policy issue

No M1 claim/deadline, arithmetic, ledger, wallet, progression or frozen snapshot code was changed. The authoritative claim transaction inserts its receipt and performs SP then XP grants; an unsafe grant propagates an error and rolls back the complete transaction. No successful claim key, partial SP/XP, ledger event or claimed status survives. Earned eligibility, snapshot and original deadline remain unchanged on capacity failure, allowing retry before that deadline. Existing expiry handling is preserved: at/after the original deadline the claim is rejected as MISSION_CLAIM_EXPIRED and its existing expiredAt bookkeeping may be recorded, without compensation or extension.

Unresolved release-policy issue: capacity can remain unavailable beyond a legitimate earned claim's deadline, producing an unpaid expired reward. XP is cumulative and has no ordinary debit path, so exhausted XP headroom is potentially permanent, unlike SP that may be spent. The supplied policy intentionally creates no automatic compensation, alternate reward or deadline extension. Release owners must explicitly accept this consequence or separately define a reviewed manual-remediation policy before activation; this slice does not invent one. A synthetic regression verifies preserved pre-deadline eligibility/snapshot/deadline, then rejection at the unchanged deadline with no claim or ledgers.

### Validation and scope

Focused synthetic tests cover separate categories, exact integer-boundary amounts without a global cap, no automatic expiry, no activation/rewards, actor/proxy/origin/expired-session authorization, strict payload rejection, revision/digest validation, edit/revert invalidation, all four editors, duplicate grants/revocations, concurrent category grants, edit-versus-approval races, atomic approval/audit rollback, failed-edit rollback, immutable tables and history, active-record revocation, readiness freshness and UI confirmation/history/error behavior. Frontend/backend JSON DTOs remain checked together. These new approval race tests use PGlite's single connection; they verify transaction/optimistic behavior but do not replace a future real PostgreSQL multi-connection approval-race check. The completed Slice 7 real PostgreSQL claim tests are historical evidence, not rerun or extended here.

Changed files relative to Slice 7:

- backend/drizzle/0031_mission_approvals.sql
- backend/drizzle/meta/0031_snapshot.json
- backend/drizzle/meta/_journal.json (append only)
- backend/src/db/missionAdminSchema.ts
- backend/src/domain/missionApprovals.ts
- backend/src/domain/missionApprovalContract.ts
- backend/src/domain/adminMissionReadiness.ts
- backend/src/domain/adminMissions.ts
- backend/src/http/adminMissionRoutes.ts
- backend/tests/missionApprovals.test.ts
- backend/tests/missionApprovalContract.test.ts
- backend/tests/rewardArithmeticDb.test.ts
- src/types/adminMissions.ts
- src/components/admin/MissionApprovalContract.tsx
- src/components/admin/MissionAdmin.tsx
- src/components/admin/MissionReadiness.tsx
- src/components/admin/MissionHistory.tsx
- src/components/admin/missionAdmin.test.mjs
- docs/MISSIONS_M2.md

Next remaining M2 feature: a separately reviewed activation/deactivation workflow that rechecks both approvals, technical readiness, time and chest/cutoff alignment under the mission lock; no such endpoint is implemented here. Real PostgreSQL approval-race verification and release disposition of unpaid expired capacity failures remain prerequisites to rollout. No production access, existing-database migration, real reward grant, commit, push, merge or deployment occurs.

Final Slice 8 validation: **370 backend tests passed, 0 failed, 0 skipped** across 11 targeted suites, including **33 new approval workflow cases** and the additional earned-capacity/deadline regression. **96 frontend admin/catalog/boundary tests passed, 0 failed**, including six new mutation/status/history cases. Backend/frontend lint and typechecks, backend production build and frontend Next.js production build passed. The initial sandboxed frontend build could not fetch Google Fonts; retry with network access succeeded without font/config changes. Application/database build targets were loopback-only and next-env.d.ts bytes were preserved. git diff --check passed. Completed full regression and real PostgreSQL suites were not rerun. No remaining technical failure was found in this scope; real PostgreSQL approval-race verification remains a separate validation prerequisite, and the unpaid-expired reward consequence remains documented for release review.

## Slice 8 real PostgreSQL stabilization ? 2026-10-22

Completed 20 real multi-connection PostgreSQL approval-integrity tests on the new retained local database circzles_m1_verify_20261022_032eaa0b8b37, PostgreSQL 18.6 at 127.0.0.1:5432 as circzles_test. All 20 passed with no failures/skips. Migration 0031 was tested for full rollback, retry and preservation of pre-existing inactive definitions/audit history; the resulting journal has 32 entries (0000-0031). Real lock waiters and audit commit visibility verified parent-row serialization, duplicate protection, actor/audit correspondence, invalidation, revocation, unique constraints and absence of premature readiness. All approval operations left player/progression/claim/ledger/event tables empty and every mission inactive. No runtime defect or source-policy change was required.

Additional focused approval/arithmetic/game-state/guard regressions bring the combined result to 105 unique passed, 0 failed, 0 skipped. A missing shared/ module in the initial temporary Linux copy was corrected there; only its failed-to-load game-state file was retried (14 passed). No populated PostgreSQL database was reset or rerun through the empty-database harness. Backend lint, typecheck and whitespace validation passed. See MISSIONS_POSTGRES_VERIFICATION.md for exact evidence and isolation details. Changed files for stabilization: backend/tests/missionApprovalsPostgres.test.ts, docs/MISSIONS_M2.md and docs/MISSIONS_POSTGRES_VERIFICATION.md. All existing source, migrations, protected files, audits and release commits are preserved; both older databases were untouched. No production access, commits, pushes, merges or deployments occurred.

The new approval-race verification prerequisite is now complete. Next development milestone remains the separately reviewed activation/deactivation workflow, including approval/configuration/cutoff/time/chest checks in the activation transaction. Release disposition of capacity failures that outlast unchanged earned deadlines remains documented; no automatic remediation is invented.


## Slice 9 ? controlled lifecycle operations (local implementation)

### Availability and mandatory release blocker

SUPER_ADMIN lifecycle review is available at /admin/missions. New POST /api/admin/missions/:missionId/activate and POST /api/admin/missions/:missionId/deactivate operations accept ONLY expectedUpdatedAt, configurationDigest and a UUID idempotencyKey. Neither dates, actor identity, approvals, reward amounts nor an active boolean can be supplied. Existing session, permission, production-proxy, same-origin and private/no-store protections apply. The service also independently requires an active SUPER_ADMIN.

Activation is deliberately fail-closed for every new request while CAPACITY_DEADLINE_POLICY_UNRESOLVED remains BLOCKED. This is now an explicit PRODUCT readiness check, even after both configuration approvals are recorded. There is no client, environment or test override. Approval recording remains available for technically valid inactive definitions; recording product approval does not silently resolve the separate release-policy decision. Technically valid approved configurations report configurationStatus PASS but activationReady false. Existing approval regression expectations were updated accordingly; historical Slice 8 verification evidence is unchanged.

The unresolved consequence is an earned reward that cannot fit in SP/XP capacity before its original deadline. Exact grant guards remain unchanged and atomic; no compensation, deadline extension, altered reward, successful claim receipt or partial payout is introduced. Release owners must separately settle the policy before enabling new activations. No new mission was activated through these operations during development.

### Transaction, concurrency and revision contract

Every lifecycle request locks the parent mission FOR UPDATE, then locks and verifies the server-derived administrator. This is the same parent lock used by configuration and approval changes. M1 event processing locks that mission FOR SHARE and rechecks active state, so deactivation waits for already-running progress transactions and prevents later processing after it commits. M1 claim/ledger/reward algorithms are unchanged.

For a new operation, the server reads current persisted configuration and validates the expected revision AND deterministic digest under that lock. Activation recomputes the entire readiness evaluator in the transaction, using server time sampled after lock acquisition. All configuration, rule, UTC schedule, reward, approval, chest and policy blockers apply. Both current independent approval records must match that configuration and its exact XP/SP totals. A new activation key for an already-active definition fails rather than bypassing this review.

The guarded activation transition retains the existing scheduled start and sets activationEffectiveAt to max(existing cutoff, transaction evaluation time). It revalidates the resulting schedule so the eligible interval cannot be emptied. No pre-cutoff backfill is introduced. Enabled chest links remain blocked pending reviewed cutoff alignment. Because the mandatory policy check cannot currently pass, a successful new activation transition and its cutoff behavior have not been exercised end-to-end; this is an explicit remaining validation prerequisite, not a claimed successful activation test.

Changed lifecycle state advances the shared updatedAt revision monotonically, invalidating earlier approvals. The operation receipt and audit capture the inactive approved binding and both approving record IDs when an activation eventually qualifies. Later deactivation/reconfiguration cannot revive those historical approvals. An already-inactive deactivation is an explicit audited no-op and retains its revision/approvals.

Each completed operation has an immutable receipt unique on (missionId, idempotencyKey). Same actor/action/binding/key replays the original receipt without reapplying state or writing another audit. Reusing the key with another actor/action/binding fails 409. Replaying a historical activation after deactivation returns the original operation receipt and NEVER reactivates the mission. Receipt active/revision values describe that operation, not necessarily current state; clients must reload details. Failed activation writes no receipt or audit. Failed audit insertion rolls back the mission update and receipt together. No automatic retry is attempted.

### Deactivation and UI

Deactivation does not require approvals or successful activation readiness, enabling an administrator to stop a problematic active definition. It preserves the event cutoff, schedule, reward configuration, frozen rewards, in-progress/earned progress, claim history, player balances and ledger records. Earned claims remain subject to their own original snapshots and deadlines; M1 periods/claim APIs continue to handle them independently of mission.active. No earned record or chest completion is deleted. Stopping new completions can prevent additional chest progress; it neither unlocks nor revokes an already-earned chest.

Lifecycle review explicitly fetches the current binding and, for inactive definitions, readiness. A modal confirmation dialog displays the mission, UTC revision and consequences. Activation confirmation stays disabled while any blocker exists, including the release policy. Deactivation requires an explicit confirmation checkbox. Stale bindings, failed reads and conflicting writes cannot be shown as success. Pending requests prevent double submission, reload aborts obsolete review, and a successful response reloads mission details, status, editors, readiness/approval inspection and administrator history. A lost response is reported as an uncertain outcome and requires reload; it is not treated as proof of rollback.

### Migration and local validation

New migration 0032_mission_lifecycle_operations adds only the lifecycle receipt table, its restricted foreign keys, unique mission/key index, payload/action checks and immutable UPDATE/DELETE/TRUNCATE triggers. It extends the administrator action/snapshot checks for MISSION_ACTIVATED and MISSION_DEACTIVATED. It reuses the existing append-only protection function and does not weaken existing history. Migration 0031 and earlier SQL/snapshots are unchanged. The generated 0032 snapshot changes only mission_admin_history constraints and adds mission_lifecycle_operations; the journal appends entry 32. Migrations were exercised only on newly constructed in-memory PGlite databases, never existing local or production databases.

Final test evidence and file list follow after validation. Real PostgreSQL multi-connection lifecycle verification remains a subsequent milestone; the retained Slice 7/8 verification databases were not opened or modified. Existing full-suite and real-PostgreSQL results were not rerun or represented as new Slice 9 results.


Slice 9 final local validation: **414 distinct backend tests passed, 0 failed, 0 skipped** across the 11 existing targeted M2/arithmetic/lifecycle suites (370), the new lifecycle suite (39) and disposable PGlite reset guards (5). The new suite covers authorization, strict payloads, persisted readiness blockers, current/stale/revoked/invalidated approvals, server-time expiry, competing requests and edits, duplicate replay, historical activation receipt replay without state mutation, protected earned snapshots, immutable receipts, unique keys and audit failure rollback. The 39 lifecycle tests use synthetic in-memory databases and serialized PGlite transactions, not observed multi-connection PostgreSQL lock contention. New successful activation is intentionally untested while the mandatory policy block remains; no test-only override was added.

Two existing reset-guard cases initially timed out at their unchanged five-second limit while several CPU-heavy checks ran concurrently. The entire five-case file passed when rerun alone; no timeout, assertion, cleanup or production protection was changed. **100 frontend admin/catalog/boundary tests passed, 0 failed, 0 skipped**, including four new lifecycle dialog, confirmation, stale/conflict and aborted-review cases. Backend/frontend lint (no remaining warnings), typechecks and production builds passed, as did git diff --check. Git still reports existing LF/CRLF conversion notices; no unrelated files were normalized. next-env.d.ts bytes were preserved around Next builds. Builds used unused loopback application/database targets and existing Google Fonts access only.

Files changed for Slice 9 (relative to the preserved Slice 8 working tree):

- backend/drizzle/0032_mission_lifecycle_operations.sql (new)
- backend/drizzle/meta/0032_snapshot.json (new)
- backend/drizzle/meta/_journal.json
- backend/src/db/missionAdminSchema.ts
- backend/src/domain/adminMissionLifecycle.ts (new)
- backend/src/domain/missionActivationPolicy.ts (new)
- backend/src/domain/adminMissionReadiness.ts
- backend/src/domain/adminMissions.ts
- backend/src/http/adminMissionRoutes.ts
- backend/tests/adminMissionLifecycle.test.ts (new)
- backend/tests/missionApprovals.test.ts
- backend/tests/missionApprovalsPostgres.test.ts (readiness assertions updated; real PostgreSQL suite not rerun)
- src/types/adminMissions.ts
- src/components/admin/MissionLifecycleControls.tsx (new)
- src/components/admin/MissionAdmin.tsx
- src/components/admin/MissionHistory.tsx
- src/components/admin/missionAdmin.test.mjs
- docs/MISSIONS_M2.md

The working index and both release refs remain unchanged. Hash comparison confirms all pre-existing files outside this list are unchanged, including migrations 0026-0031, next-env.d.ts, backend/package-lock.json and catalog audit files. No production access, existing-database migrations, real rewards, Git commits/pushes/merges or deployments occurred. Next implementation/verification milestone: isolated real PostgreSQL lifecycle contention and migration 0032 verification while activation remains blocked. Separately, a recorded release-policy disposition and positive activation/cutoff tests are required before enabling real activation; chest-linked activation remains outside this safe subset until its alignment is reviewed.


## Slice 9 stabilization ? real PostgreSQL and capacity-exception design review

### Completed local evidence (2026-10-22)

New retained database: circzles_m1_verify_20261022_4469e3ab4956. Verified PostgreSQL 18.6 (180006), literal TCP 127.0.0.1:5432, current/session role circzles_test. The normal techadmin creator used its existing CREATEDB permission, without superuser, after matching peer/TCP postmaster identity. Only the new database received CONNECT/CREATE and public-schema USAGE/CREATE permissions. No existing mission test database was opened or modified. Previous database catalog OIDs/owners remained unchanged; this is an identity check, not a claim that their application data was queried.

**21 real PostgreSQL tests passed, 0 failed, 0 skipped.** Migration 0032 was intentionally failed in a private migration copy: new DDL, lifecycle history constraints and journal changes rolled back, with the previous inactive definition and audit intact. The unchanged real migration then succeeded, leaving 33 journal entries (0000-0032). No repository migration was changed. Eight enabled immutable UPDATE/DELETE/TRUNCATE guards remain across lifecycle receipts, administrator history, approvals and revocations.

Seven competing-operation cases each observed two distinct PostgreSQL sessions waiting on Lock for missions FOR UPDATE before a third connection released the row. They covered same/different-key deactivations, blocked activations, activation versus approval grant/revocation/edit, and deactivation versus editing. Two further lock observations proved uncommitted lifecycle state/receipt/audit invisibility until atomic commit and deactivation waiting for an M1-processing-style FOR SHARE lock. Other cases covered authorization/session/proxy/origin protections, stale revisions/digests, approval invalidation and non-revival, immutable/unique receipts, key binding, protected earned snapshots/deadlines and audit-failure rollback with safe same-key retry.

All new activation attempts remained blocked; no blocker was bypassed and no successful activation was simulated. Only explicit synthetic existing-active fixtures were seeded to exercise deactivation/authorization. Final retained data has 11 lifecycle receipts, 27 administrator history rows, one synthetic player and one earned progress row. There are zero activation receipts, orphan lifecycle receipts, claims, XP/SP ledgers or game events. No rewards were granted.

Additional focused Windows checks passed: 39 lifecycle tests, 17 local-target guards and 21 reward arithmetic tests. Combined unique targeted result: **98 passed, 0 failed, 0 skipped**, including the 21 real PostgreSQL cases. Backend lint/typecheck and git diff --check passed. Existing full suites, frontend suites/builds and prior populated PostgreSQL verification suites were not rerun. A first local harness typecheck found two test-only typing errors; these were corrected before PostgreSQL execution. No runtime defect was discovered. The private Linux copy reuses the previously validated dependency installation after comparing package.json and normalized lockfile bytes; no installation, dependency upgrade or repository lockfile change occurred.

Evidence directory: /home/techadmin/.local/share/circzles-postgres-tests/s9_circzles_m1_verify_20261022_4469e3ab4956 (0700). It retains lifecycle-verification.json, test-output.txt, manifest.json and verification-summary.json. Credentials remained only in the existing local pgpass (0600, parent 0700) and process memory; the exact new database entry was appended without revealing its contents. The tested lifecycle source SHA-256 is 758419d98f34a3a102b7764a8ec4f153b620c184a0c282437866c05c38a89422.

### Verified claim/entitlement facts

- backend/src/domain/missions.ts, DrizzleMissionClaimRepository.claim: player/key advisory lock; successful receipt replay; server time sampled; earned playerMissionProgress row locked FOR UPDATE; ownership/status/deadline checked; frozen reward totals read; missionClaims inserted; SP grant then XP grant; receipt linked to ledgers; progress marked CLAIMED; mission.claimed event inserted. These writes share one transaction. A payout error rolls all of them back. A successful replay returns the previous receipt before checking normal expiry and never grants again.
- player_mission_progress is a durable earned entitlement: unique player/mission/period, completion, target/reward snapshots, original claimDeadline, status and expiredAt. It has no capacity-failure reason, failed-request key or server-accepted-at evidence. missionClaims is a successful-payout receipt, not a pending request; reusing it as an exception would falsely replay CLAIMED. mission.completed proves earning, not an in-time claim attempt.
- At or after the deadline, a normal claim returns MISSION_CLAIM_EXPIRED and may persist the existing expiredAt bookkeeping. Capacity failure before the deadline preserves the earned row but does not persist proof of an in-time attempt. A process log is not a transactional entitlement record.
- SP wallet and SP/XP ledger amounts are PostgreSQL integers. Cumulative XP is bigint but the current numeric API/cache representation must remain within 9007199254740991. Exact locked arithmetic prevents SP balance above 2147483647 and unsafe cumulative XP. Legitimate grants exceeding headroom fail with SP_BALANCE_LIMIT_EXCEEDED or XP_TOTAL_LIMIT_EXCEEDED. SP_BALANCE_UNSAFE, XP_TOTAL_UNSAFE and REWARD_AMOUNT_INVALID describe invalid state/configuration and must NOT be automatically reclassified as normal capacity exceptions.
- Chest claims have analogous frozen playerMissionChests/missionChestClaims and expiry behavior; their locks/receipt keys differ. Inclusion in a future exception policy must be explicit, not an incidental expansion of mission scope.

### Minimum proposed design ? NOT implemented or approved

The existing earned record can remain the entitlement authority, but existing tables cannot prove an in-time capacity failure. The minimum safe extension is separate durable capacity-exception storage linked uniquely to playerMissionProgressId, with append-only exception events and request-idempotency bindings. Do not add a fake successful missionClaims row, overload mission administrator configuration snapshots, mutate frozen rewards, or treat every completed-but-unclaimed mission as an exception.

A proposed exception record binds the authenticated player, earned entitlement/mission/period, original reward snapshot and deterministic digest, exact XP/SP amounts, original deadline, trusted server timeliness evidence, first capacity error, and version. A small current-state projection may be updated only with an atomic immutable event recording each transition; the original evidence/amounts/deadline are immutable. Store only required entitlement/operational identifiers, not credentials or unrelated personal information. A future migration would be append-only after 0032; none is created by this review.

**Normal claim transaction:**

1. Authenticate the player and bind the request key to the exact earned entitlement. Establish the approved server-side definition of submission time; clients cannot assert a timestamp. Acquire the existing player/key advisory lock and the entitlement FOR UPDATE lock. Under those locks, resolve previous successful receipts and existing exception request bindings before deciding whether any new mutation is permissible. Enforce the unique entitlement constraint across different keys.
2. Validate ownership, completed/claimable state, original frozen reward validity and the ORIGINAL deadline with the approved time definition. Never create a new exception for an already-late, unearned, already-paid or invalid request. Current M1 uses a server timestamp after the advisory lock but before the earned-row lock; it is not an HTTP receipt timestamp, and waiting can affect this distinction.
3. Put the complete existing successful-payout sequence inside a SAVEPOINT/nested transaction: claim receipt, SP/XP grants, balance/progression, ledger links, claimed state and emitted events. Preserve the current exact arithmetic, wallet/progression locks, original amounts and deterministic mission reward keys.
4. Only for the two explicitly recognized clean capacity-limit errors, roll back to that savepoint, then insert/find the exception and append its CAPACITY_BLOCKED evidence plus the request binding in the OUTER transaction while retaining entitlement serialization. A PostgreSQL error must first be rolled back to the savepoint; never attempt writes in an aborted subtransaction. Other errors roll back normally and do not manufacture capacity entitlements. If XP fails after SP, the SP ledger/balance/event and claim receipt must all be gone before the exception is recorded.
5. Return a distinct pending-exception result from the transaction and acknowledge it ONLY AFTER commit. Throwing the capacity exception inside the outer transaction would erase its evidence. If recording/auditing fails, roll back the entire transaction and report a failed/unknown attempt, not a durably registered exception. A lost response is recovered using the same key; a key reused for another entitlement conflicts. Neither an exception nor its replay reports CLAIMED, emits success events, pays rewards or moves the original deadline.

The same entitlement lock serializes same-key/different-key normal requests and future recovery actions. Existing receipt uniqueness on progress and player/mission/period plus deterministic per-currency ledger keys remain final no-double-grant defenses. Before-deadline retries while an exception exists need an explicit product contract; they must consult the exception under the lock and may not create an independent second payout path. A late request without an already committed, qualifying in-time exception must still fail normally. Late reads/replays of an existing exception are not new ordinary claims.

**Explicit recovery transaction (only after separate authority/semantics approval):**

Authenticate the specifically authorized administrator, derive actor/time on the server and require a reason, expected exception version/digest and resolution idempotency key. Lock the earned entitlement and then its exception in the same global order used by normal requests; verify original evidence, current resolution state and successful receipts before any grant. Retry ONLY the exact frozen unpaid reward using the existing authoritative payout helpers and canonical entitlement ledger keys, never an arbitrary amount or alternate credit reason. If safe, the real claim receipt, full XP/SP payout, progress completion, exception resolution, success events and administrator resolution audit commit together. A competing normal claim/resolution can only replay or conflict, never pay twice. If still capacity-blocked, roll back the entire payout savepoint and preserve the open exception, original entitlement and deadline; append an attempted-resolution audit only in the outer transaction. Failed audit means no successful resolution or payout. Other failures remain failures.

Paying an exception after its original deadline requires NEW explicit recovery authority. It is not already supported by M1 and must not be disguised as changing the normal deadline or accepting arbitrary late claims. If approved, normal deadlines remain immutable and expired normal claims still fail; recovery instead recognizes the separately proven in-time exception. An expiredAt marker on the normal claim does not, by itself, prove or destroy that separate right. Deactivation or later configuration changes must not silently replace the earned snapshot. Scope, any exception revocation and its authority must be explicitly defined rather than inherited from mission approval permissions.

At the XP ceiling there is no ordinary XP debit path. A pending record preserves evidence but cannot guarantee a safe payout will ever become possible under today's representation. Neither a balance reduction, widened numeric contract, substitution, write-off, compensation nor automatic retry is authorized by this review. A future safe representation change would require separate design/approval; until then unresolved cases must stay visible, not silently disappear.

### Exact outstanding product/authorization decisions

1. Approve the exception entitlement itself: does a valid in-time capacity failure preserve the ORIGINAL reward for explicitly authorized recovery after the original deadline? This is a new recovery right; the normal deadline remains unchanged. Specify mission-only versus also earned mission chests.
2. Define submission timeliness: authenticated server receipt time versus the current M1 transaction-time checkpoint, including queued/lock-waiting requests and equality at the deadline (M1 currently rejects equality). Do not rely on client timestamps or retroactively infer in-time attempts from completion records or untrusted logs.
3. Designate who may inspect, retry, resolve or revoke exceptions, whether separate approval is required, and what reason/evidence is required. Existing SUPER_ADMIN mission approval authority does not automatically authorize this new financial resolution workflow. The minimum proposed payable action is an explicit retry of the exact original frozen reward when safe; approve or reject that scope.
4. Define the interaction with normal pre-deadline retries/player-initiated retry and the pending response/player visibility contract. No automatic payout job, compensation or balance manipulation is proposed. All competing routes must converge on the same exception/entitlement and idempotency constraints.
5. Decide how permanently capacity-blocked XP entitlements remain accountable and how any non-payment closure could ever be authorized. Do not promise recovery by spending XP, silently expire the evidence, invent a write-off or extend a deadline.

These are proposed contracts for review, not newly established policy. No claim-exception schema/API/resolver or change to claim eligibility was implemented. CAPACITY_DEADLINE_POLICY_UNRESOLVED remains effective. The next step toward actual end-to-end activation is explicit approval of these bounded exception/recovery semantics, followed by a separately authorized implementation and its real PostgreSQL payout/exception race tests. Successful new activation remains untested and blocked until that prerequisite is resolved and verified.

Changed files for this stabilization: backend/tests/missionLifecyclePostgres.test.ts, docs/MISSIONS_M2.md and docs/MISSIONS_POSTGRES_VERIFICATION.md. Runtime code, migrations 0026-0032, lockfile, next-env.d.ts, catalog audits and release refs are preserved. No production access, real player payouts, deadline changes, commits, pushes or deployment occurred.


## Slice 10 ? bounded individual mission capacity recovery (2026-10-23)

This section supersedes the earlier unimplemented design and unresolved individual-mission capacity-policy blocker. The approved initial-release policy is implemented locally. Chest exceptions and enabled chest-linked activation remain deferred. Production is still through migration 0025; no production access or rollout was performed.

### Claim arrival and eligibility

Both individual claim routes (/api/missions/:missionId/claim and /api/missions/:missionId/periods/:periodKey/claim) obtain a private server timestamp from registerMissionArrival. A Fastify onRequest hook records it before authentication database lookups, body parsing and transaction/advisory/row locks. No browser timestamp, HTTP timestamp header or request-body assertion is trusted. Authentication and the existing empty-body, ownership, period and idempotency validation still apply. MissionClaimService/repository clone that server timestamp before acquiring locks; internal now remains a synthetic-test clock only, never an HTTP input. Missing HTTP arrival tracking fails closed. Equality with the original deadline remains late.

Arrival is evaluated against the original earned period/deadline, so authentication or database waits cannot move an eligible claim into another day or make it late. A request must already have an earned completion at arrival to create a capacity exception. The normal entitlement and its reward snapshot/deadline are never rewritten. An ordinary late claim with no existing qualifying exception still returns MISSION_CLAIM_EXPIRED.

### Durable exception and savepoint contract

Migration 0033_mission_capacity_exceptions adds three tables: mission_capacity_exceptions (immutable evidence, unique earned progress ID), mission_capacity_requests (immutable player/key bindings) and mission_capacity_events (immutable OPENED, RECOVERY_BLOCKED and RECOVERED transitions). Foreign keys restrict deletion; checks enforce clean amounts, a SHA-256 digest and an on-time original arrival; unique request/recovery keys prevent duplicate operations. Six UPDATE/DELETE/TRUNCATE triggers reuse the established append-only protection. No migration 0026-0032 or prior snapshot was rewritten. The journal appends entry 33; the resulting chain has 34 entries through 0033.

The claim transaction retains the existing player/key advisory lock and earned-progress FOR UPDATE lock. It checks existing successful receipts and pending key bindings under those locks. Only SP_BALANCE_LIMIT_EXCEEDED and XP_TOTAL_LIMIT_EXCEEDED qualify as clean capacity errors. Invalid amounts, invalid/unsafe stored balances or XP, missing configuration and other operational failures do not create an exception. Both currencies and the full exact response state are checked before classifying capacity: a full SP wallet must not mask corrupt XP.

The existing payout sequence now executes through payEarnedMission inside a nested Drizzle transaction/savepoint. Wallet/progression initialization and locks, claim receipt, exact SP/XP arithmetic, ledgers, balances, progression and emitted events remain inside that savepoint. If capacity is exceeded, the nested transaction rolls back completely before immutable exception evidence, a request binding and OPENED audit are inserted in the outer transaction. If recording/auditing fails, everything rolls back. The outer transaction returns a marker and commits before the repository raises the distinct MISSION_CAPACITY_PENDING HTTP 409 with exceptionId and an explicit no-award/admin-recovery message. Throwing before the outer commit would lose the entitlement evidence and is intentionally avoided.

Ordinary retries, including retries after expiry, can only replay an already recorded exception; they cannot create another exception or pay it, even if headroom has become available. Different keys bind to the same owned entitlement and serialize on its progress row. A key reused for a different mission/explicit period conflicts. Successful recovery retains existing canonical mission reward ledger keys and successful receipt uniqueness. A normal retry with an existing recovered request binding replays the actual successful receipt. A different unbound key against an already claimed period can still receive the existing already-claimed response; it never pays again.

### Explicit SUPER_ADMIN recovery and inspection

New routes, protected independently by both route permissions and service checks:

- GET /api/admin/missions/:missionId/capacity-exceptions?limit=25&offset=0
- GET /api/admin/mission-capacity-exceptions/:exceptionId
- POST /api/admin/mission-capacity-exceptions/:exceptionId/recover

The list remains available after original deadlines and includes permanently pending records. Existing session, active SUPER_ADMIN, production proxy, origin and private/no-store protections apply. Recovery also respects MISSION_CLAIMS_ENABLED=false: authenticated recovery returns 503 with Retry-After: 60 without any payout or new event, while inspection remains available. Recovery accepts only expectedEventId, digest, a nonblank reason (up to 2000 characters) and a UUID idempotencyKey. Actor, UTC audit time, frozen amounts, deadline, payout identity and status are server-derived. Client-supplied amounts, actors and timestamps are rejected. No compensation, write-off, exception revocation, deadline editing, balance adjustment or automatic payout endpoint/job was added.

Recovery locks the original player/key and earned progress in the same order used by normal claims, then verifies the active SUPER_ADMIN, current event revision, digest, original owner/mission/period, clean snapshot totals, unchanged original deadline and qualifying original arrival. It does not require a still-active mission or newly edited rewards: the earned frozen entitlement is authoritative. Only an existing valid exception authorizes recovery after normal expiry. A successful payout, real claim/ledger records and RECOVERED administrator audit commit atomically. A clean capacity failure rolls back all payout effects and commits only RECOVERY_BLOCKED with the authorized actor, reason and UTC time; the exception remains PENDING. Any other error or audit failure rolls back. No claimed state or partial currency grant survives failure.

Same-key recovery retries authenticate the actor and compare the recorded request; they return current exception state idempotently without granting again. A reused key with another actor/reason/binding conflicts. Different recovery keys still contend on the same entitlement and optimistic event revision, so only one successful resolution can commit. Exception/event evidence is append-only rather than a silently mutable approval flag. SP may eventually acquire headroom through legitimate gameplay spending; cumulative XP may remain blocked indefinitely. Such cases stay visible and auditable; this workflow never reduces balances, widens storage limits or promises an eventual unsafe payout.

### UI and activation readiness

/admin/missions adds an explicitly loaded, paginated Reward capacity exceptions section. It displays original amounts, arrival, original deadline, current status/revision and escaped immutable event history with administrator identity/reasons. Recovery requires a reason and an explicit authorization checkbox; only the server-confirmed response changes displayed status/history. A still-blocked attempt remains pending and resets the form for another separately authorized action. Errors/conflicts require reinspection, and uncertain lost responses are not presented as proof of rollback. Frontend-safe DTOs remain separate from backend implementation imports and are typechecked against the service result.

MISSION_CAPACITY_RECOVERY_AVAILABLE replaces the unresolved policy check for individual missions. It passes only when all three 0033 tables exist; otherwise readiness remains blocked with a migration requirement. This does not bypass product/budget approvals, supported rules, UTC scheduling, frozen reward validation, catalog availability, lifecycle checks or CHEST_LINK_REVIEW. Both approvals still bind the exact mission revision/digest and amounts. A real PostgreSQL synthetic test now verifies a technically valid, twice-approved individual mission can activate with a forward-only cutoff, idempotent replay and zero activation-time reward writes; it is then deactivated. No real mission was activated. Deployment controls and the separately authorized production rollout remain outside this local task.

### Verification, corrected findings and limits

Final local targeted backend validation: **650 passed, 0 failed, 0 skipped** across 21 targeted suites (645 mission/admin/claim/arithmetic/HTTP/guard cases plus five disposable-database cleanup/audit-protection cases). Final real PostgreSQL validation: **22 passed, 0 failed, 0 skipped** on the retained circzles_m1_verify_20261023_15c6652b1b2b database, PostgreSQL 18.6 / 127.0.0.1:5432 / circzles_test, independent backend sessions. Final frontend admin/catalog/boundary validation: **101 passed, 0 failed, 0 skipped**. Backend/frontend lint, strict typechecks, backend and Next.js production builds, and git diff --check passed. Existing full unrelated suites were not repeated. Application/database build targets were unused loopback addresses; next-env.d.ts bytes were preserved.

The first PostgreSQL attempt had 20 passing cases and one failed recording-time assertion: PostgreSQL now() reflected transaction start before the lock wait. Runtime exception/audit recording now explicitly captures actual record time, distinct from original arrival. The first populated database circzles_m1_verify_20261022_da97e4ffbf99 and evidence were retained. A subsequent run on circzles_m1_verify_20261022_5634b6c9f8ed passed 22 cases. Review then added the two-currency preflight so an SP capacity error cannot mask invalid stored XP. The FINAL 22-case run in the new 20261023 database includes that safeguard and is the authoritative evidence for current runtime code. None of these databases was reset or dropped. Earlier unit-test expectations of unrecorded failed claims and an unresolved policy were updated to the now-approved explicit exception/recovery semantics; no reward or audit guard was weakened. The frontend controlled-reason input test was corrected alongside its native input handler, and the complete 101-case group passed.

The final PostgreSQL run deliberately failed a private copy of 0033, verified rollback/journal preservation, and retried the unchanged migration. It observed two actual PostgreSQL lock waiters for five competing claim/recovery scenarios, tested arrival waiting beyond its deadline, safe post-expiry recovery, duplicate/no-double-grant behavior, and OPENED/RECOVERED audit-failure rollback. Final retained data: 16 exceptions, 4 recovered exceptions/claims, 4 XP and 4 SP ledger entries; zero unaudited successes, wrong amounts, missing OPENED audits, changed/late original deadlines, non-synthetic users or active missions. Six enabled new immutable triggers remain. Old database catalog OIDs/owners and credential permissions (0600 file / 0700 parent) were preserved. All payouts and capacity setup changes were synthetic fixtures only.

Private final evidence: /home/techadmin/.local/share/circzles-postgres-tests/s10_circzles_m1_verify_20261023_15c6652b1b2b, with capacity-verification.json, test-output.txt, manifest.json, verification-summary.json and the environment-file-free test copy. Test source SHA-256: 951de0bde92059ab789f988d2dc54542805ccb518e36bab1a726ff1860ff7be7. Tested mission runtime SHA-256: 2464f136d18ee9007c47f147ff6dc51d74514ae3f618a26ed839cb0f30a04be9. Existing validated Linux dependencies were reused after exact manifest/normalized lockfile comparison; no packages were installed/upgraded. The older opt-in M1/Slice 8/Slice 9 PostgreSQL source expectations were updated for the new policy/latest journal, but those complete populated-database suites were not rerun. They still require fresh authorized databases for a new execution; do not reset retained databases.

No individual-mission capacity-policy blocker remains in this tested scope. Chest exceptions, chest cutoff alignment and enabled chest-linked activation remain deferred. The next development milestone is an isolated end-to-end admin-to-player mission rehearsal, including claim/recovery UX and existing worker maintenance controls, before any separately approved release process. Production remains on 0025; source changes are uncommitted and unpublished.

Exact files changed relative to the preserved Slice 9 working tree:

- backend/drizzle/0033_mission_capacity_exceptions.sql
- backend/drizzle/meta/0033_snapshot.json
- backend/drizzle/meta/_journal.json
- backend/src/db/missionAdminSchema.ts
- backend/src/domain/adminMissionReadiness.ts
- backend/src/domain/adminMissions.ts
- backend/src/domain/missionActivationPolicy.ts
- backend/src/domain/missionCapacityExceptions.ts
- backend/src/domain/missions.ts
- backend/src/http/adminMissionRoutes.ts
- backend/src/http/app.ts
- backend/src/http/missionArrival.ts
- backend/tests/adminMissionLifecycle.test.ts
- backend/tests/helpers/missionCapacityCases.ts
- backend/tests/missionApprovals.test.ts
- backend/tests/missionApprovalsPostgres.test.ts
- backend/tests/missionArrival.test.ts
- backend/tests/missionCapacity.test.ts
- backend/tests/missionCapacityPostgres.test.ts
- backend/tests/missionLifecyclePostgres.test.ts
- backend/tests/missionPostgres.test.ts
- backend/tests/rewardArithmeticDb.test.ts
- docs/MISSIONS_M2.md
- docs/MISSIONS_POSTGRES_VERIFICATION.md
- src/components/admin/MissionAdmin.tsx
- src/components/admin/MissionCapacityPanel.tsx
- src/components/admin/MissionLifecycleControls.tsx
- src/components/admin/missionAdmin.test.mjs
- src/types/adminMissions.ts
- src/components/admin/MissionApprovalContract.tsx
- src/components/admin/MissionReadiness.tsx

The prior approval/readiness section copy now refers to the separate controlled lifecycle review rather than globally declaring activation unavailable.

## Isolated admin-to-player lifecycle rehearsal — 2026-10-23

Completed the individual-mission path through the real Fastify HTTP routes and PostgreSQL 18.6 repositories. This was an in-process `Fastify.inject` API rehearsal plus separate React DOM regression tests, not a browser connected to a deployed environment. No listener, background runner, outgoing integration or real notification was started. Synthetic supported `puzzle.added` events were appended through `GameEventService`; this does not claim to retest physical SKU ownership or video submission integrations.

Final fresh database: `circzles_m1_verify_20261023_677e9d2f2185`, literal `127.0.0.1:5432`, current/session role `circzles_test`, server version 18.6 / 180006. The harness independently verifies two backend connections, requires an empty schema and explicit disposable-database attestation, and checks the migration journal authorizes exactly 0000–0033 before applying it. All 34 migrations applied. Existing databases were not reset or opened for application queries. The first successful rehearsal database, `circzles_m1_verify_20261023_c208f643d519`, also remains intact; the final fresh run added journal preflight and administrator-history assertions.

Verified steps:

- Synthetic authenticated SUPER_ADMIN and player sessions use the actual session hashing and authorization repositories. Anonymous admin access is 401 and player admin mutations are 403.
- HTTP draft creation defaults inactive and reward-free and is invisible to players. HTTP rule, explicit UTC scheduling and explicit synthetic 7 XP / 3 SP configuration retain revision protections.
- Independent product and exact-budget approvals make persisted readiness pass. The guarded activation API activates locally; no bypass or automatic activation is provided.
- A supported, deduplicated event is processed explicitly, yielding one completion and an immutable original reward snapshot. The player periods API exposes earned progress.
- Deactivation preserves progress, snapshot and deadline. The normal period-specific player claim API pays once after deactivation; same-key replay does not pay again, a different key cannot duplicate a claimed entitlement, and `/api/me` agrees with ledger/wallet/progression results.
- An eligible in-time HTTP claim at SP capacity records a durable exception without claim, XP or SP writes. A player cannot authorize recovery. An administrator recovery while full remains blocked and audited. A ledger-backed synthetic spend creates headroom; explicit administrator recovery after the unchanged original deadline grants the original amounts once. Recovery and normal-claim replay cannot duplicate the payout. No recovery endpoint changes balances to create headroom.

Final retained data: two inactive missions, two successful claims, two XP ledger rows, three SP ledger rows (two credits and one synthetic debit), sixteen administrator history entries, one exception with `OPENED`, `RECOVERY_BLOCKED`, `RECOVERED` history, and no non-synthetic accounts. Every prior database catalog entry retained its OID/owner. No migration or backend reward/lifecycle implementation changed in this task.

### Player integration defects corrected

The player Missions page previously loaded only current active definitions and claimed by mission ID. It now uses the existing `GET /api/missions/periods` feed and `POST /api/missions/:missionId/periods/:periodKey/claim` route. Earned deactivated/previous-period rewards can remain visible and claims target the selected entitlement. Cards, pending requests, retry keys, errors and success state are keyed by mission **and period**, so one period cannot overwrite or claim another.

The frontend carries the existing claim deadline, displays it in UTC, and uses that deadline for a claimable reward's remaining time instead of showing an ended availability window. A manual refresh fetches newly processed progress. Capacity-pending, expired and maintenance responses now explain the actual outcome without a fabricated reward celebration; maintenance copy retains the original deadline. Successful payout is not repeated if status refresh fails. The current-definition API and legacy claim route remain available for existing callers; the Missions page uses explicit periods.

Validation: **4 real PostgreSQL HTTP scenarios, 210 focused backend tests and 92 frontend tests passed; 0 failed, 0 skipped**. Frontend coverage includes seven new player-mission regressions plus existing admin, player-state synchronization and frontend dependency-boundary checks. Backend/frontend lint, typechecks and production builds passed; `git diff --check` passed. The 210 backend cases cover mission processing/claims, capacity, lifecycle, readiness, approvals, arithmetic, arrival timestamps and local connection guards. Unrelated full suites and previously completed PostgreSQL contention suites were not repeated. The new frontend test is included in `npm test`.

### Remaining first-release gaps and milestones

The normal listing/period/claim APIs exist and the player Missions screen uses real backend data. A **player-owned read-only reward history/capacity-status API and UI are still missing**. The periods feed retains unexpired earned rewards, but expired pending exceptions and claimed inactive missions disappear from that feed; current capacity feedback is transient, while durable inspection is administrator-only. A recovered exception does not yet have a persistent player history view. This does not erase its entitlement or audit records, but it is a user-support gap before a complete player experience.

Mission progress currently refreshes on page entry and the new explicit refresh action; the general player-state event stream hydrates XP/SP, not this mission list. Consider mission-specific invalidation separately. Chest-linked activation and chest capacity exceptions remain deferred and blocked. Browser walkthroughs, actual SKU/submission emitter integration, controlled production release preparation and deployment remain separate; this rehearsal authorizes none of them.

Next development task: implement an authenticated, player-owned, read-only mission reward/exception history API and Missions history UI covering pending, blocked, recovered and claimed entitlements without extending deadlines or adding payout actions.

Exact files changed for this rehearsal and integration repair:

- `backend/tests/missionE2ePostgres.test.ts`
- `docs/MISSIONS_M2.md`
- `docs/MISSIONS_POSTGRES_VERIFICATION.md`
- `package.json` (register player mission tests only; dependencies unchanged)
- `src/components/missions/MissionExplorer.tsx`
- `src/components/missions/missions.tsx`
- `src/components/missions/missions.test.mjs`
- `src/lib/apiClient.ts`
- `src/services/index.ts`
- `src/types/index.ts`

All previous M1/M2 changes, migrations 0026–0033, release commits, backend lockfile, `next-env.d.ts` and catalog audits were preserved. No production access, commits, pushes, merges or deployments occurred.

## Individual Mission and Reward History — 2026-10-23

Implemented the read-only player history gap identified by the isolated lifecycle rehearsal. `GET /api/missions/history?limit=20&cursor=...` derives the player exclusively from the authenticated session. Limit defaults to 20 and is bounded to 1–100. Unknown parameters (including any player ID or offset), malformed cursors and request bodies are rejected. Anonymous, invalid and revoked sessions receive 401. Responses use `Cache-Control: private, no-store`; claims maintenance does not disable this read-only feed. The existing production `DrizzleMissionRepository` supplies history through `PlayerMissionService`; no new startup service or worker is introduced.

The query includes recorded individual mission progress irrespective of definition activity or elapsed claim windows. It returns an explicit whitelist: entitlement/mission IDs, current title and its provenance, original period key, saved counts, completion/claim states, persisted UTC dates, reward evidence and sanitized capacity status. It does not return player IDs, administrator identities, internal recovery reasons/error codes, recovery request payloads, approval data, digests, idempotency keys or raw event history. Capacity and claim joins are additionally scoped to the session player. A single SELECT observes receipt and latest immutable capacity transition consistently, without modifying expiry, progress, receipts, balances or audit records.

History states:

| State | Evidence and meaning |
| --- | --- |
| `IN_PROGRESS` | Persisted tracked progress, no completed entitlement yet. |
| `UNCLAIMED` | Earned record with no receipt or recorded capacity exception, before any original deadline. This history does not itself authorize a claim. |
| `EXPIRED` | Original ordinary claim deadline has elapsed or persisted expiry exists, with no successful receipt or capacity exception. |
| `CAPACITY_PENDING` | Durable in-time exception awaiting explicit administrator recovery, including after expiry. |
| `CAPACITY_BLOCKED` | Latest recorded administrator recovery attempt was capacity-blocked; this is a historical result, not a fresh wallet-headroom assessment. |
| `RECOVERED` | Successful receipt and immutable recovered transition exist. Original amounts and deadline remain unchanged. |
| `PAID` | Successful ordinary receipt exists. |
| `REVIEW_REQUIRED` | Legacy/inconsistent claimed or recovered status lacks its successful receipt; no payment is invented or authorized. |

Amounts prefer the actual persisted claim receipt, then the earned reward snapshot, then an exception's original reward snapshot. Missing/invalid legacy reward evidence is returned as `rewards: null` / `rewardSource: UNAVAILABLE`; mutable current reward definitions are never substituted and missing rewards are not displayed as zero. Actual zero-valued receipt fields remain their recorded values. Completion status and claim status are separate fields so an expired earned mission does not appear incomplete or paid.

**Historical name limitation:** existing entitlement, receipt and exception schemas do not persist a mission-title snapshot. Completion events also do not store it. The feed explicitly labels `titleSource: CURRENT_DEFINITION`, and the UI explains that names reflect current definitions. It does not reconstruct an uncertain title from administrator history or fabricate a legacy snapshot. Preserving exact future completion-time names would require a separately reviewed snapshot/schema change; no migration or backfill is included here. Likewise absent legacy dates remain null / “Not recorded”.

Ordering is newest **recorded progress** first (`created_at DESC`, then entitlement UUID DESC), rather than mutable last-update/completion time. An opaque, validated keyset cursor retains PostgreSQL timestamp microseconds; JavaScript millisecond truncation cannot skip tied records. Newer inserts do not shift already paged records. Page size is bounded and no total-table count is required. A cursor is only a pagination boundary, never a player identity or authorization assertion; even a cursor copied from another account cannot select that account's data.

The `/missions` dashboard now has a separate **Mission History** section below the existing MissionExplorer. It provides explicit refresh and “Load older history”, UTC timestamps, saved XP/SP values, missing-evidence explanations, paid/expired/pending/blocked/recovered descriptions and honest loading/error/empty states. It exposes no claim, recovery or reward mutation controls. Loading an older page preserves earlier rows; a failed page can retry the same cursor. Session-version/account changes remount the history feed, clear prior results and abort/ignore late responses so old-session history cannot reappear. Mock mode displays availability information instead of fabricated player history. The existing active mission list, period-specific claim behavior and controls are unchanged.

Validation completed locally: **379 backend tests, 100 frontend tests passed; 0 failed, 0 skipped.** Twenty-three new backend history cases use newly constructed, in-memory PGlite databases with migrations 0000–0033. They verify real SQL repositories, actual authenticated HTTP history routes, revoked/anonymous sessions, player isolation, malformed inputs/cursors, inactive and expired records, pending/blocked/recovered and ordinary paid states, legacy evidence, exact historical amounts, tied/microsecond pagination, inserts between pages, and execution inside a `BEGIN READ ONLY` transaction. Backend typechecking also compares the independently defined frontend/backend DTO contracts. Existing processing, claim/capacity, arithmetic, lifecycle, readiness, approval, arrival, HTTP and local-connection guards passed. Eight new frontend history cases plus existing mission/admin/live-state/boundary coverage verify read-only requests, all statuses, UTC display, missing snapshots, pagination/retry, session isolation, recovered refresh and mock behavior. The new frontend suite is registered in `npm test`.

Backend/frontend lint, typechecks and production builds passed; `git diff --check` and explicit whitespace checks for newly created files passed. No retained PostgreSQL database was opened or modified and no PostgreSQL contention suite was repeated: this slice adds a read-only query, not a new grant/concurrency path. No dependency, migration, reward, approval, activation or deadline policy changed.

Exact files changed in this slice:

- `backend/src/domain/playerMissionHistory.ts` (new read-only query, DTO and validated cursor)
- `backend/src/domain/missions.ts` (history repository/service delegation)
- `backend/src/http/playerMissionHistoryRoutes.ts` (new authenticated GET route)
- `backend/src/http/app.ts` (route registration)
- `backend/tests/playerMissionHistory.test.ts`
- `src/types/missionHistory.ts`
- `src/lib/apiClient.ts` (credentialed, uncached history GET)
- `src/components/missions/MissionHistory.tsx`
- `src/components/missions/missionHistory.test.mjs`
- `src/app/missions/page.tsx` (separate history section)
- `package.json` (test registration only)
- `docs/MISSIONS_M2.md`

The persistent player reward/exception visibility gap is resolved for recorded entitlements. Remaining work before a complete first individual-Missions release: a browser walkthrough through the actual authenticated proxy and real SKU/submission event emitters using synthetic local data, an explicit decision on prospective title snapshots, and the separately authorized controlled release of existing migrations/backend/frontend/worker controls. Live updates of mission progress/history are still explicit refresh; general XP/SP hydration remains unchanged. Chest-linked activation and chest capacity exceptions remain deferred. Permanently capacity-blocked exceptions remain visible and require the established administrator workflow; no compensation, automatic retry payout or deadline extension is introduced.

Single next development milestone: a local browser rehearsal of the complete admin → actual supported player action → completion → claim → persistent history experience, including logout/account switching and recovery visibility.

Protected M1/M2 work, migrations 0026–0033, release commits, `next-env.d.ts`, lockfiles and catalog audit files were preserved. No production connection, backup, migration, commit, push, merge or deployment occurred.

## Real local browser rehearsal — 2026-10-23

The next individual-Missions milestone is now verified in actual headless Chrome 155.0.8059.85 using Playwright Core 1.58.2 and the real local Next.js proxy. **All 30 requested browser workflow checks passed**, including native SUPER_ADMIN/player authentication, mission draft/configuration/independent approvals/readiness/activation, actual Add CircZles events, processing, frozen rewards, player claims/progression, persistent paid history, logout/account isolation, denied ordinary-player administration/recovery, capacity failure and authorized recovery, exactly-once ledger reconciliation, and historical retention after deactivation.

The new isolated PostgreSQL 18.6 database `circzles_m1_verify_20261023_396a1eb04ec6` was verified on literal 127.0.0.1:5432 as `circzles_test` before migrations 0000–0033. It remains intact. Existing retained databases were not reset or opened for application queries. The QA backend used a new test-only guarded helper, explicit processing and fail-closed integration adapters; it did not run the normal server startup or automatic workers. The frontend used a separate temporary copy without environment files and explicit loopback URLs. Both QA servers and the owned browser were stopped after verification.

No product/runtime defect required correction. Final synthetic state: one inactive mission with eight admin audit entries; two claimed frozen 7 XP / 3 SP entitlements; exactly two successful claims, two XP ledger rows and two SP credits; one explicit synthetic SP debit; one OPENED → RECOVERED exception. Neither payout duplicated. A second ordinary account had empty history. There were no browser page errors. SSE was deliberately absent in the QA harness, so existing canonical-state fallback and explicit mission/history refresh were used.

Additional focused validation: **40 backend and 86 frontend tests passed, 0 failed, 0 skipped**; backend/frontend lint, typechecks, production builds and whitespace checks passed. No unrelated extensive suites were repeated. Exact files added/changed for this rehearsal: `backend/tests/helpers/missionBrowserServer.ts`, `docs/MISSIONS_BROWSER_REHEARSAL.md` and `docs/MISSIONS_M2.md`. No migration, production source, dependency or approval/reward/deadline policy changed.

See [MISSIONS_BROWSER_REHEARSAL.md](MISSIONS_BROWSER_REHEARSAL.md) for the 30-check results, exact environment, test-only command contracts, ten screenshot paths, sanitized evidence location, ledger reconciliation and scope limitations. Historical title snapshots, external integrations, submission emitters and automatic worker behavior retain their separately stated scope; chests remain deferred. The next milestone is a reviewed individual-Missions release candidate. Production remains on 0025, and no Git publication or production action is authorized by this rehearsal.


## Daily / Weekly Chests - consolidated local implementation (2026-10-24)

This section supersedes earlier statements deferring chest configuration and capacity exceptions. The user explicitly approved the same bounded recovery policy for chests. Production remains unchanged on schema 0025. No production connection, backup, migration, Git publication or deployment was performed.

### Reused foundation and product contract

Reuses M1's mission_chests, mission_chest_eligibility, player_mission_chests, mission_chest_completions and mission_chest_claims; original UTC periodBounds/periodKeyFor/claimDeadlineFor; event-driven unique mission completion provenance; frozen reward snapshots; and authoritative exact XP/SP grant transactions. Individual reward claims never contribute to chest eligibility.

Daily configuration requires exactly five distinct eligible active DAILY missions and target three. Weekly requires six WEEKLY missions and target four. Daily resets at 00:00 UTC; weekly Monday 00:00 UTC. Claims are manual, with the existing 24-hour post-period grace. At most one successful payout per player/type/period across all chest definitions; a pending capacity exception reserves that same slot. Replacement definitions cannot steal it. Multiple definitions do not imply multiple payouts.

Inactive drafts contain no rewards or enabled eligibility. Optional XP/SP omission uses null, never invented zero/default rewards; at least one explicitly configured positive supported amount is required for approval. Existing storage bounds (1-2147483647 per configured currency) are representation limits, not approved budgets. At this earlier chest rehearsal, Daily 25 SP / 20 XP and Weekly 100 SP / 75 XP were provisional, not seeded or approved. Those figures are now superseded by the 2026-10-24 approved product templates described above. The historical synthetic tests/browser fixtures explicitly used 1 XP + 1 SP instead.

### Administration and HTTP contracts

All routes below require authenticated active SUPER_ADMIN authorization through MISSIONS_MANAGE, the existing production proxy guard and write-origin protection. Actors are derived server-side; strict payloads reject actor/reward/activation injection into draft creation.

- GET/POST /api/admin/mission-chests - paginated list / inactive draft (title, periodType).
- GET/PATCH /api/admin/mission-chests/:chestId - detail/readiness / inactive configuration (title, missionIds, explicitly supplied xp and synapsePoints, nullable UTC startsAt/endsAt, expectedUpdatedAt).
- GET /api/admin/mission-chests/:chestId/history - bounded administrator history.
- POST /api/admin/mission-chests/:chestId/approve-product and /approve-reward-budget - independent immutable approvals.
- POST the corresponding /revoke-product and /revoke-reward-budget routes - independent audited revocations.
- POST /api/admin/mission-chests/:chestId/activate and /deactivate - confirmed lifecycle operations.
- GET /api/admin/mission-chests/:chestId/capacity-exceptions and GET /api/admin/chest-capacity-exceptions/:exceptionId - SUPER_ADMIN-only inspection.
- POST /api/admin/chest-capacity-exceptions/:exceptionId/recover - explicit frozen-reward recovery, respecting MISSION_CLAIMS_ENABLED maintenance.

Approval/lifecycle input includes expectedUpdatedAt, configurationDigest and UUID operationKey; category operations also send the loaded expectedApprovalEventId. Parent row locks serialize edits, approvals, revocations and lifecycle operations. Product and budget approvals are separate immutable events; both must match the exact revision and deterministic digest (including selected mission revisions). Edits or later revisions never revive historical approvals. Replaying an old activation key after deactivation does not reactivate the chest. Approvals do not expire automatically, activate or pay anything. Lifecycle changes require fresh review for a new revision. Revoking approval does not itself deactivate an already active definition; deactivation is an explicit separate action.

Activation recomputes blockers inside the transaction: correct 5/3 or 6/4 configuration, valid supported enabled M1 rules, matching active mission category/period, usable overlapping availability, valid configured rewards, both current approvals and installed durable chest capacity recovery schema. No client readiness assertion is trusted. Blocker codes: CHEST_MISSION_COUNT_INVALID, CHEST_ELIGIBLE_MISSION_INVALID, CHEST_ELIGIBLE_MISSION_CONFIGURATION_INVALID, CHEST_WINDOW_INVALID, CHEST_WINDOW_EXPIRED, CHEST_REWARDS_INCOMPLETE, CHEST_CAPACITY_RECOVERY_REQUIRED, CHEST_APPROVALS_REQUIRED. Readiness is point-in-time, not a stored activation state.

A shared administrative lifecycle advisory lock coordinates mission/chest operations; linked mission share locks and eligibility cutoffs protect processing alignment. MISSION_ACTIVE_CHEST_DEPENDENCY rejects deactivating a mission required by an active chest: explicitly deactivate that chest first. Existing M1 CHEST_LINK_REVIEW is retained. Deactivation disables prospective eligibility only, preserving completion provenance, frozen snapshots, earned periods, claims, balances and original deadlines. CHEST_CURRENT_PERIOD_CONFIGURATION_LOCKED prevents eligibility/reward/window changes while any unfinished current-period progress exists; title-only edits remain allowed. The parent processing/configuration lock protects this check, so reconfiguration cannot mix progress from different pools. Use a new inactive draft for future configuration or wait for the UTC reset. Mutations and append-only administrator audit writes commit atomically. Audit insertion failure rolls back configuration changes.

/admin/missions now also contains Chest Builder: list/pagination, inactive creation/configuration, exact mission checkboxes, explicit reward inputs, UTC availability, readiness, separate approval/revocation confirmation dialogs, activation/deactivation confirmation, before/after audit history and explicit capacity recovery. No default or automatic production approval exists.

### Player cards, history and capacity recovery

Existing authenticated GET /api/mission-chests and POST /api/mission-chests/:chestId/periods/:periodKey/claim remain; claim arrival is now captured in the existing private onRequest timestamp before authentication/locks. The claim accepts only an empty body and Idempotency-Key, never client arrival/player identity. New GET /api/mission-chests/history derives ownership exclusively from the session and uses limit (1-50, default 20) plus opaque cursor with deterministic period-end/UUID ordering. Unknown history parameters are rejected. No administrator reasons, identities or recovery notes are exposed.

/missions has Daily/Weekly cards, eligible mission completion markers, progress bars, exact configured/frozen reward amounts, UTC period end/deadline, manual claim and retry/error states, session-bound state refresh and separate cursor-paginated Chest History. History includes inactive and expired periods, pending/blocked capacity and recovered/paid states. Missing historical reward evidence is reported as missing, never filled from mutable current rewards. Titles/eligible labels are explicitly current-definition data, not fabricated historical snapshots.

Eligible on-time capacity failures roll back all reward effects inside a savepoint before immutable exception evidence is committed in the outer transaction. Only SP_BALANCE_LIMIT_EXCEEDED / XP_TOTAL_LIMIT_EXCEEDED qualify; corrupt or inexact stored XP is not a capacity exception. Original earned entitlement, reward digest, amounts, trusted arrival and deadline are retained. No successful claim, wallet, progression, ledger, notification or reward event survives failed payout. Ordinary expired attempts cannot open an exception; pending exceptions do not consume earned eligibility, expire away or automatically pay.

SUPER_ADMIN recovery locks the original chest/period/earned state, revalidates immutable evidence and current wallet capacity, and pays only the original frozen amounts through existing stable ledger keys and one-period uniqueness. Recovery may occur after the unchanged original deadline only for a previously recorded qualifying exception. Blocked attempts append RECOVERY_BLOCKED and remain inspectable. Successful recovery appends RECOVERED atomically with the payout; retries and concurrent requests cannot double-grant. No compensation, balance manipulation endpoint, automatic payout, claim deadline extension or chest-specific reward economy was added.

### Appended migrations and verification scope

0034_mission_chest_administration.sql adds immutable chest administrator events, nullable inactive draft rewards, selected eligibility, configuration revision and global player/type/period claim uniqueness (backfilling period_type from the existing definition). 0035_chest_capacity_recovery.sql adds immutable exception heads, request bindings and transition history. Snapshots/journal appended; migrations 0026-0033 are unchanged.

Migration preflight must check for any legacy duplicate player/type/period chest claims: the new uniqueness constraint intentionally fails closed rather than deleting or merging payments. Production is still on 0025 with neither migration applied. A reviewed backup, controlled worker/claims rollout and separately authorized deployment remain required.

Final local validation: **257 focused backend tests, 17 real PostgreSQL tests, 95 frontend tests and 23 browser workflow checks passed**, with zero failures/skips in those executions. Backend lint, test/build typechecks and production build passed; frontend focused lint, typecheck and Next production build passed. Drizzle migration metadata check passed. Git whitespace verification passed (only existing LF/CRLF advisory messages). The frontend graph/import guard confirms no backend implementation enters Next compilation. Original expiry bookkeeping remains intact; the existing reward-arithmetic regression now expects CHEST_CAPACITY_PENDING while still asserting all reward state rolls back.

Backend focused files: missionChestAdmin, missionLifecycleDb, missionClaims, missionCapacity, rewardArithmeticDb, adminMissionLifecycle, adminMissionReadiness, missionApprovals, missionControls, missionControlsSchema, missionArrival and playerMissionHistory. PostgreSQL: missionChestsPostgres. Frontend: missionChests, missionHistory, missions, missionAdmin and frontendBoundary. These were relevant focused checks, not a repeated full repository suite.

Browser/backend temporary servers were stopped and loopback ports 3107/4107 verified closed. Retained synthetic databases must not be reset or reused to bypass the empty-schema guards. Original M2 files outside this feature, next-env.d.ts, backend lockfile, catalog audits, migrations 0026–0033 and both M1 release commits were preserved. No index staging or Git publication occurred.

The product review action recorded at this earlier rehearsal was completed on 2026-10-24: Daily 50 XP / 100 SP and Weekly 200 XP / 250 SP are approved as templates, without bypassing per-configuration approvals. A consolidated code/security review and separately authorized release preparation remain required before real activation. Historical names are current-definition labels where no historical snapshot exists; no historical data was invented. Advanced chest conditions, non-XP/SP rewards and automatic recovery remain outside this initial contract.

Exact files changed by this chest effort (relative to the preserved pre-task working tree):

- `backend/drizzle/0034_mission_chest_administration.sql`
- `backend/drizzle/0035_chest_capacity_recovery.sql`
- `backend/drizzle/meta/0034_snapshot.json`
- `backend/drizzle/meta/0035_snapshot.json`
- `backend/drizzle/meta/_journal.json`
- `backend/src/db/missionChestSchema.ts`
- `backend/src/domain/adminMissionChests.ts`
- `backend/src/domain/adminMissionLifecycle.ts`
- `backend/src/domain/adminMissions.ts`
- `backend/src/domain/chestCapacityExceptions.ts`
- `backend/src/domain/missionChests.ts`
- `backend/src/http/adminMissionRoutes.ts`
- `backend/src/http/app.ts`
- `backend/tests/helpers/chestCases.ts`
- `backend/tests/helpers/missionBrowserServer.ts`
- `backend/tests/missionChestAdmin.test.ts`
- `backend/tests/missionChestsPostgres.test.ts`
- `backend/tests/rewardArithmeticDb.test.ts`
- `docs/MISSIONS_BROWSER_REHEARSAL.md`
- `docs/MISSIONS_M2.md`
- `docs/MISSIONS_POSTGRES_VERIFICATION.md`
- `package.json`
- `src/app/admin/missions/page.tsx`
- `src/app/missions/page.tsx`
- `src/components/admin/ChestAdmin.tsx`
- `src/components/admin/ChestCapacityPanel.tsx`
- `src/components/missions/MissionChests.tsx`
- `src/components/missions/missionChests.test.mjs`
- `src/lib/apiClient.ts`
- `src/types/missionChests.ts`

## Final local candidate verification, 2026-10-24

`backend/src/config/missionChestProduct.ts` records the approved product schedule and unchanged Daily 5/3, Weekly 6/4, UTC reset/manual/24-hour-grace rules. SUPER_ADMIN-only `GET /api/admin/mission-chests/product-policy` returns that template. The explicit template button fills inactive reward inputs without saving, approving or activating anything. Blank drafts and separate revision/digest-bound product/budget approvals remain enforced. Existing earned snapshots and individual budgets are unchanged.

Consolidated checks: **587 focused backend, 97 frontend, 104 real PostgreSQL and 28 browser assertions passed**; no failures or skips in final runs. Backend/frontend lint, typechecks, production builds and whitespace checks passed. PostgreSQL migration generation reported no schema drift. The fresh baseline-0025 upgrade test preserves 16 synthetic tables including ownership, approved submission/review/grant, a 195000 ms benchmark, leaderboard and XP/SP balances/ledgers across full pending-batch rollback/retry through 0035. Real approval/lifecycle/claim lock contention remains covered.

The initial PostgreSQL lifecycle test failure was an obsolete expectation that the resolved capacity policy still blocked a fully valid mission; it now uses a disabled rule. Final migration count assertions now expect 36; shared lifecycle advisory lock waits are recognized alongside actual parent-row lock waits. No runtime readiness/audit protection was bypassed.

The browser paid exactly 250 XP / 350 SP across manual Daily/Weekly claims, with two XP and two credit ledger rows and zero individual mission claims. A failed Daily 50 XP / 100 SP payout left no grant; explicit recovery after a synthetic ledger-backed 100 SP spend paid once. Player isolation, history after deactivation and a non-admin 403 on the template endpoint were verified. All data was synthetic and all databases were newly created; no production service was started.

No new migration was added in this preparation. Migrations 0026-0035, their snapshots, release refs, lockfile, `next-env.d.ts` and catalog audits were preserved. Remaining work is reviewed reproducible release artifacts and the separately authorized backup/recovery, Render fleet quiescence, migration/deployment and real definition-approval/activation gates in the consolidated report. Rewards shop, cosmetics, social/advanced mission semantics and automatic recovery are not part of this release.
