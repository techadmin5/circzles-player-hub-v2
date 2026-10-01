# Restore the C2.3 Google callback architecture

## Regression audit

Compared `b11a6e775835b80868987de5a095cdb8bdfc9d72` (C2.3) directly with current main `5c86c27`.

| Behavior | C2.3 | Main before this fix | This branch |
| --- | --- | --- | --- |
| Google response mode | query | fragment | query |
| Google callback path | /api/auth/direct/google/callback | /auth/callback | /api/auth/direct/google/callback |
| Google completion | backend GET, cookie, redirect | frontend fragment parsing, backend POST, client navigation | backend GET, cookie, redirect |
| Email completion | shared backend callback | frontend query callback + POST | existing frontend query callback + POST |
| Production API transport | earlier transport | controlled same-origin Node proxy | controlled proxy preserved |

Commit `fdab6de41514b25ff5056a6699c4e6ae4741f4d2` changed `responseMode: "query"` to `input.flow === "GOOGLE" ? "fragment" : "query"` and changed production callback validation from `/api/auth/direct/google/callback` to `/auth/callback`. It also introduced the frontend callback parser and POST endpoint. The previous GET implementation was retained, with its identity/session work extracted into `completeDirectAuthorization`; its successful semantics still match C2.3.

The reported production sequence is authorization-start 200, valid Wix authorization URL, then immediate `unknown_error` fragment without a Google chooser; POST completion maps that error to `WIX_AUTHORIZATION_FAILED`. This was reported for two clients. The code regression is exact and reproducible from Git history, but whether it causes Wix's live error is not established until a live test succeeds. Client IDs and provider configuration are not changed.

Other C2.3-to-main changes include email CAPTCHA formatting, provider field normalization, verification challenges, sessionToken placement, and error classification. Those email fixes remain intact. No repository rollback was performed.

## Implementation and flow

The adapter now requests query mode and selects its callback by flow. `callbackUrl` remains the Google URL from `WIX_DIRECT_AUTH_CALLBACK_URL`. `server.ts` supplies `emailCallbackUrl` from `new URL("/auth/callback", FRONTEND_ORIGIN)`. Both authorization creation and token exchange use the same selector; exchange reads the flow only after authenticating the sealed state. No new environment variable is necessary.

Google: browser `/api/auth/direct/google/start` -> Wix/Google -> frontend-origin `/api/auth/direct/google/callback?code=...&state=...` -> preserved Node proxy -> existing Render GET handler -> state validation and PKCE exchange -> verified Wix member -> identity/session -> `cz_session` -> 302 to frontend `/hub` (or the validated local destination).

Email: Login/Register/Verify -> query-mode `/auth/callback` -> existing frontend parser -> same-origin POST completion -> session cookie and safe client navigation. The page, parser, POST endpoint, and email fixes remain present.

PKCE S256, AES-GCM sealed state, expiry checks, safe returnTo, canonical verified member lookup, and session creation remain unchanged. The backend continues enforcing host-only HttpOnly Secure SameSite=Lax production cookies. Wix access and refresh tokens remain server-side.

## Proxy review

No proxy implementation change was needed. The existing handler preserves callback query, status, Location, and individual Set-Cookie values with `redirect: "manual"`. It already excludes this GET callback from retries because it consumes a one-use code. A real local HTTP regression test verifies a 302 callback is returned with its cookies and Location and exactly one upstream request.

## Files changed

- `backend/src/integrations/wix/wixDirectAuth.ts`: query-mode Google and flow-specific callback selection.
- `backend/src/config/env.ts`: exact frontend-origin Google GET callback validation.
- `backend/src/server.ts`: retain the separate email callback URI.
- `backend/.env.example`: Google callback setting and email derivation notes.
- `backend/tests/wixDirectAuth.test.ts`, `backend/tests/env.test.ts`, `backend/tests/http.test.ts`: provider, configuration, malformed GET, and session/cookie regression coverage.
- `src/lib/server/apiProxy.test.mjs`: real callback 302/cookie forwarding test.
- `docs/AUTHENTICATION_DESIGN.md`, `docs/API_CONTRACTS.md`, `docs/BACKEND_ARCHITECTURE.md`, and this report: current architecture and deployment instructions.

## Required Wix URIs and Render environment

Register/retain both redirect URIs on the existing Wix Headless client:

```text
https://circzles-player-hub.vercel.app/api/auth/direct/google/callback
https://circzles-player-hub.vercel.app/auth/callback
```

The first is Google; the second remains email. Keep the existing client ID and Google connection/provider settings.

Render settings for the new backend release:

```dotenv
WIX_DIRECT_AUTH_CALLBACK_URL=https://circzles-player-hub.vercel.app/api/auth/direct/google/callback
FRONTEND_ORIGIN=https://circzles-player-hub.vercel.app
NODE_ENV=production
COOKIE_SECURE=true
SESSION_COOKIE_SAME_SITE=lax
SESSION_COOKIE_DOMAIN=
```

Keep `WIX_CLIENT_ID`, `SESSION_SECRET`, database credentials, and other existing secrets unchanged. No new email environment variable is required. Vercel retains `PLAYER_HUB_API_ORIGIN=https://circzles-player-hub-api.onrender.com` and `NEXT_PUBLIC_DATA_MODE=api`.

## Deployment order and risks

1. Review this branch; the task commits/pushes it without merging or changing live configuration.
2. Confirm both exact Wix callback URIs are registered before enabling the new backend. Retain the email URI.
3. Keep the working Vercel proxy and frontend email callback deployed. This branch needs no frontend behavior change.
4. Coordinate the Render backend release with the Google callback environment change. Old code rejects the new URI and new code rejects the old URI in hosted production: do not restart either version with the other's configuration. If the deployment workflow cannot stage both together, plan a brief maintenance window.
5. Start a fresh Google attempt after deployment. Confirm query-mode authorization, Google UI, backend GET callback, 302/cookie response, then authenticated `/api/auth/session`. Do not copy authorization codes, state, cookies, or tokens into reports. Verify email login/signup separately.
6. If rollback is required, restore the prior backend and its old callback environment value together; keep both Wix URIs registered.

Google attempts started before the deployment can fail exchange because their codes were issued for the old URI; restart login. Email retains its existing URI, sealed flow, and session secret. Query callbacks can appear in infrastructure access logs (as in the earlier architecture); restrict access and avoid sharing raw callback URLs. Render availability and Wix-side issues remain independent possible failures. No live Google login was performed and production success is not claimed.

## Verification

Frontend: 45 tests passed, including existing callback tests and real HTTP proxy coverage. Backend: 565 tests across 34 files passed, including current email tests, query-mode Google creation/exchange, tampered/expired state, missing code/state, session creation, cookie flags, and redirect/session follow-up. Lint, typecheck, frontend production build, backend build, and diff whitespace checks are recorded with the final delivery.
