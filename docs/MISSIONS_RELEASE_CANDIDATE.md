# Missions release candidate: local verification, 2026-10-24

This is a non-executing release review. Production was not contacted. Its schema-through-0025 status is supplied context, not a new live observation. Nothing in this document authorizes publication, a backup, migration, deployment, configuration change or real mission/chest activation.

## Approved initial-release chest policy

| Configuration | Daily | Weekly |
|---|---|---|
| Selectable missions / required unique completions | 5 / 3 | 6 / 4 |
| Exact reward | **50 XP / 100 SP** | **200 XP / 250 SP** |
| Period boundary | 00:00 UTC | Monday 00:00 UTC, ISO week |
| Claim | Manual, at most one player/type/period | Manual, at most one player/type/period |
| Earned claim deadline | Period end + 24 hours, exclusive | Period end + 24 hours, exclusive |

The user approved this product schedule on 2026-10-24. `backend/src/config/missionChestProduct.ts` is the source of truth, version `initial-release-2026-10-24`. SUPER_ADMIN-only `GET /api/admin/mission-chests/product-policy` exposes a frontend-safe contract. `/admin/missions` offers **Use approved initial-release reward template** inside inactive chest configuration. Clicking fills fields only; saving, each recorded approval and activation remain separate actions. New drafts still have blank rewards and remain inactive. Loading the template never inserts approvals or grants rewards.

Product-level approval is not a recorded configuration approval. Each chest needs independently recorded SUPER_ADMIN PRODUCT and REWARD_BUDGET approval for its exact revision/digest, including eligible mission revisions. Editing invalidates freshness; reverting values cannot revive historical approval. The template is not a global reward cap or an automatic constraint on every historical/configurable chest. Operators must select these exact initial-release amounts and review both approvals. Individual mission budgets are unchanged.

Earlier Daily 20 XP / 25 SP and Weekly 75 XP / 100 SP figures remain explicitly historical/provisional in the older M1/M2 narrative. They are superseded for new initial-release configuration. No runtime provisional reward default was found. Synthetic tests with other explicitly chosen amounts and immutable earned snapshots were deliberately not rewritten.

## Implemented feature inventory

| Area | Verified scope | Limits / release conditions |
|---|---|---|
| M1 processing | Existing six event contracts, UTC period attribution, unique completion provenance, bounded worker batches, locking and frozen entitlements | No invented event types, historical replay or progress fabrication |
| Mission administration | SUPER_ADMIN listing/search/pagination/detail; inactive drafts, metadata, rules, schedule and explicit XP/SP editors | Unsupported advanced conditions remain read-only/blocked |
| Approval/readiness | Separate product/budget records, revocation, revision/digest binding, current persisted readiness | Technical storage limits are not product budget approval |
| Mission lifecycle | Audited, transactional activation/deactivation, stale/race protection, idempotent lifecycle receipts | Active chest dependencies must be deactivated/reviewed first; enabled chest links retain lifecycle-alignment guard |
| Reward arithmetic | Exact SP int32 capacity and XP safe-integer arithmetic at authoritative grant boundaries | Unsafe/corrupt values fail closed; no clamping or wallet manipulation |
| Capacity recovery | Individual and chest on-time exceptions, savepoint rollback, immutable original amounts/deadlines, explicit SUPER_ADMIN recovery | No automatic compensation, deadline extension or recovery of an ordinary expired claim |
| Player missions | Earned periods, explicit-period manual claims, refresh, UTC deadlines and capacity messaging | Historical titles are current labels where no persisted title snapshot exists |
| Player history | Session-owned paginated mission/chest history for inactive, expired, paid, pending/blocked and recovered entitlements | Missing legacy reward evidence is reported, not manufactured |
| Chest administration | Daily/Weekly drafts, exact mission pools, explicit rewards/windows, independent approvals, activation/deactivation, audit and recovery UI | Unfinished current-period progress prevents mixing eligibility/reward configurations; title-only edits remain possible |
| Chest eligibility/claims | Unique mission completions rather than reward-claim count; 3-of-5 / 4-of-6; one type/period payout; manual claim; 24-hour grace | No automatic activation, payout or cross-definition duplicate claim |
| Release controls | Schema-0025-compatible controls-only artifact; processor/claim maintenance flags; worker drain and bounded shutdown; health state | Both flags default true; every running instance must explicitly adopt false before migration |

No runtime reward or lifecycle defect was discovered in this review. Corrected verification defects were stale final migration counts (34 instead of 36), a lifecycle lock assertion that omitted the legitimate shared administrative advisory lock, and a test assuming the resolved capacity policy still blocked every activation. The latter now uses a disabled rule as an actual blocker. Production authorization, audit protections and readiness checks were not weakened.

## Local verification evidence

| Check | Final result |
|---|---|
| Consolidated focused backend, 24 files | **587 passed, 0 failed, 0 skipped** |
| Consolidated frontend, 5 files | **97 passed, 0 failed, 0 skipped** |
| Real PostgreSQL 18.6: mission / approval / lifecycle / capacity / HTTP end-to-end / chest | **18 + 20 + 21 + 22 + 4 + 19 = 104 passed, 0 failed, 0 skipped** in final per-suite runs |
| Browser workflow assertions | **28 passed** using real local frontend/auth/API/PostgreSQL |
| Backend lint, test typecheck, production build | Passed |
| Frontend lint, typecheck, Next production build | Passed; 45 routes generated |
| Migration journal / snapshots / Drizzle schema generation | 36 ordered entries, continuous snapshot chain; no schema changes generated in isolated copy |
| Git whitespace and preservation checks | Passed; protected files, migration SQL/snapshots and release refs unchanged |

The first consolidated PostgreSQL execution passed 103/104. Its single obsolete lifecycle expectation was corrected; a fresh database rerun passed all 21 lifecycle tests. A preparation retry also exposed that the test must grant approvals before introducing the deliberately invalid rule; that fixture ordering was corrected. The failed disposable databases were retained. Counts above do not add failed attempts or duplicate reruns to the final passing totals. Unrelated complete repository suites were not repeated.

Real server guards verified literal `127.0.0.1:5432`, PostgreSQL `180006`, session/current role `circzles_test`, exact unique database name and initially empty public/drizzle schemas before migration writes. Separate backend connections showed real transaction/tuple/advisory lock contention. No PGlite substitution was used for those concurrency checks. The existing `circzles_m1_test` and previous retained verification databases were not opened for these tests or reset.

Final retained databases:

- Mission: `circzles_m1_verify_20261024_76c83ac322f5`.
- Approval: `circzles_m1_verify_20261024_aea4199385f2`.
- Lifecycle final: `circzles_m1_verify_20261024_801d6fba8290`.
- Capacity: `circzles_m1_verify_20261024_97d2b2c31900`.
- Individual HTTP end-to-end: `circzles_m1_verify_20261024_1483a6b96c61`.
- Chest and baseline upgrade: `circzles_m1_verify_20261024_55fdb83bc335`.
- Browser: `circzles_m1_verify_20261024_613965884950`.

Initial failed lifecycle databases `circzles_m1_verify_20261024_78c4f3961589` and `circzles_m1_verify_20261024_794625e0536a` were also retained. No cleanup/drop was performed. Private manifests/results are under `/home/techadmin/.local/share/circzles-postgres-tests/`; credentials remain in its restricted pgpass, not in these reports.

### Upgrade preservation rehearsal

`tests/helpers/missionsReleaseUpgrade.ts`, invoked only after the chest PostgreSQL safety guards, migrates a fresh database through 0025 and inserts synthetic pre-upgrade ownership, approved submission/review/grant, leaderboard, XP/SP ledger/wallet/progression and inactive legacy mission records. A synthetic Lion benchmark is **195000 ms**. This is not a copy or inspection of Hazel's data.

A fault appended only to a private copy of 0035 proves the entire pending 0026-0035 transaction rolls back: journal stays at 26 entries and new foundation tables are absent. Retrying the original migration files reaches 36 entries. Complete JSON comparisons of 16 protected synthetic tables remain identical. Every journal hash/timestamp matches the migration files. The inactive legacy mission remains inactive, and its missing historical snapshot stays NULL rather than being invented.

### Browser rehearsal

The local browser used an isolated frontend copy, a fresh guarded PostgreSQL database, synthetic `@test.invalid` accounts and a dedicated test-only app entry point. Only loopback browser requests were allowed. Mail, media uploads and unsupported external services throw; no production `server.ts`, automatic processor or external integration was started. Explicit bounded processing handled synthetic ownership events.

Both chests started blank/inactive, accepted the explicit approved template, required two separate approvals and confirmed activation. Daily/Weekly unique completion thresholds were reached without claiming individual mission rewards. Two manual claims paid **250 XP / 350 SP total**, with exactly two XP and two credit ledger rows; duplicate claims failed. Unsafe Daily payout left **zero XP/credit ledgers**, preserved its 50 XP / 100 SP exception, and a still-unsafe recovery stayed pending. After a synthetic ledger-backed 100 SP spend, explicit recovery paid exactly once to balance 2147483647 and XP 50. Another account saw none of that history and received 403 from the admin policy endpoint. Deactivation retained paid history. The UI was visually inspected.

## Migration and dependency integrity

Migrations 0026-0035 and their existing snapshots were preserved byte-for-byte against this task's starting baseline. Tracked 0026 remains unchanged from HEAD. Migrations 0027-0035 are still uncommitted, so this establishes preservation during this task, not independently signed historical provenance.

| Migration | Purpose |
|---|---|
| 0026 | M1 lifecycle/snapshots, seven foundation tables and provenance/immutability constraints |
| 0027 | Append-only mission administrator history |
| 0028-0030 | Extend audit actions for rules, schedules and rewards |
| 0031 | Immutable approval/revocation records |
| 0032 | Lifecycle operation receipts and audit actions |
| 0033 | Mission capacity exception/request/event records |
| 0034 | Chest administration, inactive draft configuration and global type/period claim uniqueness |
| 0035 | Chest capacity exception/request/event records |

The complete schema has 69 declared tables. Journal entries 0000-0035 are ordered and the snapshots form a continuous ID chain. Drizzle generation in an isolated copy produced no new migration. File hashes and exact pending release-file groups are recorded in `MISSIONS_RELEASE_INVENTORY.json`.

All 27 committed migration files match HEAD after line-ending normalization; 0026 matches byte-for-byte. Existing Windows working copies of 0001-0025 use CRLF where committed blobs use LF. They were not modified. Because Drizzle hashes raw SQL text, local working-file journal hashes are not automatically the hashes of a future Linux Git checkout. Pin and verify the actual LF release artifact, compare production history to the previously deployed artifact, and stop on unexplained differences; never rewrite journal hashes to conceal drift. Pending 0026-0035 files already use LF.

`backend/package-lock.json` and both release refs are unchanged. No dependencies were changed. Backend build is TypeScript compilation; frontend build is Next build. No repository build/start hook runs migrations. `db:migrate` is explicit, and `drizzle.config.ts` includes all three schema modules. Actual Render build/start/pre-deploy commands remain unverified and must be inspected manually. Do not infer hosting settings from the absence of a repository Render manifest.

The installed `drizzle-kit migrate` PostgreSQL adapter delegates to `drizzle-orm/node-postgres/migrator`. The inspected ORM puts all pending SQL and journal inserts in one transaction; creation of journal schema/table occurs before that transaction. The CLI reports failures with exit 1. Neither the runner nor the CLI supplies a deployment-wide single-runner advisory lock, and the runner does not validate every existing journal hash. Require one authorized operator/runner and explicit pre/post journal/hash verification. Do not run `db:push`, seeds or application startup as a migration substitute.

## Release inventory and proposed commit boundaries

Current branch remains `feature/missions-lifecycle-chests`, HEAD `ed217f60253614b99eb32545d3b3c922609e3698`. Controls-only remains `7bad7c8faa2265844a0f1d2af42d93d554c14aeb`. No index staging or Git write occurred. Existing Slice 1-10/chest work remains uncommitted. `next-env.d.ts` and `docs/circzles-catalog/audits/**` are excluded from the proposed release commits and preserved.

Use the exact path groups in `MISSIONS_RELEASE_INVENTORY.json` for review; do not use `git add .`:

1. **Backend, migrations, tests and frontend-safe API contracts**: all pending Missions backend files plus `src/types/adminMissions.ts`, `missionChests.ts`, `missionHistory.ts`. Backend compile-time contract tests consume these frontend-safe files, so include them with the backend artifact.
2. **Frontend integration and UI/tests**: remaining pending Missions frontend files and root `package.json`. Depends on commit 1. No backend implementation may enter the frontend TypeScript graph.
3. **Documentation and evidence inventory**: Missions documents and inventory. No credentials, raw player data or private local account fixtures.

These are proposed boundaries, not created commits. Before publication, review staged paths/diff, verify the preserved files/index, run checks against the actual resulting artifact, and record immutable commit SHAs plus lockfile, policy and migration hashes. Keep the independently validated controls-only history separate; do not merge the entire M1/M2 branch into it. Its schema-0025 purpose differs from the complete Missions artifact.

Exact files changed during this final preparation, relative to the preserved starting working tree (earlier uncommitted work is listed separately in the JSON inventory):

- `backend/src/config/missionChestProduct.ts` (new).
- `backend/src/domain/adminMissionChests.ts`.
- `backend/src/domain/missionActivationPolicy.ts` (explanatory text only).
- `backend/src/http/adminMissionRoutes.ts`.
- `backend/tests/helpers/chestCases.ts`.
- `backend/tests/helpers/missionBrowserServer.ts`.
- `backend/tests/helpers/missionsReleaseUpgrade.ts` (new).
- `backend/tests/missionApprovalsPostgres.test.ts`.
- `backend/tests/missionCapacityPostgres.test.ts`.
- `backend/tests/missionChestProduct.test.ts` (new).
- `backend/tests/missionChestsPostgres.test.ts`.
- `backend/tests/missionE2ePostgres.test.ts`.
- `backend/tests/missionLifecyclePostgres.test.ts`.
- `src/components/admin/ChestAdmin.tsx`.
- `src/components/missions/missionChests.test.mjs`.
- `src/types/missionChests.ts`.
- `docs/MISSIONS_M1.md`.
- `docs/MISSIONS_M2.md`.
- `docs/MISSIONS_DEPLOYMENT_CONTROLS.md`.
- `docs/MISSIONS_POSTGRES_VERIFICATION.md`.
- `docs/MISSIONS_BROWSER_REHEARSAL.md`.
- `docs/MISSIONS_RELEASE_CANDIDATE.md` (new).
- `docs/MISSIONS_RELEASE_INVENTORY.json` (new).

Local test servers were stopped, ports 3107/4107 verified closed, and the temporary Windows synthetic account fixture removed. The restricted Linux synthetic evidence/databases were retained. Browser development fonts fell back after sandbox-blocked Google Fonts downloads; the separately executed production build fetched its build assets successfully. The browser used the existing Playwright harness because native/connected browser controls were unavailable. The frontend test-only backend omits the production event stream, so its client polling fallback was used; fleet/event-stream behavior still requires authorized deployment smoke checks.

## Ranked gates before production

1. **Recoverable encrypted backup and explicit recovery-risk decision.** No production backup or restore rehearsal has been done here. Cover both live branch databases (`neondb`, `postgres`), complete application schemas/data and Drizzle journal. Previously reported Neon history retention is six hours; manually reconfirm actual plan/retention and restore permissions before scheduling. Stream PostgreSQL-18 custom-format dumps directly to authenticated age encryption; never write plaintext archives to C: or the unencrypted WSL filesystem. Keep passphrases with the human operator, outside chat/history/Git/logs; keep an independently controlled off-machine encrypted copy and recovery-key custody. `chmod` does not encrypt WSL swap, Windows pagefile, crash dumps or restored database storage. Choose a trusted encrypted recovery host/volume for rehearsal, or explicitly resolve those exposures before handling real plaintext. No USB/SSD preparation is required by this local task. Global roles/grants/configuration and Cloudinary media need separately scoped recovery coverage; a database dump does not contain media binaries.
2. **Render fleet and migration quiescence.** Manually inspect linked branch/deployed SHA, auto-deploy, instance/scaling count, build/start/pre-deploy commands, health path, shutdown delay, worker/cron/preview services and every other process sharing the database. Both mission flags default true. Health describes one responding instance, not the whole fleet. A saved flag value or one health response cannot prove old workers exited.
3. **Code review and reproducible artifact publication.** All new work is still local/uncommitted; the local checks are not production authorization. Review the complete pending changes, migration hashes and exact commit groups, then separately authorize commits/publication and pin actual artifacts.
4. **Legacy earned-state reconciliation.** Missing legacy frozen reward evidence intentionally fails closed. Review affected production records under separate read-only authorization and decide treatment before enabling affected claims; do not synthesize snapshots or modify Hazel's rewards. New 0034 uniqueness intentionally rejects historical duplicate type/period payments instead of deleting/merging them.
5. **Reviewed live definitions and operational monitoring.** Choose actual supported mission rules/windows and individual budgets; prepare five Daily/six Weekly compatible active missions. Each mission/chest needs current recorded product/budget approval. Product template approval does not seed records, approve configurations or activate anything.

## Ordered operator checklist: not executed

1. Review this report and the exact release inventory. Authorize local release commits separately; inspect each staged path and resulting artifact. Separately authorize publication of controls-only and full Missions artifacts; pause/verify any auto-deploy behavior before publication can trigger a deployment.
2. Inspect the precise Render console fields above. Establish an operator maintenance window, all-writer inventory, single migration runner, backup/restore decision and stop authority. Record protected production baselines under separately authorized read-only inspection: Player IDs, canonical/claim identities, submissions/reviews/grants, Hazel's Lion **03:15.000 = 195000 ms**, leaderboard identity/time, wallet/progression and XP/SP transaction counts/sums/keys. Account for legitimate concurrent activity rather than comparing uncoordinated counts blindly.
3. Under separate authorization, create encrypted backups of **both** live databases using the verified direct endpoint with TLS certificate/hostname verification. Verify encrypted-file checksums, age decryption integrity and complete PostgreSQL-18 restoration on isolated encrypted recovery infrastructure. Prevent outbound integrations/workers by running database-only recovery, not application startup. Confirm required objects, constraints/triggers/journal and protected records after restore. Securely retain recovery evidence and off-machine ciphertext/key recovery. Do not migrate without a usable recovery path.
4. Deploy the exact controls-only artifact on schema 0025 with `MISSION_PROCESSOR_ENABLED=false` and `MISSION_CLAIMS_ENABLED=false`, by separately authorized Render change/deployment. These are static startup settings: finish deployment on **every** instance. Stop/drain all separate workers/old services. Confirm platform instance IDs/termination logs and worker stopped/no-in-flight logs for every old instance, no old poller/cron remains, and new fleet health reports processor disabled/no scheduled/in-flight batch and claims disabled. Authenticated claim probes should return maintenance 503 without making a payout. Read-only player access should remain healthy. Do not proceed on an unknown instance.
5. Run one explicitly authorized migration job from the pinned complete artifact, using a direct/unpooled TLS-verified connection and secure credentials, after confirming production journal 0000-0025 hashes. Apply **0026 through 0035 once in order**, not just 0026. Do not run migrations in build/start/pre-deploy until a separately reviewed strategy exists. Do not run the backend to migrate it. On failure, stop, inspect rolled-back journal/schema state and the exact error; do not blindly retry or reset.
6. Verify journal **36 exact entries/hashes/timestamps**, new tables/indexes/FKs/constraints/append-only triggers, snapshot/provenance guards and unchanged protected baseline records. Confirm no approval/activation/reward seeds. Reconcile any unexpected protected-row change before continuing. This verification must be separately authorized; local synthetic preservation is evidence of compatibility, not proof about live data.
7. Deploy pinned complete Missions backend and frontend while **both flags remain false**. Verify all old instances are gone, schema compatibility, authentication/permissions, existing collection/submission/leaderboard behavior and read-only Missions/history/admin views. Align platform shutdown delay above the bounded application drain timeout (default 25000 ms) and allow for in-flight transactions. Do not claim a single responding health check proves fleet convergence.
8. With separate authorization, enable the processor first while claims stay false; complete the required deployment across the fleet. Observe queue age/batch failures/quarantine, event attribution and absence of recursive/unexpected grants. Existing queued eligible events and active legacy definitions need reviewed treatment. Then separately enable claims, complete fleet convergence and inspect error/idempotency/ledger consistency. Do not use real payout attempts merely as a smoke test. Maintenance does not pause or extend earned claim deadlines.
9. Through the actual admin workflow, configure inactive definitions, verify rules/windows/budgets/readiness and record separate current approvals. Separately authorize real definition activation: individual missions first, then correctly aligned Daily/Weekly chests at the approved amounts. Activation is explicit, never a deployment side effect. Monitor unique completions, frozen rewards, single claims, capacity exceptions/recovery audit and player isolation. Recovery remains an explicit SUPER_ADMIN action for original frozen amounts.
10. Stop on backup/restore uncertainty, endpoint/TLS mismatch, journal drift, an unknown old worker, DDL failure, protected-record change, broken auth/claim maintenance, duplicate ledger grants or unexpected activation/payout. Disable processor/claims through a completed authorized deployment and drain the fleet. Prefer a reviewed compatible application rollback/forward fix while preserving additive schema and earned state; no destructive down migration. A full database/PITR rollback can overwrite all legitimate post-backup ownership, submissions, leaderboard updates and XP/SP transactions. Restore to an isolated branch first and explicitly approve reconciliation/cutover before replacing a live database. Never silently overwrite player activity.

Separate authorization is required for: Git commits/publication; production read-only preflight; encrypted production backups and recovery rehearsal with real data; Render/auto-deploy/flag/scaling changes; production migration; backend/frontend deployment; processor/claim enabling; actual mission/chest activation; production recovery/cutover. None occurred here.

**Single next action:** review the exact pending release-file inventory and approve the proposed local commit boundaries. That makes the tested candidate reproducible before any production operation is considered.
