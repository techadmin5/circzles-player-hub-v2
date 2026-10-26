# Individual Missions: real local browser rehearsal

Latest additional rehearsal, 2026-10-24: **28 chest/product-policy browser assertions passed** against a fresh synthetic PostgreSQL database. See [the consolidated report](MISSIONS_RELEASE_CANDIDATE.md). Daily/Weekly were explicitly configured at approved 50 XP / 100 SP and 200 XP / 250 SP, independently approved, explicitly activated, manually claimed and checked for duplicate protection/history/isolation. Durable Daily capacity failure and blocked/successful explicit recovery were exercised without production connections. Earlier individual and provisional chest journeys below remain historical evidence, not current reward defaults.

Executed 2026-10-23 against synthetic data only. **30 workflow checks passed, 0 failed, 0 skipped.** This was real headless Google Chrome 155.0.8059.85 controlled with Playwright Core 1.58.2, not Fastify injection, JSDOM or a source-only review. No production connection, migration, backup, deployment or Git publication occurred.

## Verified environment

- Fresh database: `circzles_m1_verify_20261023_396a1eb04ec6`; PostgreSQL 18.6 / version number 180006, literal `127.0.0.1:5432`, current/session role `circzles_test`.
- The existing normal `techadmin` creator's local peer identity matched the TCP test connection's postmaster. Its existing CREATEDB permission created only the new database. Only new-database CONNECT/CREATE and public-schema USAGE/CREATE grants were applied; roles and authentication settings were unchanged.
- The test-only entry point verifies the exact database, server, role, loopback address, matching private manifest and database-specific artifact directory before application work. Startup requires empty public/Drizzle schemas and exactly the 0000–0033 migration journal. All 34 journal entries were verified after execution. No retained database was reset, truncated, deleted or opened for application queries. Prior database catalog OIDs/owners were unchanged.
- Restricted local pgpass remained 0600 with a 0700 parent. Database credentials were supplied in process memory, not shell arguments, repository environment files, browser storage or evidence logs.
- Backend: a private Linux copy using `backend/tests/helpers/missionBrowserServer.ts`, listening only on `127.0.0.1:4107`. Frontend: a separate Windows temporary copy using Next.js development mode on `127.0.0.1:3107`, with the actual Next API proxy targeting that local backend. No environment files were copied. Frontend child environment was explicitly allowlisted and used only local public/API settings. Development HTTP was used only on loopback; no production TLS/proxy guard was weakened.
- The browser context allowed requests only to the local frontend origin. Chrome background networking/update/sync were disabled. There were no page exceptions and no attempted external page origins recorded.
- Real native password hashing, verified synthetic credentials, sessions, administrator authorization, player profile hydration, puzzle ownership, mission configuration, approvals, lifecycle, claims, history and recovery repositories were used. No test login bypass or extra HTTP control endpoints were added.
- Mail delivery and avatar/Cloudinary operations throw if invoked; external Google authentication is unconfigured, and unrelated integration services fail closed. No normal `server.ts` startup, background worker, coupon synchronization, maintenance scheduler or real notification was started. The operator explicitly invoked the existing mission processor against the new local database after actual SKU claims.

## Browser results

| Checks | Result |
| --- | --- |
| 1–2: synthetic SUPER_ADMIN native login; `/admin/missions` list, search and details | PASS |
| 3–6: inactive draft; supported `puzzle.added` rule/source; valid explicit UTC availability; 7 XP / 3 SP | PASS |
| 7–10: independent product and budget approval; persisted readiness; confirmed activation; active state and audit history | PASS |
| 11–13: separate synthetic player native login; Missions navigation; actual Add CircZles SKU claim | PASS |
| 14–17: processing creates completed progress/frozen amounts; player UI claim; 7 XP / 3 SP and synthetic progression level 2 | PASS |
| 18–20: paid Mission History; browser reload persistence; duplicate claim rejected and claim control removed | PASS |
| 21–23: real logout/account switches; other account has no paid/earned history; ordinary admin UI denied and API 403 | PASS |
| 24–25: synthetic full SP wallet causes atomic claim failure; pending exception persists in player history | PASS |
| 26–28: SUPER_ADMIN reason/confirmation authorizes recovery; recovered history visible to player; exactly-once ledgers | PASS |
| 29–30: confirmed deactivation; original completion, frozen rewards and paid/recovered histories remain visible | PASS |

The synthetic mission ID was `2b2ddd3e-a1f0-436c-9d06-1903cbb0f2c2`. Synthetic SKUs `QA-M1-R1-0001` and `QA-M1-R1-0002` were claimed through the real Add CircZles form, producing the actual `puzzle.added` emitter contract. No production manufacturing fixture or SKU mapping changed.

Readiness retained advisory SP/XP headroom warnings while configuration and both exact approvals passed; activation used the existing guarded transaction, with no readiness override. A duplicate authenticated browser claim returned 409 `MISSION_ALREADY_CLAIMED`; ordinary-player administration and recovery requests returned 403. Browser account switching used actual logout and native login, not cookie injection.

The capacity player's SP wallet was initially seeded at the integer maximum as an explicit synthetic fixture. After the on-time capacity failure, the operator made one idempotent, ledger-backed synthetic spend of 10 SP through `debitPointsInTransaction`. The administrator then authorized the original 7 XP / 3 SP recovery in the actual UI. The recovery endpoint did not manipulate balances to create headroom. This browser run did not wait for a claim deadline; after-deadline recovery and lock-wait arrival behavior remain covered by the previous isolated PostgreSQL suites. No deadline was changed or extended.

## Database reconciliation

| Synthetic account | Final SP | Final XP | Level | Claims | XP ledger rows | SP credits | SP debits |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| player | 3 | 7 | 2 | 1 | 1 | 1 | 0 |
| capacity | 2147483640 | 7 | 2 | 1 | 1 | 1 | 1 |
| admin | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| other | 0 | 0 | 1 | 0 | 0 | 0 | 0 |

Both earned records remain CLAIMED with the original 7 XP / 3 SP snapshot and original deadline. The mission is inactive with eight administrator audit entries: draft, rule, schedule, rewards, two approvals, activation and deactivation. One capacity exception has immutable OPENED and RECOVERED transitions. There are exactly two successful claims/XP grants/SP credits, and no duplicate payout.

## Evidence and cleanup

Authoritative private evidence is retained outside Git and OneDrive at:

`/home/techadmin/.local/share/circzles-postgres-tests/browser_circzles_m1_verify_20261023_396a1eb04ec6`

It contains the manifest, tested Linux copy, backend log, private control wrapper, sanitized `browser-evidence.json`, `verification-summary.json` and ten PNG screenshots. The database is retained intact. Generated synthetic account credentials remain only in the protected Linux QA directory; the temporary Windows credential copy was removed after use. No database credentials were copied to Windows/browser evidence.

Windows screenshot/evidence copies remain available at:

`C:/Users/techt/AppData/Local/Temp/circzles-browser-cfd2bb9267754e2986e21cc25fc91223`

1. `01-admin-active.png`
2. `02-player-earned.png`
3. `03-player-paid-history.png`
4. `04-other-account-isolation.png`
5. `05-capacity-pending.png`
6. `06-admin-recovery.png`
7. `07-player-recovered.png`
8. `08-admin-deactivated.png`
9. `09-inactive-paid-history.png`
10. `10-inactive-recovered-history.png`

The owned Chrome browser was closed. Only the verified QA backend PID and frontend process tree were stopped. No database or retained source copy was removed. No real user records, rewards, Cloudinary media or production state were touched.

## Findings, validation and scope

No application defect was found in the tested individual-mission paths, so no production implementation or business rule changed. An initial browser harness used an overly exact select-label locator and timed out; automation recovered with the actual named select control, without creating a duplicate draft. The final workflow checklist passed. This was an automation issue, not a product validation bypass.

The QA backend deliberately omitted the optional player-state SSE listener. `/api/me/events` returned 404 and existing canonical-state fallback was used; no browser page error resulted. Mission/history changes used the implemented explicit refresh actions. External authentication, email delivery, Cloudinary uploads, submissions, chests and automatic worker lifecycle were not browser-tested in this run. Existing historical title-snapshot limitations are unchanged and disclosed in Mission History.

Focused validation: **40 backend tests and 86 frontend tests passed, 0 failed, 0 skipped**. These cover local connection guards, persisted history, admin builder/lifecycle/approval/recovery controls and player mission/history behavior. Backend/frontend lint, typechecks, production builds and `git diff --check` passed. Unrelated full suites and previous PostgreSQL contention suites were not repeated.

The new helper is test-only and is never imported by application startup or automatically run by the test suite. For a future separately authorized fresh database, an operator must provision a matching private manifest/directory, supply the dedicated URL and exact database name securely in `MISSION_BROWSER_DATABASE_URL` / `MISSION_BROWSER_DATABASE_NAME`, set `MISSION_BROWSER_ARTIFACT_DIRECTORY` and attest `MISSIONS_POSTGRES_DISPOSABLE=YES_LOCAL_DISPOSABLE`. It is then invoked explicitly in a private Linux backend copy:

```sh
node --import tsx tests/helpers/missionBrowserServer.ts serve
# Separate invocations use the same verified new database and protected manifest:
node --import tsx tests/helpers/missionBrowserServer.ts process
node --import tsx tests/helpers/missionBrowserServer.ts spend
node --import tsx tests/helpers/missionBrowserServer.ts report
```

`serve` refuses populated databases. `process` is bounded; `spend` validates the exact synthetic capacity owner and uses a single stable idempotency key; `report` is read-only. Never reset an existing database to make these guards pass. The helper deliberately binds fixed loopback ports; inspect availability before launching. No repository environment file is required or should be copied.

Next milestone: review the preserved M1/M2 working diff as an individual-Missions release candidate, including its existing migration/worker controls and historical-data limitations. Production remains on 0025. This report grants no permission to publish, migrate, configure or deploy. Chest completion/linked activation/claim exceptions remain deferred.


## Daily / Weekly chest journeys - 2026-10-24

This supersedes the prior chest deferral for the explicitly approved initial scope. Fresh PostgreSQL 18.6 database circzles_m1_verify_20261024_e193f2548902 used only synthetic @test.invalid accounts; migrations 0000-0035. Explicit loopback-only helper on 4107 and isolated frontend copy on 3107; no repository .env copied; workers, outgoing mail, Google and media integrations disabled. Browser requests restricted to the local frontend. The helper now explicitly accepts migrations through 0035 and offers chest-setup, a one-time synthetic fixture action using actual mission draft/rule/schedule/reward/approval/lifecycle services. It creates five Daily and six Weekly synthetic missions, each with explicit 1 XP; it creates no chest and grants no player reward. Actual chest creation, 1 XP + 1 SP configuration, separate approvals, activation and manual claims were performed through browser screens.

23 workflow checks passed, 0 unresolved failed checks; no browser page errors. Verified: SUPER_ADMIN access; inactive reward-free draft; exact five/six pools and three/four targets; independent product/budget approval and readiness; mandatory activation confirmation; initial zero-progress cards; real synthetic Add CircZles event; bounded processing; distinct mission-completion unlock without individual reward claims; manual Daily and Weekly payments; refreshed balances and paid history; duplicate claim rejection; durable capacity exception; explicit reason/confirmation for SUPER_ADMIN recovery; original frozen amounts/deadline in append-only recovery history; deactivation retaining recovered player history; administrator authorization; no internal recovery notes in player responses; separate-player isolation; anonymous history rejection; desktop/mobile visual inspection. Mobile document width equals viewport width (390 px).

Synthetic normal player: two successful chest claims, 2 XP, 2 SP, two XP and two SP credit ledgers, zero individual mission claims. Capacity player: initial synthetic SP boundary, one on-time failed Daily payout, a ledger-backed 10-SP synthetic test spend, then one explicitly authorized recovery for the original 1 XP + 1 SP. No provisional production budget was approved or activated.

Evidence outside Git: C:/Users/techt/AppData/Local/Temp/circzles-chest-browser-gMlwJt/checks.json and screenshots chest-admin.png, chest-player-unlocked.png, chest-player-paid.png, chest-capacity-pending.png, chest-recovery-admin.png, chest-recovered-history.png, chests-final-desktop.png and chests-final-mobile.png. Current responsive screenshots use the corrected existing cz-surface design class and progress bars; earlier screenshots show intermediate styling. Generated temporary Windows synthetic login credentials were removed and its diagnostic log sanitized. The protected Linux synthetic account fixture is retained with the isolated browser database; no production credentials or PG connection URLs are in browser evidence.

Rehearsal corrected copied chest recovery wording and an initially mismatched card style. Intermediate automation retries waited for hydration/committed status rather than interpreting an in-flight DOM as a payment failure. Product reward amounts still require explicit approval for any eventual real release. This rehearsal authorizes no production action.

Final follow-up: unfinished current-period pool/reward/window edits are now fail-closed (title-only edits remain available). That guard was verified by the final synthetic/real-PostgreSQL runs (257 backend / 17 PostgreSQL); the 23 browser checks exercised the preceding happy-path configuration, claim and recovery implementation. The retained browser database reflects the earlier draft migration 0035, which also had an extra one-active-definition index subsequently removed to preserve M1 compatibility. The final migration schema was verified in the new b61868dab9c3 database; never rerun migrations against the retained browser database.
