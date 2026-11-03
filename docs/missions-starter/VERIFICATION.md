# Final starter Missions verification — 2026-11-03

**PASS for local technical verification and release preparation. Live activation remains blocked by unapproved product/budget decisions.** No production connection, migration, draft creation, approval, activation or payout was performed.

## Exact collection

All features below are implemented locally; no definition is automatically approved or activated. XP/SP values are proposals, in that order.

| Title | Category | Event / tracking | Threshold | XP / SP | Collectible | Implemented |
| --- | --- | --- | --- | --- | --- | --- |
| Daily Check-In | Daily | `player.checked_in`; explicit authenticated action | 1 / UTC day | 10 / 10 | None | Yes |
| One More Spin | Daily | `reward_wheel.spun`; successful persisted spin | 1 / UTC day | 10 / 15 | None | Yes |
| Take Your Shot | Daily | `submission.created` | 1 / UTC day | 20 / 25 | None | Yes |
| Circle Collector | Daily | `puzzle.added` | 1 / UTC day | 15 / 20 | None | Yes; duplicate objective |
| Puzzle Explorer | Daily | `personal_best.improved` | 1 / UTC day | 15 / 15 | None | Yes |
| Weekly Puzzle Quest | Weekly | `submission.approved` | 3 / ISO UTC week | 60 / 75 | None | Yes |
| Spin Streak | Weekly | `reward_wheel.spun`; distinct UTC dates | 3 dates / week | 40 / 50 | None | Yes |
| Puzzle Challenger | Weekly | `submission.created` | 3 / ISO UTC week | 60 / 80 | None | Yes |
| Circle Explorer | Weekly | `mission.completed`; distinct definitions from the five starter Dailies | 4 of 5 / week | 75 / 100 | None | Yes |
| Weekly Comeback | Weekly | `player.checked_in`; distinct UTC dates | 4 dates / week | 50 / 70 | None | Yes |
| Puzzle Pro | Weekly | `personal_best.improved` | 3 / ISO UTC week | 80 / 100 | None | Yes |
| First Puzzle Registered | Achievement | `puzzle.added`; first-ever only | 1 / lifetime | Unset | First Steps badge | Yes; reward incomplete |
| First Submission | Achievement | `submission.created`; first-ever only | 1 / lifetime | Unset | None | Yes; reward incomplete |
| First Approved Solve | Achievement | `submission.approved`; first-ever only | 1 / lifetime | Unset | Puzzle Solver badge | Yes; reward incomplete |
| Puzzle Milestone | Achievement | `submission.approved`; post-activation events | 10 / lifetime | Unset | Puzzle Milestone frame | Yes; reward incomplete |

No inherently impossible threshold was found. Availability and review timing can limit progress; the collection does not promise every mission can be finished by every player in every period.

## Product findings requiring decisions

1. **Daily Check-In is not automatic login detection.** Only the authenticated button/API action counts. Page load, refresh, wheel viewing and token refresh do not. The label and description accurately say check-in.
2. **Circle Collector duplicates the operator-described existing Start Your Circle objective** (one new CircZle per UTC day), with a different proposed reward. Activating both could intentionally pay both. Decide whether to retain this additional draft, leave it inactive or separately redesign it. No existing mission was modified, and no live configuration was inspected.
3. **Four achievement rewards remain incomplete.** Existing payout contracts require at least one explicitly configured positive XP/SP amount; a badge/frame alone cannot complete reward configuration. No values were invented. Exact reward-budget approvals are missing for the entire collection.
4. **Proposed definitions need product approval:** three approved solves for Weekly Puzzle Quest; three personal-best improvements for Puzzle Pro; ten approved solves for Puzzle Milestone; the Circle Explorer eligible set; and collectible associations. Daily/Weekly overlap uses different periods/thresholds and is not an accidental duplicate definition.
5. **Approval-driven timestamps:** approved-solve and personal-best events count when the official review records them, not when the player originally uploaded or physically solved the puzzle. Daily Puzzle Explorer therefore depends on review timing. Live wheel availability and historical-data completeness require operator confirmation before activation; no production check was authorized.

## Real PostgreSQL execution

Final retained database: `circzles_m1_verify_20261103_5e07008cb65e`.

- PostgreSQL **18.6**, version number **180006**, literal TCP **127.0.0.1:5432**, current/session role **circzles_test**.
- Two independently held connections reported different backend PIDs **769 / 770** before schema writes. The test refused any other URL/identity or populated schema.
- The normal `techadmin` peer connection matched the local TCP postmaster and used only its existing non-superuser CREATEDB permission. Grants were limited to each newly created database and its public schema. No roles, authentication settings or existing databases were changed.
- Actual migrator applied **0000–0035**, seeded synthetic existing earned state, then applied **0036**. Final journal: **37 entries**. The old mission, entitlement, prior balances and ledger rows were unchanged by the upgrade.
- **16 PostgreSQL tests passed; 0 failed; 0 skipped.** Seven contention scenarios each observed **two waiting PostgreSQL sessions** before releasing the blocking transaction.
- **17 local-connection guard tests passed; 0 failed; 0 skipped.** No remote or application database URL fallback exists. No `.env` was copied or loaded.

Verified races and invariants:

- Simultaneous starter batch requests return the same 15 inactive IDs, exactly one creation per key, no duplicate audit entries, no approvals and no grants. Readiness is blocked by approval requirements and, for achievements, incomplete currency configuration.
- Simultaneous explicit check-ins persist exactly one server-UTC event. Distinct-day processing handles repeated events and the ISO Monday boundary under independent workers.
- Distinct-mission aggregation counts unique eligible earned definitions, not repeated completions on different days, and preserves delayed event attribution.
- First-ever submission/approval rules reject pre-cutoff activity without backfill. A genuine synthetic puzzle-claim → submission → official approval journey creates separate lifetime submission and approval entitlements; retries do not duplicate them. The approved collectible is delivered through normal claiming.
- Same-key badge/frame claims replay one receipt; different keys cannot double-grant XP/SP or Inventory. Frozen collectible IDs survive later configuration changes. Two earned entitlements for the same badge produce one owned item while preserving both legitimate currency rewards.
- Badges equip in badge slots; frames equip in FRAME. Incompatible slots and another player's item are rejected. Unequipping retains ownership.
- An injected **test-only** delivery failure rolls back XP, SP, claim and Inventory writes. Ordinary retry succeeds once. Capacity failure retains the collectible entitlement; concurrent explicit SUPER_ADMIN recovery delivers it once.
- Earned collectible, contribution and batch-correlation protections remain effective. Existing synthetic Start Your Circle still pays its original frozen **50 XP / 100 SP** once, preserving previously earned **123 XP / 250 SP** and their exact ledger rows. Final baseline totals are **173 XP / 350 SP**. This is a compatibility fixture, not a live-data audit.

Final synthetic data checks: **15 inactive starter drafts; 0 approval records; 0 lifecycle activation operations; 9 claims; 7 Inventory grants; 0 non-synthetic users; 0 wallet/XP ledger mismatches**.

Evidence retained outside Git/OneDrive, directory 0700:

`/home/techadmin/.local/share/circzles-postgres-tests/starter_circzles_m1_verify_20261103_5e07008cb65e/`

Contains `manifest.json` (tested source hashes), `results-final.txt`, `verification-summary.json`, the private source copy and the initial failed-import log. Existing restricted local pgpass remains 0600, parent 0700; exact new database entries were appended without exposing passwords. Matching existing Linux dependencies were reused; nothing was installed or upgraded.

An earlier retained fresh database, `circzles_m1_verify_20261103_94de201e5514`, passed the initial 15 PostgreSQL + 17 guard cases. The final expanded copy initially lacked `shared/catalogIdentity.mjs` and failed during import, before database setup. Its target was verified still empty; copying that existing shared source into the private copy resolved the packaging error. No database was reset or dropped, and no application defect was found. Existing `circzles_m1_test` and earlier retained verification databases were not opened or modified.

## Other checks and future execution

- Offline batch dry run passed with socket/HTTP connection functions deliberately replaced by fail-on-use guards. It made **no network calls**, received no credentials and created no data or approvals.
- Backend test typecheck and targeted ESLint passed; `git diff --check` passed. The previously passing 466/99 suites and production builds were not repeated because runtime/frontend source did not change.
- Added only the opt-in PostgreSQL test and verification documentation. Existing source edits, migration files, lockfile, protected `next-env.d.ts`, catalog audits and rollout documentation were preserved.

A future full test invocation requires a **new, empty, uniquely named local database**, with `MISSION_STARTER_TEST_DATABASE_URL`, matching `MISSION_STARTER_TEST_DATABASE_NAME` and `MISSIONS_POSTGRES_DISPOSABLE=YES_LOCAL_DISPOSABLE` supplied securely in process memory. Use the existing local pgpass method; never print URLs or credentials. Copy `backend/` and `shared/` to the isolated Linux workspace, excluding `.env` and production configuration. Then:

```sh
node node_modules/vitest/vitest.mjs run tests/missionStarterPostgres.test.ts tests/localMissionPostgres.test.ts --maxWorkers=1 --testTimeout=30000
```

Do not rerun against either populated retained database or reset it to bypass the guard. No production execution is authorized by this document.

**Single next release step:** review and approve the exact starter manifest, resolving the Circle Collector overlap and explicit achievement currency amounts before code publication/deployment or per-revision live approvals are separately authorized.
