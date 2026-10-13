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
