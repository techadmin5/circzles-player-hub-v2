# Phase C2.4.7 - Wix Email Session Token Redirect Fix

## Status

Implemented and locally validated on `phase-c2-4-7-email-session-token-redirect-fix`. No database schema, migration, CAPTCHA, Google OAuth, logout, Player Hub session, progression, rank, or reward behavior changed.

## Confirmed Redirect Bug

Login V2, Register V2, and Verify During Authentication return a short-lived Wix `sessionToken` after successful email authentication. Player Hub correctly carried that token into its shared redirect builder, but serialized it beside `authRequest`:

```json
{ "auth": { "authRequest": {}, "sessionToken": "..." } }
```

Wix's custom-login REST flow requires the token inside the request:

```json
{ "auth": { "authRequest": { "sessionToken": "..." } } }
```

The incorrect placement could send an already-authenticated email user to a Wix-hosted login page again instead of binding the redirect session to that member.

## Corrected Email Flows

- **Login SUCCESS:** validates `session_token` and identity, creates the PKCE redirect with `auth.authRequest.sessionToken`, completes the shared callback, resolves the canonical verified Wix member, and creates the Player Hub session.
- **Register SUCCESS:** follows the same redirect path with the registration session token and preserves the safe local `returnTo`.
- **Email verification SUCCESS:** keeps the encrypted challenge and provider state token server-side, verifies the code with Wix, and places the returned session token inside `authRequest` before callback completion.

The later fragment-callback hardening moved the configured public callback to frontend `/auth/callback`. Email still uses query response mode; Google uses Wix's documented fragment mode. The frontend forwards either strict result to `POST /api/auth/direct/google/callback`, while code exchange, PKCE validation, canonical member lookup, verified-email enforcement, identity resolution, session cookie issuance, and safe return-path validation remain backend-owned.

## Account Errors

The production login diagnostic HTTP 404 with exact provider code `-19999` now maps narrowly to `WIX_ACCOUNT_NOT_FOUND`. An unrelated HTTP 404 does not. Existing documented `emailAlreadyExists` variants continue mapping to `WIX_ACCOUNT_ALREADY_EXISTS`, while `REQUIRE_EMAIL_VERIFICATION` remains a valid registration state for an uncompleted contact and is not treated as an existing-member failure.

Provider error extraction continues inspecting only nested `code`, `errorCode`, and `error_code` identifiers. It does not classify arbitrary error text or log raw provider responses.

## Google Regression

Google still uses the existing Wix connection ID and PKCE redirect. Its redirect request contains no `sessionToken` at either `auth.authRequest.sessionToken` or `auth.sessionToken`.

## Automated Coverage

Tests assert the exact redirect-session body for successful login, immediate registration, and post-verification success; the obsolete sibling token is absent. They also cover Google token absence, callback identity resolution, exact `404/-19999` mapping, unrelated 404 behavior, existing-member signup, verification challenges, CAPTCHA behavior, diagnostics redaction, and fail-closed missing token/identity responses.

Automated tests use mocked Wix responses and no real credentials. Controlled live cases for a genuinely new email, a known member, and a known contact remain deployment verification work and must not expose credentials in logs.
