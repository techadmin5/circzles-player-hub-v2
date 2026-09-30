# Phase C2.6 - Production Email Auth Redirect and Session Audit

## Status

IMPLEMENTED AND AUTOMATED-TESTED. Production configuration correction and live browser verification remain required.

The callback transport described in the original audit below was subsequently hardened for Wix's documented Google fragment response. The current configured public callback is the frontend route `https://circzles-player-hub.vercel.app/auth/callback`; the earlier Render and `/api/...` callback URLs remain historical evidence only.

## Production Evidence

The captured production email login request reached the first-party Vercel path and returned HTTP 200 with a Wix `authorizationUrl`. That URL contained this callback:

`https://circzles-player-hub-api.onrender.com/api/auth/direct/google/callback`

After the flow, the browser requested the first-party Vercel `/api/auth/session` path and received HTTP 401.

## Exact Redirect Source

`backend/src/config/env.ts` reads `WIX_DIRECT_AUTH_CALLBACK_URL`. `backend/src/server.ts` passes that value unchanged to `WixDirectAuthProvider.callbackUrl`. The provider uses the same value in both places that must agree:

- `auth.authRequest.redirectUri` sent to Wix Create Redirect Session.
- `redirectUri` sent during authorization-code exchange.

Login, immediate signup, signup OTP completion, and Google all use the same `createAuthorizationRedirect()` implementation and configured frontend callback URL. Email keeps query response mode while Google uses fragment response mode. The provider returns Wix's `redirectSession.fullUrl` without changing its embedded callback. There is no hardcoded Render callback and no callback fallback in application source.

The captured Render callback therefore proves that the deployed backend supplied the Render URL as `WIX_DIRECT_AUTH_CALLBACK_URL`, or was running older configuration/code equivalent to it. The repository cannot inspect the deployed Render environment in this audit.

## Root Cause And Fix

The first definite failure is callback-origin divergence. A callback performed on Render cannot create a host-only `cz_session` cookie for the Vercel Player Hub origin. A later Vercel `/api/auth/session` request therefore has no usable Vercel-origin session cookie and returns 401. The capture does not include the callback response or browser cookie store, so it cannot distinguish whether the callback failed before cookie creation or created a Render-host cookie; both are downstream of the proven wrong callback.

The previous environment guard checked callback and cookie safety only when `NODE_ENV === "production"`. Because `NODE_ENV` defaults to `development`, a hosted deployment with a missing or incorrect `NODE_ENV` could accept the stale Render callback. The guard now applies whenever `FRONTEND_ORIGIN` is a non-loopback HTTPS origin and requires the exact callback path, not merely the same origin. Localhost development remains configurable.

No CAPTCHA, Wix request payload, PKCE, canonical identity, password, session, logout, database, progression, or reward logic changed.

## Required Configuration

Render must use:

```text
NODE_ENV=production
FRONTEND_ORIGIN=https://circzles-player-hub.vercel.app
WIX_DIRECT_AUTH_CALLBACK_URL=https://circzles-player-hub.vercel.app/auth/callback
COOKIE_SECURE=true
SESSION_COOKIE_SAME_SITE=lax
SESSION_COOKIE_DOMAIN=
```

Wix Headless allowed authorization redirect URIs must include this exact URI:

`https://circzles-player-hub.vercel.app/auth/callback`

This matches Wix's official Headless login guidance: the `redirectUri` passed to Create Redirect Session must be listed as an allowed authorization redirect URI and must match exactly. The relevant Wix reference is [Add a Wix Login Page (REST)](https://dev.wix.com/docs/go-headless/authentication/members/wix-login-page/add-a-wix-login-page-rest).

Vercel must set server-only `PLAYER_HUB_API_ORIGIN=https://circzles-player-hub-api.onrender.com`. Production browser code deliberately uses relative `/api` URLs; it does not use Render as a browser API origin.

## Rewrite And Cookie Flow

`next.config.ts` rewrites `/api/:path*` to `${PLAYER_HUB_API_ORIGIN}/api/:path*`. This covers direct auth, callback completion, session, logout, `/api/me`, and all authenticated `/api` routes. Next.js defines rewrites as URL proxies that preserve the browser-visible URL. The frontend `/auth/callback` page is not proxied; it extracts Wix's fragment or query result and posts it to the proxied API callback. API paths receive `private, no-store, no-cache` headers.

The backend callback POST exchanges the code, validates the canonical Wix member identity, resolves the internal player, creates the backend session, and sets `cz_session` on its JSON response containing only a safe local `returnTo`. Production cookie policy is host-only (no `Domain`), `Path=/`, `HttpOnly`, `Secure`, and `SameSite=Lax`, with expiry matching the backend session. The callback-to-session integration test proves that this cookie authenticates `/api/auth/session` at the backend boundary. Repository tests and configuration cannot prove Vercel's live edge preserved `Set-Cookie`; that requires a deployed response capture.

## Flows Audited

- Email login: Login V2 success -> query-mode redirect to frontend callback -> backend callback POST -> Player Hub session -> `/hub`.
- Email signup: Register V2 immediate success or email verification challenge -> OTP verification -> query-mode frontend callback -> backend callback POST -> Player Hub session.
- Google: visitor token -> redirect session with Google IdP -> fragment-mode frontend callback -> backend callback POST -> Player Hub session.
- Session restore: first-party `/api/auth/session` forwards `cz_session` to Render; Render refreshes a valid session and returns the player identity.
- Logout: local identity clearing and backend `/api/auth/logout` behavior are unchanged; the backend clears the cookie before revocation and rejects the old session afterward.
- CAPTCHA: visible reCAPTCHA token shape and retry behavior are unchanged.
- Errors: exact Wix HTTP 404 with `-19999` remains `WIX_ACCOUNT_NOT_FOUND`; unknown provider failures remain generic.

## Safe Diagnostics

Existing opt-in session diagnostics report only request/session metadata such as request ID, cookie presence, cookie policy, request origin, API origin, and session status. They do not log credentials, CAPTCHA tokens, OAuth codes, state/session tokens, cookie values, authorization headers, request bodies, or email addresses.

## Automated Coverage

Regression coverage verifies:

- Hosted frontends reject Render-origin and wrong-path callbacks even if `NODE_ENV` is accidentally `development`.
- Email login, immediate signup, OTP continuation, and Google redirect creation all use the configured callback.
- Authorization-code exchange uses the identical callback.
- Production callback creates a secure, host-only cookie that authenticates the subsequent session endpoint.
- CAPTCHA forwarding, account-not-found mapping, Google identity verification, and logout remain covered.

Validation completed on this branch:

- Backend: 547 tests across 34 files passed.
- Backend lint, typecheck, and build passed.
- Root lint passed.
- Default Turbopack build reproduced the pre-existing `next/font` internal resolver failure (`@vercel/turbopack-next/internal/font/google/font`).
- Webpack production fallback build passed and generated all routes.
- Production config evaluation produced `/api/:path*` -> `https://circzles-player-hub-api.onrender.com/api/:path*` with private no-store headers.
- `git diff --check` passed.

## Remaining Production Verification

After correcting Render and Wix configuration and redeploying, capture the callback and verify:

1. The authorization URL contains the Vercel callback.
2. The browser callback request is to Vercel, not Render.
3. The callback response contains a host-only `cz_session` `Set-Cookie` and redirects to `/hub`.
4. The next first-party `/api/auth/session` request includes the cookie and returns HTTP 200.
5. Email login, new signup plus OTP, Google, logout, normal Chrome refresh, Incognito refresh, and direct mobile `/hub` work.
6. Mobile widths 320, 360, 390, 430, and 768 have no page-level overflow.

No claim of live production completion is made by this audit.
