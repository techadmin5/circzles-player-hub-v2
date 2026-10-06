# Native Player Hub authentication

Implemented on `refactor/native-player-hub-auth`. Player Hub is the permanent authentication authority. Wix remains a business integration. No deployment or production credential changes were performed.

## Identity and migration

`users.user_id` remains the internal account, with exactly one `players` record. Google subjects and password credentials attach to that account. Existing player IDs and gameplay records are not rewritten.

Email normalization is trim + lowercase, without Gmail-specific dot/plus transformations. New signup stores a pending account claim in `auth_challenges`, including only an Argon2id password hash. It allocates no internal user or player until email ownership is verified. Verification attaches the credential to an existing verified email owner or creates one account. A signup never overwrites an existing password. Google-only users must sign in and use Account security; signup/verification cannot bypass that session requirement, including when a pending signup predates Google creation. Existing users who have a password use login/reset; legacy Wix users without a native password can sign up with their existing email and verify to claim the same player.

Google resolution checks `(GOOGLE, sub)` first, then the normalized **verified** internal email. Existing provider subjects remain attached to the same account if Google's email changes; this does not automatically change the account's email. Unverified or unavailable existing owners cause a conflict rather than an unsafe merge. Email/subject advisory locks, user locks, transactions and unique indexes protect overlapping claims.

Historical commit `774b49daf46d3fccc45665b682b57c4cadf39c11`, current local `main` (`a6f87c3`), and the starting branch (`a8a283f`) were inspected. Migration `0019` added verified-email fields without backfilling older players. **Run `docs/native-auth-preflight.sql` against production before rollout. All queries must return zero rows.** Missing verified emails must be recovered using audited ownership evidence. Do not assume that a Wix member ID is a Google subject, trust unverified email input, merge users automatically, or delete historical players. The production database has not been audited in this work.

Drizzle migration `backend/drizzle/0020_bumpy_wind_dancer.sql` is additive:

- `auth_identities`: Google provider/subject, account foreign key, provider email; unique provider + subject.
- `password_credentials`: one Argon2id credential per existing user, change timestamp.
- `auth_challenges`: shared verification/reset/first-password challenge table with purpose constraints, SHA-256 token hash, expiry, consumed timestamp, optional pending password hash and session binding. Separate tables would duplicate this lifecycle.
- `google_auth_states`: hashed state and browser binding, server-side PKCE verifier, nonce, local return destination and expiry.
- `auth_rate_limits`: hashed scopes and atomic attempt counters shared across instances.
- `users_normalized_email_unique`: unique index on `lower(btrim(verified_email))`. Existing email values remain intact.

The migration refuses to proceed while any active historical user lacks verified email ownership. The normalized unique index also refuses case/whitespace duplicates. Resolve these conditions before deployment using reviewed evidence. Drizzle snapshot and journal are checked in. PostgreSQL tests apply every actual SQL migration, seed an existing player before `0020`, check the guard, and verify that the migration preserves user and player rows.

## API and session behavior

All JSON mutations use POST and JSON bodies:

| Route | Body/result |
| --- | --- |
| `/api/auth/email/signup` | `{displayName,email,password}` → 202 verification message |
| `/api/auth/email/verify` | `{token}` → existing player API response + session |
| `/api/auth/email/login` | `{email,password}` → existing player API response + session |
| `/api/auth/password/forgot` | `{email}` → generic `{ok:true}` |
| `/api/auth/password/reset` | `{token,password}` → `{ok:true}`; all old sessions revoked; login required |
| `/api/auth/password/request-set` | authenticated session → email challenge |
| `/api/auth/password/set` | `{token,password}` + original live session → same player + fresh session |
| `/api/auth/security` (GET) | authenticated session → email and `hasPassword` |
| `/api/auth/google/start` (GET) | optional local `returnTo` → Google authorization URL + binding cookie |
| `/api/auth/google/callback` (GET) | Google code/state → server exchange, native session, local redirect |
| `/api/auth/session` (GET) | existing lightweight session identity API |
| `/api/auth/logout` | existing revocation and cookie deletion |

Passwords require 12–256 characters; login accepts existing password input without revealing account existence. Argon2id uses 64 MiB, three iterations and one lane. Wrong password and incomplete verification share a generic login error. Forgot-password responses remain identical for missing, Google-only, known and mail-provider-failure cases, including per-email throttling.

Google uses Authorization Code + S256 PKCE, nonce, browser-bound single-use PostgreSQL state (10 minutes), server-only client secret, and JOSE verification against Google's signing keys. Verification checks RS256, issuer, audience, expiry, issue time, nonce, stable `sub`, `email_verified === true` and authorized-party claim when supplied. Browser identity claims are never accepted. Provider failure returns to login with a generic message.

Verification links expire after 60 minutes. Reset and first-password links expire after 15 minutes. Tokens are 256-bit random values, stored only as hashes. Links carry tokens in fragments, which the client moves into memory and immediately removes from browser history; submission requires an explicit button click. No auth secrets or tokens enter localStorage. Challenges are transactionally single-use. Issuing another challenge of the same purpose supersedes prior challenges. Credential changes consume other outstanding challenges and revoke all old sessions.

Setting a first password requires both an authenticated session and proof of email ownership. The challenge is bound to that exact session token and account; an expired/revoked/different session cannot complete it. Subsequent Google and password login both retain the same Player ID. A second password setup cannot replace an existing credential.

The existing `cz_session` cookie/server session mechanism remains in use: 20-day TTL, daily sliding renewal, HttpOnly, Secure in production, SameSite=Lax, host-only, server-side revocation. Successful authentication rotates the session. Password-session issuance locks the user and rechecks the credential hash so a password verified before a concurrent reset cannot issue a session afterward. Already issued historical sessions remain valid until expiry/revocation or their next renewal.

Rate limits use PostgreSQL, per 15-minute bucket: 100 auth requests/client IP, 15 login attempts/email, five signup/reset deliveries/email and five first-password requests/user. The Vercel proxy strips browser trust headers, sends its server-only secret, and forwards Vercel's overwritten client IP. Render requires that secret for production auth; unauthenticated direct calls cannot forge IP buckets. Cross-origin browser mutations are rejected. Only validated local return paths are allowed. Backend request logs omit query strings and bodies; provider errors omit upstream payloads; proxy logs omit secrets. Expired challenge/state/rate-limit records are pruned hourly.

## Configuration

Render server environment:

| Variable | Required configuration |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth web application client |
| `GOOGLE_CLIENT_SECRET` | Server secret for that client |
| `GOOGLE_AUTH_CALLBACK_URL` | Exact frontend callback below; all three Google settings configured together |
| `AUTH_EMAIL_PROVIDER` | `resend` in production |
| `RESEND_API_KEY` | Resend API key supplied through environment secrets |
| `AUTH_EMAIL_FROM` | Sender on a verified Resend domain, e.g. `CircZles <auth@your-verified-domain>` |
| `PLAYER_HUB_PROXY_SECRET` | Random value of at least 32 characters, same on Vercel and Render |
| `FRONTEND_ORIGIN` | `https://circzles-player-hub.vercel.app` |
| `COOKIE_SECURE` / `SESSION_COOKIE_SAME_SITE` / `SESSION_COOKIE_DOMAIN` | `true` / `lax` / unset |
| `SESSION_SECRET` / `DATABASE_URL` | Keep existing production values |

Vercel server environment: retain `PLAYER_HUB_API_ORIGIN` pointing to Render; add the same `PLAYER_HUB_PROXY_SECRET`. Keep `NEXT_PUBLIC_DATA_MODE=api` and `NEXT_PUBLIC_DEV_AUTO_LOGIN=false`. Google and email secrets belong only on Render and must not be prefixed `NEXT_PUBLIC_`. The proxy secret is also server-only. No actual secret values are included in this change.

Google Cloud Console **Authorized redirect URI**:

`https://circzles-player-hub.vercel.app/api/auth/google/callback`

Create/use a Web application OAuth client, configure the consent screen and its test/publishing audience, and register the exact URI above. For local work separately register `http://localhost:3000/api/auth/google/callback` and configure both frontend origin and callback to match. The existing Next catch-all API route forwards callback query and cookies to Render and preserves the 302 plus both Set-Cookie headers.

Production email requires a verified sender domain in Resend, valid sending credentials and working delivery. Production startup refuses development/no email configuration or a missing proxy secret. `DevelopmentAuthMailer` is an injectable, bounded, memory-only mailbox for local tests/debugging. It never logs tokens, exposes a public mailbox, or delivers mail; inspect its `messages` in a local debugger or use the automated tests. Use Resend in a development/staging environment for a real browser email smoke test. Restarts discard the development mailbox.

## Wix retirement

`server.ts` no longer constructs Wix direct auth or reads Wix login client/callback settings. Wix hosted login, redirect sessions, Google IDP, email login/register/verify and provider CAPTCHA are absent from the active frontend/native runtime. Obsolete callback and CAPTCHA components were removed; `/auth/callback` redirects to `/login`. Native runtime `/api/auth/direct/*` returns 410.

Historical Wix provider code and injected legacy HTTP contracts remain explicitly marked legacy for regression tests. The old handoff templates and tests remain intact, but native-runtime `/api/auth/handoff/exchange` returns 410 with a direct-login message. The existing handoff page offers a login link on failure. Retained code is not an alternate production login authority.

Update published Wix “Enter Hub” buttons on both websites to navigate directly to:

`https://circzles-player-hub.vercel.app/login`

Use `/signup` for an explicitly labeled signup button. Stop requesting a Wix SSO handoff. Wix coupon gateways, reward/store integrations, commerce webhook routing and business app OAuth remain intact and their regression tests pass. Do not remove business Wix app IDs/secrets/instance IDs when retiring login variables.

## Validation and changed files

Backend: `npm test` **654/654 passed**, 37 files; `npm run lint`, `npm run typecheck`, `npm run build` **exit 0**. Frontend: `npm test` **53/53 passed**; `npm run lint`, `npm run build` **exit 0**. Test commands were run via `npm.cmd` on Windows. Existing handoff tests remain intact. The native suite covers email signup/duplicates, verification/reset expiry and replay, wrong/unverified login, generic forgot responses, Google state/browser binding/code exchange/claims/provider failures, signed JWT verification, verified legacy linking, concurrency, same-player first password, session TTL/renewal/logout/revocation and stale password issuance. Embedded PostgreSQL tests use PGlite; they do not validate distributed production infrastructure or real Google/mail delivery.

Browser visual QA was attempted using a local Next preview with auto-login disabled; the browser-control tool timed out. No visual verification or production authentication success is claimed. The local preview was stopped.

Changed files by area:

- Native domain: `backend/src/domain/{authSecurity,authEmail,nativeAuth,nativeAuthRepository,googleAuth}.ts`; existing `identity.ts` for session guards/TTL and shared player mapping.
- Schema/migration: `backend/src/db/schema.ts`, `backend/drizzle/0020_bumpy_wind_dancer.sql`, `backend/drizzle/meta/{0020_snapshot,_journal}.json`.
- Runtime/API: `backend/src/http/{app,nativeAuthRoutes}.ts`, `backend/src/server.ts`, `backend/src/config/env.ts`; legacy annotation in `backend/src/integrations/wix/wixDirectAuth.ts`.
- Dependencies: backend package manifest and lockfile (Argon2, JOSE, test-only PGlite).
- Backend tests: new `nativeAuth.test.ts`, extended `http.test.ts`, native configuration expectations in `env.test.ts`, 20-day renewal expectation in `identity.test.ts`.
- Frontend forms: new `NativeAuthForm.tsx` and `SecurityPanel.tsx`, login/signup wrappers, settings security section; removed `WixCaptcha.tsx` and `WixAuthorizationCallback.tsx`.
- Frontend pages: login/signup copy, retired callback, new verify/forgot-password/reset-password/set-password pages.
- Transport: `src/lib/apiClient.ts`, `src/lib/server/apiProxy.ts` and proxy tests.
- Configuration/docs: both `.env.example` files, this runbook, the read-only preflight SQL and legacy handoff README notice. Existing architecture docs link to this authoritative replacement.

## Deployment and rollback

1. Snapshot PostgreSQL and audit preflight results. Resolve missing ownership/conflicts with reviewed evidence; compare existing player IDs and gameplay counts. Do not proceed while any query returns rows.
2. Configure Google Cloud and Resend, the Render server variables, and the shared Vercel/Render proxy secret. First deploy the proxy trust-header change while the old backend still serves traffic; it ignores these extra headers. Do not activate new login forms until the native backend is ready.
3. Pause new login/signup briefly for coordinated rollout; existing sessions continue. Run `npm ci` and `npm run db:migrate` from `backend` using the production database only through the approved deployment environment. Never use seed/dev against production. Install the lockfile normally; verify Argon2's prebuilt binary works on the Render runtime before switching traffic.
4. Deploy the native backend, then the frontend. Preserve Wix business configuration and the existing session secret. Change published Wix button destinations. Verify `/health`, existing session access and coupon/business webhook behavior.
5. Perform a **real** email signup → delivered email → verification → Hub flow and real Google login through the exact Vercel callback. Test a verified legacy player via both credential claims and Google linking, compare the original Player ID and gameplay data, then test Google-only → Set password → emailed challenge → password login → Google login with the same Player ID. Confirm cookie flags, logout, reset revocation and expiry/renewal. These remain required release checks.

Rollback is an application rollback, not a destructive database downgrade. Keep `0020`, credentials, users and player/gameplay rows. If frontend rollout fails, roll back that deployment while fixing the native backend. If the native service itself fails, use maintenance/login-unavailable messaging while rolling back the faulty native application version; do not silently re-enable Wix as permanent auth. A pre-native application rollback may read the additive schema and serve existing sessions, but native-only users will need native login restored. Keep the database snapshot as disaster recovery only: restoring it after new gameplay activity would discard that activity. Never drop native tables or revert user identities to make an old binary start.

Protocol references: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect) and [Vercel request headers](https://vercel.com/docs/headers/request-headers).
