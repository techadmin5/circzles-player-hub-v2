# Wix → Player Hub SSO handoff (circzles.com and circzles.in)

The Player Hub already contains the receiving side of this flow (`POST /api/auth/handoff/exchange`,
`/auth/handoff`, `AuthHandoffVerifier`, `wixIdentityLinks`, `authHandoffExchanges`). This folder adds the
**sending side** that runs inside each Wix site. Repository deployment does **not** update Wix Studio:
everything in section D and E is done by hand in each site.

```
Visitor clicks Enter Hub (Wix site)
  ├─ logged in  → backend web module reads the caller's member → signs a 120 s token → redirect
  └─ logged out → authentication.promptLogin() → (resolves on login) → same call → redirect
https://circzles-player-hub.vercel.app/auth/handoff#handoff=<token>
  → page reads the fragment, removes it from history, POSTs it to /api/auth/handoff/exchange
  → backend verifies signature/iss/aud/exp/jti, links identity, sets cz_session → /hub
```

## A. Repository changes
Already in this branch: tests, a fragment helper, and this folder. No schema change, no migration.

## B. Render (backend) — set both secrets
| Variable | Value |
| --- | --- |
| `AUTH_HANDOFF_CIRCZLES_COM_SECRET` | random string, ≥ 32 chars |
| `AUTH_HANDOFF_CIRCZLES_IN_SECRET` | a **different** random string, ≥ 32 chars |

Generate each with `openssl rand -base64 48`. Do not rotate any existing secret to do this.
Nothing else changes: `SESSION_COOKIE_DOMAIN` stays empty, `COOKIE_SECURE=true`, `SESSION_COOKIE_SAME_SITE=lax`.

## C. Vercel
No change. Keep `PLAYER_HUB_API_ORIGIN=https://circzles-player-hub-api.onrender.com` and the server-side proxy.

## D. Wix Studio / Velo (do this on **each** site)
1. Turn on **Velo / Dev Mode**.
2. **Email confirmation is required.** Dashboard → Members → Signup settings → enable
   *Ask new members to confirm their email*. Existing members must also have confirmed their email.
3. Backend → add `backend/playerHubHandoffCore.js` from `shared/` (identical on both sites).
4. Backend → add `backend/playerHubHandoff.web.js` from `circzles-com/` or `circzles-in/`.
5. Page code → paste `shared/enterHubButton.page.js` into the page (or masterPage) with the button; rename `#enterHubButton`.
6. Publish. Backend and member APIs are only partly functional in Preview; test on the published site.

> **Security requirement — member-level email verification.** The sender requires the current member
> record itself to contain `loginEmailVerified === true`. Wix's current Members API documents
> `loginEmailVerified` on **Get My Member**. The template never turns a site-wide setting into
> `emailVerified: true`; false or missing verification fails closed with `EMAIL_NOT_VERIFIED`.
> If the Velo member object on a published site does not expose this documented field, do not bypass
> the check. Switch the backend retrieval to Wix's supported Get My Member API/SDK and keep the same rule.

## E. Wix Secrets Manager (each site)
| Site | Secret name | Value |
| --- | --- | --- |
| circzles.com | `AUTH_HANDOFF_CIRCZLES_COM_SECRET` | same as Render |
| circzles.in | `AUTH_HANDOFF_CIRCZLES_IN_SECRET` | same as Render |

A site must hold **only its own** secret. Each secret is read only in backend code; it is never in page code.

## APIs used (verified against Wix docs, October 2026)
`wix-web-module` `webMethod`, `wix-members-backend` `currentMember.getMember()` (throws when logged out),
`wix-secrets-backend` `getSecret()`, `wix-members-frontend` `authentication.promptLogin()` (resolves when login
completes, rejects on cancel) and `currentMember.getMember()` (undefined when logged out).
The current Wix Members **Get My Member** contract documents `id`, `loginEmail`, `loginEmailVerified`, `status`,
`contact`, and `profile`. The shared normalizer accepts current documented names and legacy Velo aliases for
non-authoritative profile fields, but `loginEmailVerified === true` is mandatory.

## Test matrix (manual, on published sites)
1. Logged-in member clicks Enter Hub → lands on `/hub`, no login screen.
2. Logged-out visitor → Wix login/signup → lands on `/hub`.
3. Visitor cancels the login dialog → stays on the site, no redirect.
4. Same email on .com then .in → same Player Hub player.
5. Reload `/auth/handoff` after success → controlled "missing handoff" message.
6. Reopen the old URL from history → rejected (single use).
7. Member with `loginEmailVerified=false` or missing verification → no redirect.
