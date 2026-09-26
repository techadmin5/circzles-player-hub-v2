# Phase C2.3 - Production Stability Audit

## Status

Implemented and locally validated on `phase-c2-3-production-stability-audit`. No schema or migration change is part of this phase.

## Authentication Findings

### Email CAPTCHA

Root cause: the backend already accepted Wix `captchaTokens` and failed closed when Wix required a challenge, but the custom login and signup forms had no way to load an Enterprise reCAPTCHA, obtain a real token, or retry with that token.

Resolution:

- A shared `WixCaptcha` client component loads Google's Enterprise reCAPTCHA script only after Wix returns `WIX_CAPTCHA_REQUIRED`.
- It uses Wix's documented public visible site key and compact dark widget.
- Login and signup preserve the form, require a completed challenge, and send the real token as `RECAPTCHA` through the existing backend contract.
- Expired, failed, and rejected challenges clear/reset the token. No token is fabricated and no provider error payload is exposed.
- Email verification remains mandatory for signup. Google OAuth is unchanged.

Official Wix references:

- https://dev.wix.com/docs/go-headless/authentication/members/custom-login-page/re-captcha/add-re-captcha-to-a-custom-login-page-rest
- https://dev.wix.com/docs/go-headless/authentication/members/custom-login-page/build-a-custom-login-page-rest

### Logout

Root cause: `AuthProvider.logout()` waited for the backend before clearing client state, and `GameShell` waited for that promise before navigation. An in-flight session check could also restore authenticated state after logout.

Resolution:

- Local identity, gameplay profile, and UI stores clear synchronously.
- Session/profile requests are invalidated and the session request is aborted.
- Navigation to `/login` starts immediately while backend revocation continues.
- Backend logout still revokes the authoritative session. The cookie-clear header is prepared before revocation so a backend error can still remove the browser credential when Fastify sends the error response.

### Session Restore

- `/hub` remains in the checking state until authoritative `/api/auth/session` resolution.
- Authenticated sessions render the requested route; an authoritative 401 redirects to `/login?returnTo=<safe-local-path>`.
- Session checks are coalesced, cancellable, and capped at 20 seconds for Render cold starts.
- Non-401 failures show a retryable session-unavailable view. They do not trigger Google OAuth or silently become unauthenticated.
- Backend return paths now reject backslashes as well as protocol-relative paths.

## Mobile Findings

The Hub layout uses `min-w-0`, responsive grids, clipped page-level horizontal overflow, compact leaderboard rows, and fixed mobile navigation. Headless Chrome device emulation at 320, 360, 390, 430, and 768 pixels confirmed `documentElement.scrollWidth` and `body.scrollWidth` exactly matched `innerWidth` at every size. The 320 and 430 pixel renders remained usable with controlled label truncation and no page-level horizontal overflow.

The remaining authentication risk is deployment topology. `circzles-player-hub.vercel.app` calling an `onrender.com` API is cross-site. Production must use `Secure` cookies and an appropriate `SameSite` policy, but mobile privacy controls may still reject third-party cookies. The durable public-production setup is same-site custom domains such as `dashboard.circzles.in` and an API host under `circzles.in`, or a separately reviewed same-origin BFF/callback design. Browser storage must not become session authority.

Until that domain topology is verified on real iOS Safari and Android Chrome, cross-site mobile session persistence remains a launch risk rather than a code-level issue that should be hidden by insecure fallback behavior.

## Route Audit

| Route | Auth/data state | Finding |
| --- | --- | --- |
| `/` | Public/static | No authenticated data dependency. |
| `/login` | Wix direct auth | Google and email choices remain explicit; no automatic OAuth restart. CAPTCHA challenge is now actionable. |
| `/signup` | Wix direct auth | Google and verified-email signup remain available; CAPTCHA challenge is now actionable. |
| `/hub` | Protected/real API | Session skeleton, authoritative identity, API-backed missions, puzzles, leaderboard, and wheel status. No page-level overflow found. |
| `/profile` | Protected/mixed | Authenticated profile and owned puzzles are real in API mode. Avatar upload remains deferred; fallback avatar is consistent. |
| `/settings` | Protected/local | Sound and reduced-motion settings persist locally. Server profile/settings persistence is not implemented. |
| `/rewards` | Protected/real API | Store and wheel use backend APIs in API mode. |
| `/leaderboard` | Protected/real API | Catalog, rankings, and public profile lookup use backend APIs. |
| `/missions` | Protected/real API | Mission list and claim use backend APIs. |
| `/puzzles` | Protected/real API | Ownership list, detail lookup, and claim-by-code use backend APIs. |
| `/admin/*` | Disabled in API mode | Server-side admin authorization is still required before any production admin UI can be enabled. |

## Data And UI Findings

- Production builds require API mode; mock identity cannot silently ship.
- Production navigation hides mock-only activity, friends, notifications, seasons, achievements, coupons screen, chat, and admin tools.
- The default avatar is consistently `/brand/avatar.svg` when no authoritative avatar exists.
- Avatar upload/selection persistence is not implemented. A future phase needs an authenticated avatar update API, owned-avatar validation, durable storage/reference handling, and `/api/me` refresh.
- Settings sound preferences are browser-local, not account-synchronized.
- Admin authorization remains a launch blocker for exposing admin routes; frontend hiding alone is not authority.
- No missing imported assets or build-time image failures were found.
- Local browser diagnostics reported non-blocking LCP hints for above-fold profile/rank images and an accessibility warning for continuously running Lottie animation. Reduced-motion support exists, but a future accessibility pass should review a user-visible pause mechanism for long-running decorative animation.

## Security Findings

- Protected production routes remain under `AuthenticatedRoute` and backend APIs derive player identity from the HttpOnly session.
- CAPTCHA is provider-issued and validated by Wix; Player Hub does not bypass it.
- Passwords, CAPTCHA tokens, OAuth codes, session tokens, and provider payloads are not logged by the new UI.
- Session authority remains server-side. Logout still calls the backend revocation endpoint.
- Return paths are constrained to local application paths on both frontend and backend.
- Admin remains unavailable in API mode pending server-authoritative role enforcement.

## Tests

Backend coverage verifies:

- successful email login and forwarding of a visible Wix CAPTCHA token;
- invalid credentials remain a controlled 401 without provider-data leakage;
- signup email-verification flow;
- controlled CAPTCHA-required behavior for login and signup;
- unsafe backslash return paths resolve to `/hub`;
- session creation, restore, logout revocation, and cookie clearing.

Frontend validation relies on TypeScript/build validation plus local route and responsive inspection because this repository does not currently include a frontend component-test runner.

## Remaining Risks

1. Verify production cookie attributes and same-site custom-domain topology in the deployed environment.
2. Run real-device direct `/hub` checks on iOS Safari and Android Chrome after the custom domains are active.
3. Live-test Wix CAPTCHA-required login and signup after deployment; local automation does not call Wix or Google.
4. Add frontend component/e2e infrastructure for auth race, CAPTCHA challenge, and responsive regression coverage.
5. Keep admin routes disabled until backend role authorization and the planned stronger admin authentication are complete.

## Validation

- Root lint and production build
- Backend full suite: 522 tests across 34 files; lint, typecheck, and build
- `git diff --check`
- Headless Chrome responsive inspection at 320, 360, 390, 430, and 768 pixels with zero measured page overflow
