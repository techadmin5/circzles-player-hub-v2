# Phase C2.5 - Email Auth Session and CAPTCHA Reliability

## Status

Implemented and locally automated-tested on `phase-c2-5-email-auth-session-reliability`. Deployment configuration and real normal/incognito/mobile authentication remain controlled post-deploy verification. This phase changes no database schema, migration, identity authority, PKCE validation, canonical Wix member verification, CAPTCHA requirement, or gameplay logic.

## Incognito Reproduction and Root Cause

The reported production sequence was: email authentication completed, `/hub` appeared briefly, then session bootstrap returned the user to `/login` in Chrome Incognito. Before this phase the browser called `https://circzles-player-hub-api.onrender.com/api/*` from `https://circzles-player-hub.vercel.app`. The backend cookie was therefore stored and sent in a cross-site/third-party context. `credentials: "include"` requests a cookie but cannot override browser third-party-cookie blocking.

This architecture and the normal-versus-incognito behavior strongly identify cross-site cookie storage as the failure mode. This offline implementation run did not access the deployment, so it did not capture live DevTools headers and does not claim a completed normal/incognito proof. The optional safe diagnostics below exist for that final confirmation.

## Same-Origin API Proxy

Production `apiBaseUrl` is now the empty same-origin prefix, so every existing client path remains browser-visible as `/api/...`. `next.config.ts` rewrites:

```text
https://circzles-player-hub.vercel.app/api/:path*
  -> https://circzles-player-hub-api.onrender.com/api/:path*
```

The Render origin comes from server-only `PLAYER_HUB_API_ORIGIN`. `NEXT_PUBLIC_API_BASE_URL` remains supported only for local development such as `http://localhost:4000`. A temporary server-side fallback reads the legacy public variable during deployment transition, but production client code ignores it. Remove the public production variable after `PLAYER_HUB_API_ORIGIN` is configured.

All `/api/*` responses receive `Cache-Control: private, no-store, no-cache, max-age=0, must-revalidate` and `Pragma: no-cache`. Session-bearing responses must not be cached by Vercel/CDN infrastructure.

## Callback and Cookie Chain

The exact public callback is:

```text
https://circzles-player-hub.vercel.app/api/auth/direct/google/callback
```

It must be identical in Render's `WIX_DIRECT_AUTH_CALLBACK_URL`, the Create Redirect Session request, and the Wix Headless allowed redirect URI. Vercel proxies it to Render's `/api/auth/direct/google/callback`. The response is browser-visible as Vercel, so its host-only cookie belongs to the Player Hub origin.

Production environment validation now requires:

- `HttpOnly=true` (fixed by server code)
- `COOKIE_SECURE=true`
- `SESSION_COOKIE_SAME_SITE=lax`
- `SESSION_COOKIE_DOMAIN` unset/blank
- `Path=/` (fixed by server code)
- callback origin equal to `FRONTEND_ORIGIN`

An automated HTTP test completes callback -> `Set-Cookie` -> `/api/auth/session`, verifies `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`, and confirms the session remains authenticated.

## Safe Cookie Diagnostics

Set `AUTH_SESSION_DIAGNOSTICS=true` temporarily on Render to log only:

- request ID (provided by the request logger)
- `cookiePresent` boolean
- `cookieDomain` (`host-only` in production)
- `sameSite`
- `secure`
- `httpOnly`
- `sessionStatus`
- parsed `requestOrigin`
- parsed `apiOrigin`

The diagnostic never logs a cookie value, session token, Wix token/state, password, CAPTCHA token, authorization header, or request body. Disable the flag after normal/incognito verification.

## CAPTCHA Retry Lifecycle

Login and signup still require a real Wix Enterprise reCAPTCHA token before submission. Once a request is sent, every failed provider/API attempt now clears only the CAPTCHA token, resets the widget, increments its reset key, and keeps all entered form fields and the provider-specific message. This prevents replay of a consumed token when the user corrects only an email or password.

Browser-side validation and attempts made before a token exists do not reset the widget. `REQUIRE_EMAIL_VERIFICATION` is a successful transition to OTP entry and is not treated as a failed attempt. Expiry clears the token, resets the widget, disables submit, and displays `Security verification expired. Please try again.`

## Provider Error Mapping

- Exact Login HTTP `404` plus provider code `-19999` remains `WIX_ACCOUNT_NOT_FOUND`.
- Nested or wrapped `invalidPassword` / `INVALID_PASSWORD` remains `WIX_INCORRECT_PASSWORD`.
- `-19971` remains the exact observed missing-CAPTCHA condition.
- Invalid/expired CAPTCHA remains `WIX_CAPTCHA_INVALID`.
- Known reset-password, existing-account, invalid-email, and owner-approval mappings remain unchanged.

The wrong-password marker exercised by automated tests is `invalidPassword`/`INVALID_PASSWORD`. No live wrong-password request was made in this phase, so no additional numeric provider code is claimed. Diagnostics remain limited to operation, state, safe error code, and status.

## Regression Matrix

| Scenario | Automated result | Live status |
| --- | --- | --- |
| Login success and nested email session token | Existing adapter tests pass | Deployment verification required |
| Signup `SUCCESS` | Existing adapter tests pass | Deployment verification required |
| Signup email verification -> redirect | Existing adapter tests pass | Reported flow reached OTP; final deployed retest required |
| Wrong password | Specific mapping tested | Live provider code not observed in this phase |
| Account not found `404/-19999` | Specific mapping tested | Previously observed |
| CAPTCHA required/invalid/expired | Adapter behavior tested; frontend build validates integration | Browser widget retest required |
| Correct email/password after failure | Form preserves inputs and resets CAPTCHA in code | Browser interaction retest required |
| Callback -> cookie -> session | Full fake-provider HTTP chain passes | Normal/incognito retest required |
| Google | Adapter regression tests preserve token-free Google redirect | Live retest required after callback change |
| Logout | Session revocation and stale-cookie tests pass | Live refresh retest required |
| Mobile 320/360/390/430/768 | Existing responsive code compiles | Real browser viewport retest required |

## Deployment Configuration

### Vercel

```text
NEXT_PUBLIC_DATA_MODE=api
PLAYER_HUB_API_ORIGIN=https://circzles-player-hub-api.onrender.com
```

Remove the production `NEXT_PUBLIC_API_BASE_URL` after the server-only rewrite variable is active. Development may continue using `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`.

### Render

```text
FRONTEND_ORIGIN=https://circzles-player-hub.vercel.app
COOKIE_SECURE=true
SESSION_COOKIE_SAME_SITE=lax
SESSION_COOKIE_DOMAIN=
WIX_DIRECT_AUTH_CALLBACK_URL=https://circzles-player-hub.vercel.app/api/auth/direct/google/callback
AUTH_SESSION_DIAGNOSTICS=false
```

Enable `AUTH_SESSION_DIAGNOSTICS` only for the controlled cookie check. No cookie value is logged.

### Wix Headless

Register exactly:

```text
https://circzles-player-hub.vercel.app/api/auth/direct/google/callback
```

Repository changes cannot update the Wix dashboard. Coordinate Wix allowed-URI configuration, Render environment changes, and the Vercel deployment before exercising email or Google authentication. Do not deploy the backend production validation while it still has the old Render callback or cross-site cookie settings.

## Security

The proxy does not trust frontend identity and does not terminate Player Hub authorization. Render remains authoritative for sessions and all protected APIs. CAPTCHA, PKCE, sealed state, exact callback validation, canonical verified-member lookup, HttpOnly cookies, database session revocation, and safe return paths remain intact. Partitioned cookies and `SameSite=None` are not used as the primary solution.
