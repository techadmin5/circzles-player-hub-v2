# C3 follow-up: external player-state invalidation

Branch: `feature/c3-profile-avatar-live-state`. Builds on approved commit `50782f71b49415510b0c5c4d5ae8b325676188fe`.

## Answer

Yes: an already-open visible Player Hub now receives an external submission approval invalidation and immediately refreshes canonical `/api/me`, updating XP, SP, threshold, level, rank and presentation without manual refresh or waiting for the old 15-second poll. Automated tests demonstrate committed approval notifications and event-driven mounted UI hydration. These are local database/HTTP/browser fixtures, not a claim of live production deployment or a single physical-browser end-to-end production test.

## Architecture and commit ordering

SSE is the smallest suitable one-way transport; no WebSockets, new dependencies or migrations. `insertGameEventInTransaction` now issues `pg_notify('player_state_changed', playerId)` only for newly inserted game events inside the same transaction. PostgreSQL delivers notifications after commit, suppresses rolled-back notifications, and coalesces identical channel/payload notifications within one transaction. See the [PostgreSQL NOTIFY reference](https://www.postgresql.org/docs/current/sql-notify.html).

Each Render process maintains one dedicated session-capable PostgreSQL LISTEN connection, outside the Drizzle transaction pool, and a local map of authenticated SSE subscribers keyed by session-inferred player UUID. Thus a review committed by one backend instance can invalidate a browser connected to another instance using the same database. Listener errors close streams, mark notification service unavailable, and reconnect with exponential backoff from one to 30 seconds. A fresh LISTEN subscription restores availability; no credentials or payloads are logged.

Submission approval already inserts `submission.approved`, rewards through `creditPointsInTransaction` and `grantXpInTransaction` (which insert `points.earned` / `xp.earned` / level-up events), and personal-best updates in its existing transaction. All share the same player-only notification payload, so the notification becomes visible only after the reward/state transaction commits. Review logic and idempotency are unchanged. Idempotent replay emits no new event/notification. Future admin grants should use the existing XP/SP ledger methods, which already take this notification path; no new admin grant route or UI was added.

The browser receives only `event: player-state-changed`, an opaque UUID event ID and `data: {}`. No balances, profile fields, provider metadata, actor ID or secrets are exposed in stream data. The browser calls the existing canonical `/api/me`; database rules and the existing full-snapshot replacement remain authoritative. Player-initiated mutation syncing is unchanged.

## Session isolation and bounded resource use

`GET /api/me/events` requires the existing session cookie and resolves the player through IdentityService. Every query parameter is rejected, including browser-provided player IDs. Production additionally requires the existing server-only Vercel/Render proxy secret. Foreign Origin / cross-site Fetch Metadata requests are rejected. There is no event token in the URL. The stream checks session validity at each ten-second heartbeat and emits `session-expired` then closes on expiry/revocation. Canonical `/api/me` still validates every read; an invalidation conveys no sensitive state during the short revalidation window.

Each player may hold up to five streams per Render process. Disconnects remove subscriptions and timers. Slow readers are disconnected instead of retaining an unbounded frame buffer. Streams rotate after 45 seconds. The existing proxy route allows 60-second invocations and retains its 50-second upstream deadline, leaving time for the bounded backend stream to finish. The browser reconnects and reconciles any changes missed at rotation. Vercel functions have finite invocation durations; see [Vercel duration documentation](https://vercel.com/docs/functions/configuring-functions/duration).

The proxy passes SSE bytes incrementally only for a successful `/api/me/events` response. Other routes retain their reviewed buffering, redirects, authentication cookie forwarding and retry behavior. Stream cancellation aborts the upstream reader; its lifetime deadline remains active after headers. HTTP handshake errors remain ordinary buffered responses.

## Browser reliability

- Opening/reopening a stream hydrates `/api/me` to recover notifications missed during an outage; notifications are invalidations, not a durable replay log.
- Reconnection uses exponential one-to-30-second backoff plus small jitter. A 401 handshake is detected through canonical refresh; an explicit session-expired event also triggers the existing session check.
- Hidden tabs disconnect; visible/focused tabs reconcile and reconnect. A visible five-minute poll is a safety fallback only. No normal 15-second polling remains.
- Notification bursts serialize/coalesce hydration; a further invalidation during a read causes a follow-up canonical read. Duplicate IDs are ignored in a bounded 128-entry set. Failed hydration retries with bounded backoff without replaying mutations.
- Logout/unmount abort pending hydration, remove timers/listeners and close EventSource. Existing API-client request ordering and session-generation guards reject stale/out-of-order snapshots. Old connection callbacks cannot restart the old session.

## Operational prerequisite

`DATABASE_URL` is the default listener connection. If it uses a transaction-mode pooler (see [PgBouncer pooling feature support](https://www.pgbouncer.org/features.html)), the dedicated LISTEN connection must instead use optional backend-only `PLAYER_STATE_EVENTS_DATABASE_URL` pointing to a session-capable/direct connection to the SAME database. This option is additive; no actual environment variable or credential was changed. Transaction writers still use the existing DATABASE_URL. An invalid listener connection produces stream 503 responses and retries, with canonical recovery/fallback rather than silently pretending push is active.

Before a separately authorized rollout, verify LISTEN/NOTIFY works on the configured production database connection and exercise a real Vercel -> Render stream while another instance approves a submission. Check incremental delivery and reconnects after bounded rotation. No live database connection, production migration, deploy or merge was performed. Migration 0022, old migrations, avatar persistence and Player ID sequencing remain untouched. Network delivery is immediate notification-driven under a healthy connection, not a guarantee of zero network latency. Rotations/outages recover by canonical hydration.

## Validation

- Backend: `npm test -- --maxWorkers=2`: **801 passed**, 43 files, zero failures/skips/unhandled errors in the final isolated run. An earlier concurrent tooling run had a Vitest fork startup timeout; rerunning the complete suite alone passed.
- Backend lint, typecheck, build: passed.
- Frontend: `npm test`: **104 passed**, zero failures/skips.
- Frontend lint, `npx tsc --noEmit --incremental false`, build: passed.
- Database integration: actual submission approval, PostgreSQL notifications, real reward/threshold/rank reads, correct recipient, no other-player notification, no notification on rollback/replay, and subsequent XP grants.
- Backend SSE tests: session enforcement, arbitrary-query rejection, production proxy enforcement, Origin/Fetch Metadata, player isolation, outage/connection caps, real HTTP incremental delivery, session expiration, bounded rotation, PostgreSQL listener reconnection and shutdown.
- Frontend mounted tests: event-driven XP/SP/level/rank/progress/header rendering with no poll/mutation, duplicate IDs, reconnect/visibility recovery, logout, session expiration, unmount and hydration-outage retry. Browser EventSource is a controlled test double; the real HTTP/proxy transport is tested separately.
- Proxy tests: real HTTP SSE frames before EOF, preserved session cookie, cancellation, lifetime timeout and buffered unauthorized handshake. Existing proxy/auth/mutation/Player ID regression suites remain green.
- The existing coupon transaction test double gained a checked SQL execute implementation for the new shared game-event notification; existing coupon assertions were preserved and strengthened to assert one invalidation.

## Exact follow-up files

- `backend/src/config/env.ts`
- `backend/src/db/playerStateListener.ts`
- `backend/src/domain/gameEvents.ts`
- `backend/src/domain/playerStateEvents.ts`
- `backend/src/http/app.ts`
- `backend/src/http/playerStateEventRoutes.ts`
- `backend/src/server.ts`
- `backend/tests/couponBridge.test.ts`
- `backend/tests/playerProfile.test.ts`
- `backend/tests/playerStateEvents.test.ts`
- `docs/c3-player-state-events.md`
- `docs/c3-profile-avatar-live-state.md`
- `src/components/auth/AuthProvider.tsx`
- `src/lib/playerStateEvents.ts`
- `src/lib/server/apiProxy.test.mjs`
- `src/lib/server/apiProxy.ts`
- `src/stores/playerLiveState.test.mjs`
