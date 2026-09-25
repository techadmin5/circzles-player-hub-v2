# Phase C2: Fast Session Bootstrap

## Status

Implemented and locally validated on `phase-c2-fast-session-bootstrap`. No database schema, migration, cookie policy, provider-authentication flow, or deployment setting changed.

## Previous Session Flow

`GET /api/auth/session` previously performed all of the following before the frontend could leave its protected-route loading state:

1. Hash and look up the opaque session token through `IdentityService.refreshSession`.
2. Renew the database session when its 24-hour sliding-refresh interval was due.
3. Refresh the existing HttpOnly cookie expiry.
4. Call `GameStateService.ensurePlayerGameState`.
5. Call `withGameState`, which called `GameStateService.getPlayerGameState`.
6. `getPlayerGameState` ensured game state again, then read progression, the current/next progression level, and wallet balance.
7. Return the gameplay-enriched player DTO.

The auth-critical database work was the session lookup and the conditional session renewal. The active progression-level lookup, wallet/progression inserts with conflict handling, and progression/wallet reads were gameplay hydration. Requiring both categories to complete made authentication wait on nonessential game-state work. A sleeping Render instance can add process-start and database-connection latency before either category begins.

## Fast Session Flow

`GET /api/auth/session` now performs only:

1. Validate the opaque cookie against the authoritative session row.
2. Apply the existing bounded sliding renewal when due.
3. Refresh the cookie with the authoritative expiry using the existing security settings.
4. Return core identity: `internalId`, `publicPlayerId`, `displayName`, avatar/default avatar, country, and state.

The route no longer calls `ensurePlayerGameState`, `getPlayerGameState`, or `withGameState`. It therefore does not initialize or read progression, wallet, puzzle ownership, missions, rewards, wheel state, leaderboards, submissions, or inventory.

No production latency benchmark was performed. The route is materially smaller, but a sub-second production result cannot be claimed without measuring the deployed stack.

## Deferred Hydration

After the core session succeeds, `AuthProvider` enters `authenticated` immediately so the protected shell can render. It then requests `GET /api/me` in the background to obtain the existing authoritative full profile, including progression level, rank, XP, XP needed, and Synapse Points.

While `/api/me` is pending, the shell uses the verified core identity and `/brand/avatar.svg` fallback. Gameplay metrics use fixed-size loading placeholders; the frontend does not invent XP, rank, balance, or other game values. Deferred profile requests are coalesced and cancelled when the player logs out or a newer session check supersedes them, preventing a stale response from repopulating state.

## Hub Loading Strategy

The Hub no longer uses one all-or-nothing `Promise.all`. Puzzles, missions, leaderboard, and Reward Wheel state load independently and each section owns its loading, empty, error, and success presentation. A failure in one optional resource does not remove the authenticated identity, the shell, or successful neighboring sections.

## Timeout And Retry

The browser session check has a bounded 30-second timeout. This is a modest cold-start allowance after removing gameplay hydration, not an attempt to conceal a 40-60 second backend delay.

- HTTP 401 becomes `unauthenticated` and preserves the existing safe local `returnTo` redirect.
- Timeout, network failure, and server failure become `error`, not `unauthenticated`.
- **Try again** starts a new coalesced session check and returns to the immediate loading skeleton.
- No failure path starts Google OAuth. Google remains an explicit login-page action.

## Security Invariants

Phase C2 did not change the session secret, cookie name, HttpOnly/Secure/SameSite settings, cookie domain, session duration, sliding-renewal interval, logout revocation, CORS, CSRF assumptions, frontend origin, safe `returnTo` validation, Wix identity verification, direct email flow, or Google flow. The browser still cannot select player identity, and all private gameplay APIs continue deriving `player_id` from the authoritative session.

## Render Limitation

An optimized route cannot remove platform process startup. A sleeping free Render service can still delay the first request enough to reach the browser timeout. Synthetic client keepalive polling was intentionally not added. An always-on Render instance is recommended before public launch for predictable authentication latency.

## Files Changed

- `backend/src/domain/identity.ts`
- `backend/src/http/app.ts`
- `backend/tests/fakes.ts`
- `backend/tests/http.test.ts`
- `src/components/auth/AuthProvider.tsx`
- `src/components/game-shell/GameShell.tsx`
- `src/components/hub/ProductionHub.tsx`
- `src/components/player/PlayerIdentityPanel.tsx`
- `src/lib/apiClient.ts`
- `src/types/index.ts`
- `docs/API_CONTRACTS.md`
- `docs/AUTHENTICATION_DESIGN.md`
- `docs/PHASE_C2_FAST_SESSION_BOOTSTRAP.md`

## Validation

- Backend tests: 519 passed across 34 files.
- Backend lint, typecheck, and build: passed.
- Frontend lint and production build: passed.
- Frontend unit tests: no frontend test runner is configured in the root package.
- `git diff --check`: passed.
- No database commands, migrations, or external runtime calls were made.
