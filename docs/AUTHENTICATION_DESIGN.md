# Authentication Design

## Authority Model

CircZles has one Player Hub identity system. `circzles.com`, `circzles.in`, direct email login, and Google login resolve a server-verified external identity to one internal `users` row and one immutable `players.player_id`. All game state remains owned by `player_id`; email, Wix member IDs, public player IDs, and browser input are never gameplay authority.

`circzles.com` is the canonical authority for direct Player Hub signup and login. A user may also have a separate `circzles.in` Wix member identity linked to the same user. Links are unique by `(source_site, wix_member_id)`, not globally by member ID and not one-per-user.

## Website Handoff

The two Wix sites must create a server-side signed, short-lived, one-time handoff. The browser receives only the signed handoff and posts it to `POST /api/auth/handoff/exchange`; it cannot select a member, user, or player ID.

The compact handoff format is `base64url(header).base64url(payload).base64url(HMAC-SHA256 signature)`.

Header:

```json
{ "alg": "HS256", "typ": "CZ-HANDOFF" }
```

Required payload claims:

- `v`: `1`
- `iss`: `circzles.com` or `circzles.in`
- `aud`: `circzles-player-hub`
- `sub`: server-verified Wix member ID
- `jti`: unpredictable unique token ID
- `iat` and `exp`: integer Unix timestamps; lifetime cannot exceed five minutes
- `email`: server-verified email
- `emailVerified`: `true`
- `provider`: `WIX`, `EMAIL`, `GOOGLE`, or `FACEBOOK`
- optional safe profile fields: `displayName`, `firstName`, `lastName`, `avatarUrl`

Each site uses its own handoff secret. The frontend landing URL should place the handoff in the URL fragment so it is not sent in HTTP requests or referrers:

```text
https://PLAYER_HUB_HOST/auth/handoff#handoff=SIGNED_VALUE
```

The landing component removes the fragment before exchange. The backend validates signature, issuer, audience, lifetime, verified-email assertion, and one-time `jti` use before resolving identity.

## Account Linking

1. An existing `(source_site, external identity)` always resolves its current user.
2. Its verified email must continue to agree with that user.
3. A new external identity may link to an existing user only through the same normalized, provider-verified email.
4. Unverified email is rejected.
5. Conflicting identity or email ownership returns a controlled conflict; accounts are never silently merged.
6. Concurrent first entry is constrained by unique verified-email and source/member indexes.

Existing pre-migration Wix links default to `CIRCZLES_COM`. Development must inspect any historical links before applying migration `0019_glossy_polaris.sql` and correct the migration plan if that assumption is false.

## Direct Authentication

The production `WixDirectAuthProvider` uses the canonical `circzles.com` Wix Headless OAuth client for:

- Email login through Authentication API Login V2.
- Email signup through Register V2 follows Wix's returned state. `SUCCESS` continues directly through the PKCE authorization redirect, while `REQUIRE_EMAIL_VERIFICATION` is completed through Verify During Authentication before entering that same redirect path. `REQUIRE_OWNER_APPROVAL` remains pending and creates no Player Hub session.
- Google login through a Wix Redirect Session using Wix's Google connection ID.
- A common OAuth 2.0 authorization-code callback with PKCE, followed by `GET /members/v1/members/my`.

Login, registration, verification, redirect, token, and member calls use Wix visitor/member OAuth tokens. Passwords and OTP values are sent only to Wix and are never persisted. Wix state tokens, PKCE verifiers, expected email, flow, expiry, and local return path are carried only inside short-lived AES-GCM authenticated opaque values. Provider access/refresh tokens remain request-local and are never returned to the browser or stored by Player Hub.

The callback accepts only unexpired authenticated state, exchanges the code with the configured Headless client and exact callback URI, and requires a canonical member ID, `loginEmail`, and `loginEmailVerified: true`. Email flows additionally require the returned normalized email to match the email Wix authenticated. Only then does the existing identity service create or link the Player Hub user/player and issue its own HttpOnly session.

Optional request fields `captchaToken` and `captchaType` (`RECAPTCHA` or `INVISIBLE_RECAPTCHA`) map to Wix's documented CAPTCHA token contract. Wix CAPTCHA failures return `WIX_CAPTCHA_REQUIRED`; Player Hub never bypasses the challenge. The unconfigured adapter remains the safe fallback whenever `WIX_CLIENT_ID` or `WIX_DIRECT_AUTH_CALLBACK_URL` is absent. Facebook remains deferred.

`returnTo` is restricted to a relative local path. Wix state validation and the backend-owned frontend origin prevent open redirects.

## Sessions

- Opaque random token in the `cz_session` HttpOnly cookie
- Only a keyed hash is stored in `auth_sessions`
- 30-day inactivity expiry
- Renewal after at least 24 hours through `GET /api/auth/session`
- Persistent cookie expiry follows the authoritative database expiry
- `POST /api/auth/logout` revokes the row immediately and clears the cookie
- Production cookie security is controlled by `COOKIE_SECURE`, `SESSION_COOKIE_SAME_SITE`, and optional `SESSION_COOKIE_DOMAIN`
- `SameSite=None` is rejected unless `Secure=true`

All private APIs continue deriving `player_id` from the session. Client-selected player identity remains invalid.

## Frontend

`AuthProvider` checks `/api/auth/session` at startup. That request returns only the authenticated core identity, allowing `AuthenticatedRoute` and `GameShell` to render immediately after session authority is established. The provider then hydrates the full gameplay profile asynchronously from `/api/me`; rank, XP, Synapse Points, and other gameplay values remain neutral loading states until that authoritative response arrives. Unauthenticated users are sent to `/login` with a safe local return path. `/login`, `/signup`, and `/auth/handoff` are the small public authentication surface. Production builds reject mock data mode.

Development auto-login remains limited to development, API mode, explicit opt-in, and localhost/127.0.0.1 APIs. `/api/dev/login` remains forbidden in production.

## Migration Status

`0019_glossy_polaris.sql`: **APPLIED AND VERIFIED ON NEON DEVELOPMENT ONLY**.

Production migration remains a separate controlled deployment action.
