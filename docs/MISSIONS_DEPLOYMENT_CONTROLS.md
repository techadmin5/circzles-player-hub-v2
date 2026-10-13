# Mission deployment controls (compatible with schema 0025)

This patch is independently deployable on production main through migration 0025. It adds no migration, reward changes, objective types, M1 schema imports or seeds. The same runner, maintenance middleware and shutdown coordinator are reused by M1.

## Configuration

| Variable | Accepted values | Default | Effect |
|---|---|---|---|
| MISSION_PROCESSOR_ENABLED | Exact lowercase `true` or `false` | true | false prevents all new polling batches, including direct runner ticks. |
| MISSION_CLAIMS_ENABLED | Exact lowercase `true` or `false` | true | false blocks legacy mission, explicit-period mission and chest claim POST routes with authenticated HTTP 503 / MISSION_CLAIMS_MAINTENANCE, Retry-After: 60. |
| BACKEND_SHUTDOWN_TIMEOUT_MS | Integer 1000–300000 | 25000 | Maximum total worker/HTTP/database shutdown wait. |

Invalid values fail startup. These are static server environment variables, not browser inputs or runtime toggle APIs. Environment changes require a Render deployment using the updated environment. Render “Restart service” reuses the currently deployed environment and is not a substitute. Saving variables is not proof that all old instances have adopted them.

Read APIs remain available; disabling claims does not edit progress, snapshots or earned deadlines. The grace clock still runs during maintenance. Plan a short window and monitor existing deadlines; this patch does not extend or revoke rewards.

## Observability and drain

GET /health retains `ok` and adds `missions.worker` (`enabled`, `status`, `scheduled`, `inFlight`) plus `missions.claimsEnabled`. Worker states are disabled, idle, running, draining and stopped. No credentials/player details are exposed. Startup logs print the effective controls; shutdown logs contain safe lifecycle event/code and worker state. A healthy public response describes the responding instance, not all Render instances.

SIGTERM and SIGINT share one memoized shutdown. Scheduling stops synchronously. Accepted-but-not-started ticks are cancelled; started processing drains its existing batch. HTTP closure starts concurrently, so new connections are rejected and existing HTTP requests drain. Database connections close only after both drains finish. Repeated signals do not restart shutdown or close resources twice. Application onClose also awaits the same worker drain.

The configured timeout defaults to 25 seconds, below Render's default 30-second termination allowance. Set Render's shutdown allowance above the application timeout with a margin if extending it. Timeout/resource failure logs a safe code and exits 1; success exits 0. Forced termination disconnects active transactions, which PostgreSQL rolls back, but an already committed response may be lost. Do not replay/reset events: retries must use the same claim idempotency key. The M1 processor's committed state and ledgers determine recovery.

## Coordinated rollout (operator actions only)

1. Review the controls-only branch independently. Record Render's deployed SHA, service IDs, instance count, root directory, build/start commands, other jobs/workers using the database, health check and shutdown delay. Disable auto-deploy for the maintenance sequence. Take a verified recoverable backup and capture protected player/ownership/submission/ledger baselines. Do not change production mission/chest definitions.
2. Deploy the controls-only commit on the existing 0025 schema. Set both controls to false for this deployment. Old pre-controls instances continue their existing behavior until terminated; do not migrate during that overlap.
3. Wait for every old instance to exit. Verify Render deploy/instance events and effective controls on every new instance's logs. GET /health must report worker disabled, no inFlight batch and claimsEnabled false. Claims should return authenticated 503; mission reads must still work. Do not use fake production claims or payouts as probes. For any subsequent flag change, redeploy and repeat the all-instances check.
4. With all workers drained and all claim routes disabled, use a single reviewed migration runner with the M1 checkout. Confirm only 0026 is pending; run `npm run db:migrate` from backend. Do not use db:push, seeds, resets or manually replay historical events. Compare schema/journal and protected data against preflight. Existing controls-only HTTP can remain running; its mission worker and claims must remain disabled throughout.
5. Deploy M1 with both controls still false. Wait until all controls-only instances exit. Verify the migrated schema, health state, mission/chest read endpoints, existing authentication/profile/collection/submission/leaderboard/store/inventory reads and protected records (including Hazel's approved Lion 195000 ms). Do not activate definitions or grant test rewards.
6. Resume workers separately: set MISSION_PROCESSOR_ENABLED=true, keep MISSION_CLAIMS_ENABLED=false, then redeploy. Wait for completion across all instances; inspect effective state, queue age, retry/quarantine and configuration failures. Do not backfill/replay processed events.
7. Resume claims separately: set MISSION_CLAIMS_ENABLED=true and redeploy, preserving the worker setting. Verify all old disabled instances have exited and the effective configuration is consistent. Definitions stay inactive until a separately reviewed activation rollout. Re-enable auto-deploy only after sign-off.

These names are exact Render environment keys. No independent live-process pause command exists: false plus a completed redeployment is the pause operation; true plus a completed redeployment is the resume operation. Do not substitute a long polling interval, maintenance-mode page, database permission revocation, mission deactivation or a process restart with stale environment.

If a deployment fails, the previous instances may remain live. Confirm their version/effective controls before doing anything else. If 0026 has committed, keep the additive schema and maintenance controls; do not roll back to pre-controls code or delete earned snapshots/provenance. Restore a backup only under a separately reviewed recovery plan that accounts for subsequent legitimate player writes.

## Real PostgreSQL verification before production sign-off

Use an isolated disposable PostgreSQL 18 instance and at least two independent pg pools, not production Neon and not PGlite as a concurrency substitute. Required scenarios: concurrent workers; same/different-key claims; completion versus claims; definition/reward edit races under definition locks; interruption/restart; persisted poison retries/quarantine; migration failure/rollback/retry. M1 provides the opt-in executable regression procedure in docs/MISSIONS_POSTGRES_VERIFICATION.md. No staging service is assumed or provisioned.

This controls-only patch does not itself claim production readiness or authorize deployment/migration/activation.
