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

The backend exposes provider-neutral seams for:

- email/password login
- email/password signup challenge
- one-time signup email verification
- Google authorization start/callback

Passwords and OTP values are passed only to the configured identity provider adapter and are never persisted by Player Hub. Direct identities must come back as verified `CIRCZLES_COM` identities with the expected `EMAIL` or `GOOGLE` provider.

No Wix direct-auth API behavior is guessed in this phase. The default adapter returns `DIRECT_AUTH_PROVIDER_NOT_CONFIGURED`; live direct login requires a separately verified Wix Headless/member-auth adapter. Facebook remains optional and is not exposed.

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

`AuthProvider` checks `/api/auth/session` at startup. `GameShell` routes render through `AuthenticatedRoute`; unauthenticated users are sent to `/login` with a safe local return path. `/login`, `/signup`, and `/auth/handoff` are the small public authentication surface. Production builds reject mock data mode.

Development auto-login remains limited to development, API mode, explicit opt-in, and localhost/127.0.0.1 APIs. `/api/dev/login` remains forbidden in production.

## Migration Status

`0019_glossy_polaris.sql`: **GENERATED / NOT APPLIED**.

It must be inspected and applied manually only after the existing identity-link source assumption is confirmed.
