# Starter Missions — local implementation and inactive batch

The collection structure is finalized for 14 new inactive drafts (4 Daily, 6 Weekly, 4 lifetime achievements). All new individual XP/SP amounts remain PROPOSED, not approved. No production connection, draft creation, reward approval, activation, or payout was performed. The existing Start Your Circle definition and Daily/Weekly chest budgets are outside this batch.

`manifest.json` contains all 14 new concepts, exact proposed currency amounts, event names, targets, counting methods, periods, collectible associations, stable keys, and a review digest. It is generated from `backend/src/domain/missionStarterManifest.ts`; the backend regression test checks that they agree. Every entry requires the new local migration **0036** before use. Existing single-event puzzle/submission concepts already work in the deployed engine; new tracking and collectibles require separate review and deployment.

## Concepts and proposals

| Category | Title | Recorded action / target | XP | SP |
| --- | --- | --- | ---: | ---: |
| Daily | Daily Check-In | Explicit authenticated check-in, 1 per UTC day | 10 | 10 |
| Daily | One More Spin | Successful persisted wheel spin, 1 | 10 | 15 |
| Daily | Take Your Shot | Official submission creation, 1 | 20 | 25 |
| Daily | Puzzle Explorer | Official personal-best improvement, 1 | 15 | 15 |
| Weekly | Weekly Puzzle Quest | Official submission approvals, 3 | 60 | 75 |
| Weekly | Spin Streak | Successful spins on 3 distinct UTC dates | 40 | 50 |
| Weekly | Puzzle Challenger | Official submission creations, 3 | 60 | 80 |
| Weekly | Circle Explorer | 4 of 5 distinct Daily definitions: the four new Dailies plus existing Start Your Circle | 75 | 100 |
| Weekly | Weekly Comeback | Explicit check-ins on 4 distinct UTC dates | 50 | 70 |
| Weekly | Puzzle Pro | Official personal-best improvements, 3 | 80 | 100 |
| Lifetime | First Puzzle Registered | First-ever eligible ownership | Unset | Unset |
| Lifetime | First Submission | First-ever official submission | Unset | Unset |
| Lifetime | First Approved Solve | First-ever official approval | Unset | Unset |
| Lifetime | Puzzle Milestone | 10 official approvals after activation | Unset | Unset |

Existing Start Your Circle is NOT in the batch and is never recreated or edited. Its existing 50 XP / 100 SP configuration, approvals, progress and claim history remain untouched. Circle Collector has been removed entirely from the authoritative batch. The logical Daily lineup is the four new Dailies plus that existing mission.

Daily/Weekly chest product contracts remain 3 of 5 (50 XP / 100 SP) and 4 of 6 (200 XP / 250 SP), manual claims and 24-hour grace with unchanged UTC boundaries. No chest definition, membership, reward, approval or activation is changed by this batch; the logical lineup does not automatically relink a chest.

All numbers for NEW individual missions above are unapproved reward proposals. The selected activity for Weekly Puzzle Quest, the Puzzle Pro threshold, the milestone threshold, achievement reward amounts, and collectible associations require exact product/budget review. The existing engine requires at least one positive XP/SP currency to freeze a payable reward; achievements deliberately remain incomplete until amounts are explicitly configured. Collectible-only claims are not introduced.

## Tracking and authentic producers

- Existing `puzzle.added`, `submission.created`, `submission.approved` and `personal_best.improved` producers retain their authenticated ownership/review checks and idempotency. Submitting and approval remain different actions.
- Existing `reward_wheel.spun` is emitted transactionally only for successful spins. Viewing the wheel, unavailable spins and failed transactions do not count. Actual live wheel availability was not queried; the existing wheel status API governs availability. No spin is simulated or granted by the batch.
- `POST /api/missions/check-in` derives the player from the session, accepts no client fields, checks request origin, and records a server-dated event once per player/UTC date. An explicit Missions button invokes it; page loads, refreshes and token refreshes do not. This does not claim to detect a fresh login.
- `mission_tracking_configs` holds explicit counting semantics. Legacy definitions without a tracking row keep event-count behavior. `mission_event_contributions` durably deduplicates event IDs, UTC dates or eligible mission definition IDs per player and period.
- UTC daily midnight and ISO Monday boundaries remain unchanged. Mission completion events retain the triggering event's timestamp so delayed processing cannot move completion into a later week.
- Aggregation requires a nonrecursive eligible list, enough distinct definitions, and a matching earned player entitlement behind the completion event. Rewards, claims, inventory delivery and aggregate completions cannot recursively produce aggregate progress.
- First-ever achievements inspect retained ownership, submissions, official review history, legacy approved submissions and earlier recorded events. Earlier activity excludes eligibility, including soft-deleted retained ownership. No historical completion is backfilled. Physically deleted historical evidence cannot be reconstructed; review historical data completeness before approving these definitions.

## Collectible fulfillment

Repo-native SVG designs: First Steps badge, Puzzle Solver badge, and transparent Puzzle Milestone frame (`public/rewards/missions/`). The inactive batch registers real reward catalog definitions and links their IDs to lifetime drafts; it creates no store listing or player inventory.

The collectible ID/type is frozen separately when the mission is earned, preserving the existing immutable version-1 XP/SP snapshot contract. A database trigger prevents replacement/deletion of the earned collectible and reversal of final delivery status. The normal mission payout savepoint delivers the original collectible through existing Inventory grants and player ownership locks. XP/SP, Inventory delivery, claim and completion writes commit together; failure rolls all of them back. Capacity exceptions retain the original entitlement and use the same payout path on authorized recovery. Already-owned unique items are recorded as `ALREADY_OWNED`; they are not duplicated or converted to currency. Existing equip slots and profile/Inventory images display the persisted badge/frame.

## Administration and batch execution

All endpoints reuse `MISSIONS_MANAGE` (SUPER_ADMIN only), the first-party production proxy guard, mutation-origin protection and server-derived administrator identity:

- `GET /api/admin/missions/starter-manifest`: exact reviewed proposal and digest.
- `POST /api/admin/missions/starter-batch`: strict `{batchKey, manifestDigest}`; one all-or-nothing transaction calls existing draft/rule/reward services, adds audited tracking, and saves stable correlations. A batch advisory lock and database keys prevent duplicates. Existing correlated definitions are skipped, never reset by name or overwritten. Changed digest/catalog collisions fail closed.
- `GET/PATCH /api/admin/missions/:missionId/tracking`: inspect/edit counting, first-ever semantics, explicit eligible UUIDs and optional collectible UUID. Edits require inactive state and the exact loaded revision. Mutation and append-only before/after audit share a transaction. Each relevant edit invalidates approvals through revision and digest changes.

The Admin Missions detail screen has an on-demand Tracking and collectible editor. Readiness validates persisted tracking and collectible catalog state; activation still requires both exact current approvals and all existing readiness checks. No batch route grants approvals, activates missions, creates chests, changes flags or touches the live mission.

Dry run (no network):

```powershell
python scripts/create-starter-missions.py
```

**For a separately authorized operator after reviewed code/migration/assets are deployed:**

```powershell
python scripts/create-starter-missions.py --origin https://circzles-player-hub.vercel.app --apply-inactive-drafts
```

The operator must confirm the displayed origin and enter a legitimate authenticated SUPER_ADMIN `cz_session` value at a hidden interactive prompt. Never pass credentials as command arguments, environment variables, files or chat messages. HTTPS verification is mandatory outside loopback; redirects are rejected to prevent forwarding the session elsewhere. Server and local manifests must match exactly before the sole mutation request. Errors show only safe categories/status codes, never response bodies or headers. Do not blindly retry a timeout; inspect the batch/history first. Repeating the same valid request preserves IDs and does not duplicate audit or payouts.

No authenticated production admin access was supplied, so **zero production draft IDs exist from this task**. Batch requests are tested only against disposable in-memory synthetic databases. No existing database or migration was changed. Migration 0036 appends four tables and immutable-entitlement/contribution/correlation protections; migrations 0000–0035 are preserved.

## Release decisions and remaining verification

Before activation: review new code/migration, decide exact achievement XP/SP amounts and proposed activity thresholds, approve each exact product and reward budget revision, verify live wheel availability, review first-ever historical evidence completeness, and select/review any chest eligibility changes separately. Existing chest budgets and eligibility are not modified by this batch. The real-PostgreSQL concurrency rehearsal is now complete: **16 PostgreSQL tests and 17 guard tests passed** on 2026-11-03. See [final verification](VERIFICATION.md) for the exact collection, retained database identity, race evidence and remaining product decisions. The duplicate Circle Collector proposal has since been removed. Prior evidence is retained unchanged; it describes the earlier 15-draft proposal and is not claimed as a fresh execution of this finalized 14-draft manifest.

## Prior validation evidence (before manifest finalization)

- **466 distinct focused backend cases passed** across the selected event, HTTP, mission lifecycle, rule, readiness, approval, capacity, submission/review and wheel tests. The final changed-file rerun passed **173/173** (`missionStarter.test.ts`: 25; `http.test.ts`: 148); the other **293** cases passed in the earlier targeted 14-file run. No failing case remains in this scope.
- **99/99 frontend cases passed** across mission administration, active missions, history, chests and the four new starter component tests. New tests are included in the normal root `npm test` script.
- Backend `npm run typecheck`, `npm run lint` and `npm run build`: passed. Frontend `npx tsc --noEmit`, `npm run lint` and `npm run build`: passed. The first sandboxed frontend build could not fetch its existing Google Fonts; the network-enabled retry passed without changing font/source configuration.
- `git diff --check`: passed. Existing SQL migrations/snapshots 0000–0035, backend lockfile, protected `next-env.d.ts`, six catalog audits and pending rollout documentation remain unchanged by this task.
- The prior manifest created 15 inactive drafts and three catalog assets only inside disposable PGlite test databases. Repetition returns stable IDs without extra definitions, assets or audit records; audit failure rolls back the entire batch. Existing catalog conflicts and changed manifest digests reject the request.
- Genuine synthetic repository journeys exercise puzzle claiming, submitted-versus-approved events, personal-best events and successful/failed/retried wheel spins. Explicit check-in has authenticated ownership, empty-input/origin checks, server UTC dates and same-day replay coverage.
- Tests cover distinct days/weeks, delayed completion event attribution, unique eligible mission definitions, recursive/forged completion rejection, pre-cutoff exclusion, retained/legacy first-ever history, revision/digest changes, immutable collectible snapshots, XP/SP plus collectible delivery, duplicate ownership and capacity rollback.
- The dry-run Python command completed with **no network requests**. No production admin session was supplied or used. No production drafts, grants, approvals, migrations, flag changes or deployments occurred.

Those original implementation checks preceded the separately recorded real PostgreSQL verification. They are preserved as historical evidence; neither the 466/99 suites nor the retained PostgreSQL databases are rerun/reset for this manifest-only scope and narrow incomplete-binding batch correction.

## Final verification

[VERIFICATION.md](VERIFICATION.md) supersedes the earlier real-PostgreSQL verification gap. No runtime or frontend defect was found, so the 466/99 suites and production builds were not repeated. That verification added the opt-in PostgreSQL test and evidence documentation. The subsequent finalization below removes the duplicate definition and defers one unresolved external ID, without changing event matching, migrations, reward arithmetic, claims or Inventory logic. All product and exact budget approvals remain separate prerequisites.

## Finalized batch identifiers and readiness

Batch key: `circzles-starter-v1`. Current digest: `9010db980995ecd9da0047d7f1a99c26283acc7a9814d60ca4bc8816b96f5300`.

| Exact definition key | Title | Readiness before live approvals |
| --- | --- | --- |
| `daily-check-in` | Daily Check-In | Inactive; explicit authenticated check-in, not automatic login |
| `one-more-spin` | One More Spin | Inactive; live wheel availability confirmation required |
| `take-your-shot` | Take Your Shot | Inactive; genuine submitted attempt required |
| `puzzle-explorer` | Puzzle Explorer | Inactive; official review must record a personal-best improvement during the UTC day |
| `weekly-puzzle-quest` | Weekly Puzzle Quest | Inactive; three official approvals recorded during the ISO UTC week |
| `spin-streak` | Spin Streak | Inactive; live wheel availability confirmation required; three distinct UTC dates |
| `puzzle-challenger` | Puzzle Challenger | Inactive; three genuine submissions within the ISO UTC week |
| `circle-explorer` | Circle Explorer | BLOCKED: existing Start Your Circle ID must be explicitly bound |
| `weekly-comeback` | Weekly Comeback | Inactive; explicit check-ins on four distinct UTC dates |
| `puzzle-pro` | Puzzle Pro | Inactive; three official personal-best improvements; review timing controls progress |
| `first-puzzle` | First Puzzle Registered | BLOCKED: XP/SP amounts unset; First Steps badge association retained |
| `first-submission` | First Submission | BLOCKED: XP/SP amounts unset; no collectible association |
| `first-approved-solve` | First Approved Solve | BLOCKED: XP/SP amounts unset; Puzzle Solver badge association retained |
| `puzzle-milestone` | Puzzle Milestone | BLOCKED: XP/SP amounts unset; Puzzle Milestone frame association retained |

All 14 require exact product and reward-budget approvals before activation. Creation produces persistent UUIDs only when an authorized batch is actually applied; no production UUIDs have been generated here. Stable definition keys are correlations, not invented live database IDs. Achievement first-ever rules and all collectible associations remain unchanged.

### Circle Explorer: preserve 4-of-5, never substitute 4-of-4

Its rule stays `mission.completed`, target **4**, mode **DISTINCT_MISSIONS**. The five logical eligible keys are exactly:

1. `daily-check-in`
2. `one-more-spin`
3. `take-your-shot`
4. `puzzle-explorer`
5. `existing-start-your-circle` ? external reference only, `missionId: null`

The manifest explicitly describes the existing reference as DAILY, `puzzle.added`, target 1, existing 50 XP / 100 SP, `REFERENCE_ONLY_NEVER_MUTATE`. Its production UUID was not provided and no production lookup is authorized. Do not resolve by title, invent a UUID, replace it with a new puzzle-add definition or silently reduce eligibility to four definitions.

The narrow batch correction creates Circle Explorer's inactive draft and proposed XP/SP configuration, but leaves its tracking UNCONFIGURED while this external ID is unresolved. Existing readiness then blocks activation (`RULE_M1_VALID`, `RULE_EVENT_SUPPORTED`, `TRACKING_VALID`). The other 13 tracking configurations are saved normally. No rule-engine change or migration is needed.

After a separately authorized release/batch, use the existing read-only administrator listing to positively verify the original Start Your Circle ID and contract. Configure Circle Explorer through the existing audited tracking editor/PATCH with those **five exact UUIDs**, mode DISTINCT_MISSIONS, and its current revision. This changes only Circle Explorer; never PATCH, approve, deactivate, recreate or otherwise mutate the existing Start Your Circle record. Recheck readiness and obtain Circle Explorer's exact new-revision approvals afterward.

`externalMissionReferences`, `releaseBlockers` and `requiresLiveWheelAvailabilityConfirmation` make these prerequisites visible in the offline JSON. Batch apply still accepts only its strict key/digest contract, never arbitrary client-side approval assertions or actor fields. Older correlated drafts with another digest fail closed rather than being overwritten or reset.

### Collectible-only constraint

`freezeRewards` in `backend/src/domain/missionLifecycle.ts` accepts positive integer XP/SYNAPSE_POINTS rows and requires a nonzero aggregate in at least one currency. A missing/all-zero reward array cannot produce the mandatory immutable version-1 earned snapshot. Separate collectible entitlements supplement that snapshot; they do not replace it. Therefore all four achievements remain incomplete and inactive with currency amounts UNSET. No values, budgets or alternate reward semantics are invented.

### Finalization validation and shortest release route

- **26 directly affected synthetic backend tests passed**, including 14 exact identifiers, 4/6/4 categories, unchanged collectible associations, absent duplicate/live mission creation, incomplete external binding, exact five-ID completion through the existing editor, unchanged Start Your Circle configuration, batch replay and audit rollback.
- Backend test typecheck and targeted lint passed. Offline dry run passed with network functions blocked; it created no data or approvals. `git diff --check` passed. No frontend changes or broad suite/build repetition was required.
- Prior 16 PostgreSQL + 17 guard results and both retained verification databases remain untouched. Migration 0036, event matching, UTC logic, ledger/claim arithmetic and Inventory fulfillment are unchanged. The opt-in PostgreSQL test's future manifest expectations now use 14 drafts and explicitly expect the unresolved external-binding blocker; that suite was not rerun.

Shortest correct route: review the focused local diff and authorize local release commits excluding protected/unrelated files; separately authorize publication/code review and deployment of the reviewed code plus migration 0036; apply the guarded inactive batch with authenticated SUPER_ADMIN access; bind Circle Explorer's verified existing mission ID; obtain explicit achievement amounts and exact product/budget approvals; confirm live wheel availability; then separately authorize activation. Structural manifest approval alone authorizes none of those production/Git actions. Chest definitions and existing records remain untouched throughout this task.
