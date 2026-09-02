# Authentication Design Blueprint

## Goal

Existing Wix members should move from `circzles.in` to `dashboard.circzles.in` and become securely known to the V2 backend.

V2 identity is ecosystem-wide. The same V2 player must be recognizable across:

- `circzles.in`
- `dashboard.circzles.in`
- future commerce flows
- reviews/forms
- website quests and CTAs

Target journey:

1. User logs into `circzles.in`.
2. User clicks Player Hub.
3. User lands on `dashboard.circzles.in`.
4. V2 backend establishes identity.
5. V2 backend maps the identity to `users` and `players`.

## Important Constraint

Do not assume silent cross-subdomain SSO is guaranteed. A proof of concept is required before backend implementation locks the flow.

## Proposed Flow

### Existing Wix Member Bridge

1. Wix page requests a short-lived signed handoff token from a Velo backend module for the logged-in member.
2. Wix redirects to `https://dashboard.circzles.in/auth/wix/callback?handoff=...`.
3. V2 backend verifies token signature, expiry, audience, nonce, and Wix member ID.
4. V2 backend finds or creates `users` row with `wix_member_id`.
5. V2 backend finds or initializes linked `players` row.
6. V2 backend sets a secure V2 session cookie scoped to `dashboard.circzles.in`.
7. User is redirected to `/hub`.

## Session Handling

- Use opaque server-side session tokens or signed encrypted cookies.
- Cookie flags: `HttpOnly`, `Secure`, `SameSite=Lax`, host-only for `dashboard.circzles.in`.
- Session rows should store `session_id`, `user_id`, `created_at`, `expires_at`, `revoked_at`, last IP/user agent hash.
- Session expiry should be short enough for safety, with refresh if product requires it.

## Token Handling

Wix handoff token must include:

- `wixMemberId`
- optional email
- issued at
- expiry, preferably under 2 minutes
- nonce
- audience `dashboard.circzles.in`
- issuer `circzles.in`

The token must be single-use. Store consumed nonces or token IDs until expiry.

## New Account Initialization

When `wixMemberId` has no V2 user:

1. Create `users`.
2. Create `players`.
3. Preserve existing public player ID if migration already mapped the Wix member.
4. Otherwise generate unique `publicPlayerId`.
5. Initialize wallet/progression from migrated records or defaults.

This identity mapping must become the anchor for dashboard events, website events, future commerce events, review/form events, and migration reconciliation. Browser-provided player identifiers are never sufficient authentication proof.

## Existing Account Linking

During migration, imported Wix member IDs should pre-create or stage mappings. First login confirms linkage.

Duplicate prevention:

- unique `users.wix_member_id`
- unique `players.public_player_id`
- linking flow refuses to attach one Wix member to multiple active users
- manual admin merge path is required for conflicts

## Logout

- `POST /api/auth/logout` revokes V2 session.
- Redirect user to a safe location.
- Wix logout is separate unless a confirmed Wix API/logout integration is added.

## Expired Sessions

- API returns `401 UNAUTHORIZED`.
- Frontend routes should redirect to `/login` or show a re-auth action.
- Preserve intended redirect target where safe.

## POC Questions

- Can Wix Velo mint a secure short-lived token using a secret unavailable to the browser?
- Can the hub launch link reliably include the token without exposing it through logs/referrers beyond acceptable limits?
- Should callback exchange happen through POST or one-time URL token?
- What Wix member fields are reliably available?
- How will mobile browsers handle the redirect and cookies?
- Can website quest/review/commerce events be associated with the same V2 player identity without trusting browser-only claims?
