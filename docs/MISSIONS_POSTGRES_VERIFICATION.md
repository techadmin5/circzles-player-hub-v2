# Current local PostgreSQL verification contract (M2 Slice 7)

Latest verification (2026-10-24): complete local candidate through migration **0035**. See [the consolidated evidence](MISSIONS_RELEASE_CANDIDATE.md). Final per-suite results: mission 18, approval 20, lifecycle 21, capacity 22, individual HTTP end-to-end 4 and chest 19: **104 passed, 0 failed, 0 skipped**. Earlier slice counts below are historical. The first consolidated run's obsolete lifecycle expectation was corrected and all 21 lifecycle checks were rerun in another fresh database; no retained database was reset.

The chest suite now rehearses **0025 baseline -> failed pending 0026-0035 batch -> unchanged retry -> 0035**, with all 36 journal hashes/timestamps checked and 16 protected synthetic table snapshots preserved, including a 195000 ms Lion benchmark. The deliberately failing SQL exists only in a private temporary migration copy. Source migrations/snapshots remain unchanged. Independent backend connections verify lock contention and exactly-once grants, including approved Daily 50 XP / 100 SP and Weekly 200 XP / 250 SP while historical frozen rewards remain unchanged. Installed Drizzle generation in the private copy returned no schema changes.

All tests require literal loopback, exact fresh unique database name, PostgreSQL 18.6, current/session role `circzles_test`, and empty public/drizzle schemas before migrations. The role's existing credentials were used through restricted pgpass; no role/security configuration changed. The original `circzles_m1_test` and prior retained databases were not modified. Final database identities and local-only evidence locations are listed in the consolidated report.

The existing circzles_m1_test database is protected and must not be reused, reset, truncated or dropped. Historical Docker examples below are retained as prior M1 documentation; their fixed database name and port are no longer accepted by the strengthened test guard. Do not execute those historical setup/cleanup commands for this verification.

## Current target and prerequisites

- Use the existing WSL local PostgreSQL 18.6 server at literal 127.0.0.1:5432.
- A normal local role with existing CREATEDB permission may create a new unique database named circzles_m1_verify_YYYYMMDD_<12 lowercase hexadecimal characters>. Do not grant global privileges, reset passwords or use an administrator without separate authorization.
- The circzles_test role requires CONNECT and CREATE on that new database, and USAGE/CREATE on its public schema. Grants must be made only by its authorized owner. Existing databases and roles must remain unchanged.
- Keep the existing local-only test password outside Git, logs and shell history. Supply it through a restricted local file or interactive operator input to a launcher that builds MISSIONS_TEST_DATABASE_URL in memory. Never read the application .env as a credential fallback.
- Set MISSIONS_TEST_DATABASE_NAME to the exact newly created database name and MISSIONS_POSTGRES_DISPOSABLE to YES_LOCAL_DISPOSABLE. The URL must specify circzles_test, literal 127.0.0.1, explicit port 5432 and that exact database name, with no query parameters or fragments. DATABASE_URL is never a fallback.
- Before migration, both independent pools verify server-reported database name, session/current role, server address, port and version 180006. The harness refuses populated public/drizzle table schemas and verifies distinct server backend PIDs. No existing-database reset is provided.
- Run only tests/missionPostgres.test.ts with --maxWorkers=1 in a Linux temporary copy with the current source/migrations and installed backend dependencies. Do not launch the backend server, workers or outgoing integrations. Supply disabled worker/claim feature flags; tests call repositories directly on synthetic fixtures.
- Retain the new disposable database for review after the run; no automatic DROP is part of this task. Reruns require another newly created database. Never drop or clean an existing database to satisfy the empty-database guard.

## Coverage and preparation checkpoint (superseded by completed run below)

The original nine cases remain: transactional migration failure/retry, competing processors, same/different-key claims, completion/claim race, frozen payouts during definition edits, chest idempotency, poison quarantine and interrupted worker rollback.

Nine additional cases cover exact SP/XP ceilings and replay, concurrent capacity exhaustion for both currencies, duplicate frozen claims at both ceilings, XP rollback of preceding SP writes with retryable claim keys, and three exact unsafe historical bigint totals. Competing boundary claims use a third held wallet-row lock and require two server sessions to be observed waiting on PostgreSQL locks before releasing it. They assert one complete award, no duplicate ledgers and an unchanged retryable losing claim. These are real pg pools and production repository transactions, not PGlite concurrency simulations.

Current preparation verified local psql/PostgreSQL 18.6 and the normal techadmin role's CREATEDB=true, SUPERUSER=false through a local peer metadata connection. circzles_test has CREATEDB=false and SUPERUSER=false. TCP authentication to 127.0.0.1:5432 as circzles_test failed with no password supplied; no local password file was found in the inspected locations. A secure local-only credential-file path is required before database creation/test execution proceeds. No new database, schema, migration or fixture was created. Guard-unit tests passed (17); the 18 real-PostgreSQL cases were skipped without an authorized credential/URL. Their arithmetic/concurrency assertions remain unexecuted and must not be reported as passing.

Changed test files: backend/tests/helpers/localMissionPostgres.ts, backend/tests/localMissionPostgres.test.ts and backend/tests/missionPostgres.test.ts. Existing migrations and application logic are unchanged.

## Completed local PostgreSQL verification ? 2026-10-22

Authorized run completed using the normal WSL techadmin account and its existing CREATEDB permission. Exactly one new database was created: circzles_m1_verify_20261022_34f2570225ca, owned by techadmin. The existing circzles_m1_test database was never connected to, reset, truncated, dropped or modified. Its catalog OID/owner remained 16388/techadmin. No role privileges or authentication configuration were changed during this run; circzles_test received CONNECT/CREATE only on the new database and USAGE/CREATE on its public schema.

The creator's peer connection and the loopback test connection were verified to have the same PostgreSQL postmaster start time. Before migration, both pg pools verified database name, current/session role circzles_test, literal host 127.0.0.1, port 5432 and server version 180006; the new schema was empty and distinct backend PIDs were verified. Corrected the test host query to host(inet_server_addr()): casting inet to text yields 127.0.0.1/32 and would incorrectly fail strict address comparison. No targeting safeguard was relaxed.

The exact new database entry was appended to /home/techadmin/.local/share/circzles-postgres-tests/pgpass without displaying the password. File mode 0600 and directory mode 0700 were preserved. Credentials were constructed in process memory for the test launcher, never printed, copied into the checkout or written into Git files. No application .env file or production credential was used.

A private Linux test copy excluded environment files, node_modules and build outputs. npm ci --no-audit --no-fund succeeded with the validated lockfile unchanged, using existing Node v22.22.1 and npm 9.2.0. Existing esbuild-kit deprecation warnings were informational; no dependency upgrade or lockfile reconciliation was needed.

Results: **18 real PostgreSQL tests passed, 0 failed, 0 skipped**; **17 connection-guard tests passed, 0 failed, 0 skipped**. All original nine M1 tests and all nine added arithmetic/concurrency cases ran. The migration test verified failed 0026 rollback and successful retry; the retained database journal has 31 entries, migrations 0000-0030. No repository migration was altered.

Verified exact SP maximum 2147483647 and cumulative XP maximum 9007199254740991, safe idempotent replays at capacity, rejection of the next unit, competing claims with two sessions observed waiting on real PostgreSQL locks, one complete winning payout and one retryable losing claim, rollback of preceding SP writes on XP failure, no duplicate ledgers/claims, unchanged earned snapshots despite definition reward edits, and exact rejection of unsafe stored bigint XP without rounding. All 17 user rows in this database are synthetic test.invalid fixtures. No runtime arithmetic or claim defect was discovered.

The new database and private evidence are retained. Evidence directory: /home/techadmin/.local/share/circzles-postgres-tests/run_circzles_m1_verify_20261022_34f2570225ca (0700), containing postgres-verification.json, verification-summary.json and the non-secret run manifest. There is no automatic cleanup or database drop. A rerun against this populated database remains prohibited by the harness; do not reset it to bypass that guard.

Backend lint, typecheck and git diff --check passed. Only the host query and verification documentation changed in this execution. Full regression suites were not repeated. Production, existing databases, M1 release commits, protected files, migrations and all unrelated M2 work were preserved. Technical PostgreSQL boundary/concurrency verification for Slice 7 is complete; product/budget authority and approval policy remain required before approval recording or any activation workflow.

## Completed Slice 8 approval integrity verification ? 2026-10-22

Created and retained exactly one new isolated database for this task: circzles_m1_verify_20261022_032eaa0b8b37. Verified server PostgreSQL 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1), version number 180006, literal host 127.0.0.1, port 5432 and current/session role circzles_test. The normal local techadmin account used existing CREATEDB permission after its peer connection was matched to the same postmaster as the TCP connection. New-database CONNECT/CREATE and public-schema USAGE/CREATE grants applied only to this database. Neither circzles_m1_test nor circzles_m1_verify_20261022_34f2570225ca was opened, modified, reset or dropped. No roles/passwords/authentication settings were changed. The exact new database credential entry preserves file 0600 and directory 0700.

### Reusable approval-only harness

backend/tests/missionApprovalsPostgres.test.ts reuses the existing local target guard, pg pool factory and actual Drizzle migrator. It requires its own MISSION_APPROVALS_TEST_DATABASE_URL and MISSION_APPROVALS_TEST_DATABASE_NAME plus MISSIONS_POSTGRES_DISPOSABLE=YES_LOCAL_DISPOSABLE. It never falls back to the M1 URL or DATABASE_URL and loads no application environment files. URL credentials are supplied in process memory from the restricted local password file; do not print URLs or set them in shell history. Leave MISSIONS_TEST_DATABASE_URL unset so the original empty-database M1 suite is not run against this populated approval database. A rerun must use another newly authorized empty database; no reset or automatic deletion is provided.

Before any schema write, both independent pools verify server/database/session identity and distinct backend PIDs, and the suite refuses existing public/drizzle tables. It migrates through 0030, creates an inactive synthetic definition with existing audit history, then injects an intentional failure into a private copy of 0031. PostgreSQL rolls back its DDL, immutable function, history constraint changes and journal append while retaining the earlier definition/audit row. Retrying the unchanged real migration succeeds: 32 journal entries, 0000-0031. No repository migration is rewritten.

### Actual results and race evidence

**20 real PostgreSQL cases passed, 0 failed, 0 skipped.** They cover simultaneous PRODUCT duplicates and REWARD_BUDGET duplicates, independent categories, duplicate revocations, grant-versus-revocation and stale replacement protection, budget approval versus product revocation, all four configuration editors racing approval, stale revision and digest rejection, edit/revert prevention of historical revival, grant/revocation audit failure rollback, uncommitted audit visibility, database uniqueness, immutable records and unsafe incomplete definitions.

The race helper holds a third connection's mission row lock until two distinct backend PIDs are observed in pg_stat_activity waiting on Lock with their actual missions FOR UPDATE queries. Only then is the lock released. Duplicate operations commit one mutation and one corresponding audit; independent categories can both succeed. Configuration edits leave changed/unsafe missions unapproved and not activation-ready. A separate advisory-lock delay in a synthetic audit trigger proves the second category and readiness remain invisible to another connection until the approval+audit transaction commits. These observations are assertions in the retained passing test report, bound to the test source SHA-256 below; console output is not required for their verdicts.

Post-run catalog/data checks confirmed six enabled immutable triggers across approvals, revocations and administrator history; no unaudited grants or revocations; zero active missions; and zero rows in players, wallets, player_progression, player_mission_progress, mission_claims, xp_transactions, point_transactions and game_events. All user records are synthetic test.invalid administrator fixtures. Approval operations did not assign progress, activate missions or award rewards. No runtime transaction or policy defect was discovered.

Additional focused regressions passed: 33 approval workflow tests, 21 reward arithmetic tests, 14 game-state tests and 17 connection guards. **Combined unique targeted cases: 105 passed, 0 failed, 0 skipped.** The initial temporary Linux copy omitted shared/catalogIdentity.mjs, so gameState.test.ts failed to load while the other 91 cases passed. Copying the existing shared/ directory into the temporary copy fixed packaging; only gameState.test.ts was rerun and all 14 passed. The initial report is retained rather than overwritten. This was a test-copy setup error, not a source/runtime defect. The real PostgreSQL suite was not rerun against the populated database.

### Retained evidence and scope

Evidence directory (0700): /home/techadmin/.local/share/circzles-postgres-tests/s8_circzles_m1_verify_20261022_032eaa0b8b37. Private evidence includes approval-verification.json, game-state-verification.json, verification-summary.json, test-output.txt and manifest.json. The PostgreSQL test source SHA-256 is b3724e64614b5f904c6111d5f020568b24df6764046963ff235e1dba5e5e28b7. The private Linux copy used npm ci with the existing lockfile unchanged and excluded application .env files. No production credentials were read or used.

Backend lint, typecheck and git diff --check passed. Only the new PostgreSQL test file and the two verification documents changed. Existing M1/M2 source, migration SQL/snapshots/journal, next-env.d.ts, lockfile, catalog audits and release commits are preserved. No full regression suite, production operation, commit, push, merge or deployment occurred.

Slice 8 multi-connection verification is complete. Activation remains unimplemented; any future activation must recheck both approvals and current technical/time/cutoff/chest state under the mission lock. The existing unpaid-expired capacity-failure consequence remains a release-policy review item; these tests do not create compensation or extend deadlines.

---

## Historical M1 procedure ? superseded target, do not execute for this task

# Isolated PostgreSQL 18 verification

Docker/PostgreSQL executables were unavailable on the development machine. The real-PostgreSQL suite was not executed, and production Neon was not substituted. PGlite tests remain useful regressions but do not establish PostgreSQL multi-connection locking behavior.

The opt-in suite `backend/tests/missionPostgres.test.ts` uses two separate pg pools and verifies distinct PostgreSQL backend PIDs. It refuses a nonlocal hostname, a different database/role, a populated database, a non-18 server, or missing explicit disposable-environment attestation. It never falls back to DATABASE_URL, never reads production .env credentials and never resets an existing database. Without MISSIONS_TEST_DATABASE_URL, the full default suite reports these tests skipped.

## Exact operator procedure (not executed here)

Use a machine with Docker available. These commands create only a specifically named local disposable container/database. Do not point them at any production service or tunnel. Run from the reviewed M1 checkout's `backend` directory.

```powershell
docker run --name circzles-m1-pg18-test --detach --publish 127.0.0.1:55432:5432 --env POSTGRES_DB=circzles_m1_test --env POSTGRES_USER=circzles_test --env POSTGRES_PASSWORD=local-test-only postgres:18
docker exec circzles-m1-pg18-test pg_isready -U circzles_test -d circzles_m1_test
docker exec circzles-m1-pg18-test psql -U circzles_test -d circzles_m1_test -c 'SHOW server_version;'
$env:MISSIONS_TEST_DATABASE_URL='postgresql://circzles_test:local-test-only@127.0.0.1:55432/circzles_m1_test'
$env:MISSIONS_POSTGRES_DISPOSABLE='YES_LOCAL_DISPOSABLE'
npm.cmd exec vitest run tests/missionPostgres.test.ts -- --maxWorkers=1
```

Wait for pg_isready to succeed before running tests. Pin the image digest/18 patch version used for sign-off and compare it with production (18.6 at audit time). The example password is exclusively for this loopback-bound disposable container. Do not copy production connection strings, identities, uploads or balances into the fixture.

The suite applies migrations through 0025, then intentionally fails 0026 after its DDL. It verifies that M1 tables/functions and the 0026 journal entry rolled back, then retries using the actual checked-in Drizzle migrator. Subsequent cases create synthetic fixtures and check:

- Concurrent workers cannot increment one event twice.
- Concurrent same-key and different-key mission claims pay once, with one XP/SP ledger each.
- Completion versus claim races are retryable without extra payouts.
- Configuration edits holding the definition lock cannot change earned snapshots.
- Chest claims are idempotent across independent pools; a fresh key cannot pay again.
- Poison retries/quarantine persist across independently instantiated workers.
- Forced worker connection termination rolls back active progress and allows safe restart/retry.

The interruption case terminates only a connection bearing the dedicated test application name. Both pools connect only to the attested disposable database. Preserve the complete test output, PostgreSQL version, image digest and reviewed commit SHA for sign-off. Failures are blockers, not a reason to use production for testing. New triggers/fixtures belong only to this disposable database.

Cleanup after verifying that the named container is the one just created:

```powershell
docker inspect circzles-m1-pg18-test --format '{{.Config.Image}} {{json .Config.Env}}'
docker rm --force --volumes circzles-m1-pg18-test
Remove-Item Env:MISSIONS_TEST_DATABASE_URL
Remove-Item Env:MISSIONS_POSTGRES_DISPOSABLE
```

For a rerun, recreate the disposable container; the suite intentionally refuses its populated database. Do not add an automatic reset to bypass this guard. This procedure does not test Render instance overlap or shutdown allowance: the controls-only and M1 rollout still require separate platform verification, with definitions inactive and claims/workers paused until sign-off.


## Completed Slice 9 lifecycle integrity verification ? 2026-10-22

New retained database: circzles_m1_verify_20261022_4469e3ab4956. Server identity: PostgreSQL 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1), version number 180006, literal 127.0.0.1:5432, current/session role circzles_test. Normal techadmin used its existing non-superuser CREATEDB permission only after peer/TCP postmaster identity matched. Permissions were granted only on the new database/public schema. No existing test database was opened, migrated, reset or dropped. Old database catalog OIDs/owners remained unchanged.

**21 real multi-connection tests passed, 0 failed, 0 skipped.** New backend/tests/missionLifecyclePostgres.test.ts requires MISSION_LIFECYCLE_TEST_DATABASE_URL and MISSION_LIFECYCLE_TEST_DATABASE_NAME plus MISSIONS_POSTGRES_DISPOSABLE=YES_LOCAL_DISPOSABLE. It reuses the strict local URL guard, verifies both pools against 18.6/address/port/role/database and distinct PIDs, and refuses a populated database before any schema write. It does not load .env, fall back to application/M1/approval URLs or reset existing databases. Leave other PostgreSQL suite URL variables unset. Any rerun requires a separately authorized new empty database; never reset the retained database to bypass the guard.

The suite applies 0000-0031, seeds an inactive definition/audit, deliberately fails a private copy of 0032 and checks DDL/journal/constraint rollback with prior records intact. Unchanged migration retry succeeds, leaving 33 journal entries through 0032. Seven operation races require two distinct actual mission-row lock waiters before a third connection releases its lock. Two additional observed waits prove atomic lifecycle/audit visibility and deactivation waiting for an M1-style shared processing lock. Approval grant/revocation/edit versus blocked activation, duplicate/different-key deactivation, stale revision/digest, actor/proxy/origin controls, receipt uniqueness/immutability, revision non-revival, audit rollback/retry and earned-snapshot/deadline preservation all passed.

No readiness blocker was bypassed and no successful activation was simulated. Active definitions are explicitly seeded synthetic fixtures only. Final state: 11 lifecycle receipts, 27 administrator audit entries, one synthetic player and one earned progress record; zero activation operations, orphan lifecycle receipts, claims, XP/SP ledger rows or game events. Eight enabled append-only guards protect lifecycle operations, history, approvals and revocations.

Additional focused tests passed: 39 lifecycle, 21 reward arithmetic and 17 local-connection guards. Combined unique result: **98 passed, 0 failed, 0 skipped**. Backend lint/typecheck and git diff --check passed. No full unrelated regression or frontend suites were rerun. Two test-only TypeScript issues were corrected before execution; no runtime defect was found. The private Linux copy reused the prior validated Linux installation after manifest/normalized-lockfile comparison; dependencies were not installed/upgraded. Credentials were supplied only from the restricted local pgpass in process memory, with exact database entry appended and 0600/0700 permissions retained. Application environment files/production credentials were not read.

Evidence retained at /home/techadmin/.local/share/circzles-postgres-tests/s9_circzles_m1_verify_20261022_4469e3ab4956 (0700): lifecycle-verification.json, test-output.txt, manifest.json, verification-summary.json and the private test copy. Tested source SHA-256: 758419d98f34a3a102b7764a8ec4f153b620c184a0c282437866c05c38a89422. The database remains intact. Runtime code, migration history, next-env.d.ts, lockfile, catalog audits and release commits were unchanged. No production access, real payouts, deadline changes, commits, pushes, merges or deployments occurred.

Lifecycle contention verification is complete for the fail-closed scope. The unresolved capacity/deadline policy still blocks new activation, even with both approvals. See MISSIONS_M2.md for the proposed, unimplemented claim-time exception design and exact authorization/product decisions required before implementation. A future positive activation path must be tested only after its release blocker is legitimately resolved; no test override is provided here.


## Slice 10 final real PostgreSQL verification ? 2026-10-23

Authoritative final retained database: circzles_m1_verify_20261023_15c6652b1b2b. Exact identity verified before schema writes and after tests: PostgreSQL 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1), version number 180006, literal 127.0.0.1:5432, current/session role circzles_test. The normal techadmin creator matched local peer/TCP postmaster identity and used its existing CREATEDB/non-superuser permission. Only new-database CONNECT/CREATE and public-schema USAGE/CREATE were granted. No role/authentication settings or existing databases were changed. Exact new pgpass entries retain file 0600 and parent 0700; no credentials/URLs were printed or copied into repository environment files.

New opt-in suite: backend/tests/missionCapacityPostgres.test.ts. Requires MISSION_CAPACITY_TEST_DATABASE_URL, MISSION_CAPACITY_TEST_DATABASE_NAME and MISSIONS_POSTGRES_DISPOSABLE=YES_LOCAL_DISPOSABLE. It reuses the literal loopback URL guard, exact identity checks on independent pools and empty-schema guard. It loads no .env and never falls back to application/M1/approval/lifecycle URLs. A future complete rerun requires a NEW explicitly authorized empty database. No reset, truncate, drop or automatic cleanup of retained databases is provided.

**22 passed, 0 failed, 0 skipped.** The runner migrated through 0032, seeded existing inactive/audit records, deliberately failed a private copy of 0033, verified new DDL and journal rollback with prior audit intact, then retried the unchanged migration. Final journal: 34 entries, 0000-0033. Five race scenarios held a third connection's earned-progress row lock until two independent PostgreSQL sessions were observed waiting on row/advisory locks. They covered same/different-key failed claims, same/different-key recoveries and normal retry versus recovery. The arrival case released an actual lock only after the original deadline and proved the pre-lock arrival still qualified. Tests also cover exact frozen reward recovery after expiry, invalid XP alongside a full SP wallet, stale/forged inputs, SUPER_ADMIN checks, replay, immutable snapshots and transactional OPENED/RECOVERED audit rollback. A synthetic twice-approved mission activated/replayed/deactivated with no activation-time payout.

The final data verification reports 16 immutable exception heads, 4 recovered exceptions with exactly 4 successful claims, 4 XP and 4 SP ledger entries, and 6 enabled new append-only triggers. It found no missing opening audit, unaudited successful claim, reward mismatch, changed/late original deadline, non-synthetic user or active mission. All prior database catalog OIDs/owners remained unchanged. Only synthetic records were used; capacity fixture edits are test-only and no runtime balance-manipulation endpoint exists.

The first attempt on circzles_m1_verify_20261022_da97e4ffbf99 passed 20 and failed 1 timestamp assertion because the database now() default is transaction-start time. Explicit actual recording timestamps fixed the issue. A second isolated database circzles_m1_verify_20261022_5634b6c9f8ed passed 22. The final 20261023 run additionally verifies the two-currency validity preflight so an SP capacity failure cannot hide invalid XP. All three databases and their distinct reports remain intact; the first report was not overwritten, and populated databases were not rerun through the empty guard.

Final evidence directory: /home/techadmin/.local/share/circzles-postgres-tests/s10_circzles_m1_verify_20261023_15c6652b1b2b (0700). Files: capacity-verification.json, test-output.txt, manifest.json, verification-summary.json and private checkout. Test source SHA-256: 951de0bde92059ab789f988d2dc54542805ccb518e36bab1a726ff1860ff7be7. Tested mission runtime SHA-256: 2464f136d18ee9007c47f147ff6dc51d74514ae3f618a26ed839cb0f30a04be9. Dependencies were reused from the prior validated Linux installation after matching manifests/normalized lockfiles; no dependency installation or upgrade occurred.

Additional final checks: 650 targeted backend tests and 101 frontend tests passed with no failures/skips; backend/frontend lint/typechecks/builds and git diff --check passed. See MISSIONS_M2.md for exact API, savepoint, authorization, arrival-time and activation-readiness contracts plus the changed-file list. Older PostgreSQL suite source expectations were updated to the approved policy and latest journal; their full suites were not rerun or counted here. Chest exceptions/linked activation remain blocked; individual mission capacity recovery now resolves its documented blocker when 0033 is installed. No production access, backups, real payouts, production migrations, commits, pushes, merges or deployment occurred.

## Admin-to-player HTTP rehearsal — 2026-10-23

Opt-in suite: `backend/tests/missionE2ePostgres.test.ts`. Requires `MISSION_E2E_TEST_DATABASE_URL`, `MISSION_E2E_TEST_DATABASE_NAME` and `MISSIONS_POSTGRES_DISPOSABLE=YES_LOCAL_DISPOSABLE`. It never loads `.env`, falls back to application URLs, resets a populated database or starts a server/worker. The shared URL guard permits only literal `127.0.0.1:5432`, role `circzles_test` and the established unique disposable naming pattern. Two independently held connections must report the exact database, current/session role, loopback address and PostgreSQL version 180006 before writes. A separate empty-schema guard and journal preflight restrict migration execution to 0000–0033.

Final retained database: `circzles_m1_verify_20261023_677e9d2f2185`; PostgreSQL **18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)**. Backend PIDs 781 and 782 were independently verified. The existing normal `techadmin` creator's local peer identity matched the TCP test role's postmaster; only its existing CREATEDB permission and grants on the newly created database were used. No role or authentication configuration changed. Existing `circzles_m1_test` and earlier retained verification databases were not opened or modified; prior database catalog OIDs/owners were unchanged. Exact new pgpass entries retain 0600 file / 0700 parent permissions, outside Git and OneDrive. Dependencies were reused from the validated Linux installation after manifest/normalized-lockfile matching; no install or upgrade occurred.

**4 passed, 0 failed, 0 skipped** on the final source. These scenarios perform actual authenticated Fastify HTTP injection against real PostgreSQL repositories: migration verification; anonymous/player admin authorization rejection; draft/configuration/product+budget approval/readiness/activation/event processing/frozen reward/deactivation/player claim/replay/ledger hydration; and in-time capacity failure, denied player recovery, audited blocked recovery, ledger-backed synthetic spend, recovery after the original deadline, and idempotent normal/recovery replay. A supported synthetic event is appended through `GameEventService`; SKU/video integrations are not invoked. PostgreSQL row-lock race suites previously verified in Slices 7–10 were not repeated or counted here. The first rehearsal database `circzles_m1_verify_20261023_c208f643d519` also remains intact.

Final database evidence: 34 journal entries; two missions, both inactive; two successful claims; two XP ledger rows; three SP ledger rows (including one synthetic debit); sixteen admin history entries; one exception with `OPENED → RECOVERY_BLOCKED → RECOVERED` history; zero non-synthetic users. Original frozen amounts and deadlines are unchanged. Private evidence (0700): `/home/techadmin/.local/share/circzles-postgres-tests/e2e_circzles_m1_verify_20261023_677e9d2f2185`, containing `manifest.json`, `test-output.txt`, `verification-summary.json` and the tested private checkout. Credential values and connection URLs were not recorded in these reports.

For a future authorized execution, provision another **new, empty local database**, verify identity and supply its credentials only in process memory using the restricted local pgpass. Then run from an isolated Linux backend copy:

```sh
# The three opt-in variables must already be supplied securely by the local operator.
node node_modules/vitest/vitest.mjs run tests/missionE2ePostgres.test.ts --maxWorkers=1
```

Never point this suite at either retained rehearsal database: the empty-schema guard will reject it; do not reset databases to make the guard pass. No real player data, external integrations or rewards were used. Additional validation: 210 focused backend and 92 frontend tests passed, lint/typechecks/backend and frontend builds passed, and `git diff --check` passed. See `MISSIONS_M2.md` for the player period integration fixes and remaining persistent player reward/exception-history gap. No production access, new migration, Git publication or deployment occurred.


## Daily / Weekly chest verification - 2026-10-24

Final fresh database: circzles_m1_verify_20261024_b61868dab9c3, PostgreSQL 18.6 (180006), exact TCP 127.0.0.1:5432, current/session role circzles_test. Independent pool backend PIDs 795 and 800 were verified before writes; no public/drizzle tables existed. Migrations 0000-0035 applied successfully with 36 journal entries. New test source: tests/missionChestsPostgres.test.ts plus helpers/chestCases.ts.

17 passed, 0 failed, 0 skipped. Covers Daily and Weekly draft/configuration/separate approval/readiness/activation/completion/manual payout/deactivation; no individual mission claims required; exact frozen rewards; original UTC/grace contracts; invalid/forged configuration; permanently invalidated approval revisions; linked mission lifecycle guard; unfinished-current-period configuration locking with preserved title-only edits; SP and XP unsafe-grant savepoint rollback; explicit recovery of synthetic historical expired exceptions; immutable history; cross-definition one-payout/pending-exception reservation; concurrent duplicate claims under observed PostgreSQL lock contention; approval/edit race; recovery/normal retry race; and administrator audit-failure rollback. Ledgers and receipts remain single-grant.

Private evidence: /home/techadmin/.local/share/circzles-postgres-tests/chest_circzles_m1_verify_20261024_b61868dab9c3/manifest.json and results.txt (files 0600; enclosing directory 0700). Earlier intermediate verification databases circzles_m1_verify_20261024_957e5dc8fc88 and circzles_m1_verify_20261024_45e4bf7dccb7 are also retained; the final database above verifies the final implementation. The separate browser database is circzles_m1_verify_20261024_e193f2548902. No existing retained verification database or circzles_m1_test was opened/reset/migrated by these tests.

Future authorized execution requires another new empty uniquely named database, not any retained database. Supply MISSION_CHESTS_TEST_DATABASE_URL and matching MISSION_CHESTS_TEST_DATABASE_NAME securely from the existing restricted local pgpass into process memory, with MISSIONS_POSTGRES_DISPOSABLE=YES_LOCAL_DISPOSABLE. The harness validates literal loopback host, port, role, database name, PostgreSQL version and empty schema before migration. No dotenv or DATABASE_URL fallback is used. Run from the isolated Linux backend copy:

    node node_modules/vitest/vitest.mjs run tests/missionChestsPostgres.test.ts --maxWorkers=1

No production access, database deletion, roles/authentication changes, real player activity, external integration, Git publication or deployment occurred.
