# Phase C2.4.4 - Wix REST Email Authentication Fix

## Status

Implemented and locally validated on `phase-c2-4-4-wix-rest-email-auth-fix`. No database schema, migration, cookie policy, Google OAuth, progression, rank, or reward behavior changed.

## Confirmed Root Causes

The backend calls Wix Login V2 and Register V2 over REST, but serialized their request bodies using SDK-style camelCase keys. Wix's REST examples require `login_id` and `captcha_tokens`. The solved CAPTCHA and login identifier therefore did not use the documented REST wire format.

Register V2 can also return `SUCCESS` with `session_token` and `identity`. Player Hub previously rejected that valid result because it required every registration to enter email verification.

## Corrected REST Payloads

Login and Register now send `login_id.email`, `password`, and optional `captcha_tokens`. Register also sends `profile.nickname`. Visible CAPTCHA uses `{ "Recaptcha": token }`; invisible CAPTCHA uses `{ "InvisibleRecaptcha": token }` inside the `captcha_tokens` array.

Verify During Authentication remains `{ code, stateToken }`. This camelCase `stateToken` is intentional: it matches Wix's current REST request example for `POST /_api/iam/verification/v1/auth/verify`. Response parsing continues to accept both camelCase and snake_case session, state-token, and error-code fields.

## State Handling

- Login `SUCCESS` requires a session token and identity, then creates the existing PKCE authorization redirect.
- Register `SUCCESS` requires a session token and identity, then creates the same authorization redirect and preserves the safe local `returnTo` path.
- `REQUIRE_EMAIL_VERIFICATION` and the already-supported equivalent state create an encrypted local challenge. Successful verification continues through the authorization redirect.
- `REQUIRE_OWNER_APPROVAL` remains a controlled pending-account response and creates no Player Hub session.
- Unknown states and incomplete success responses fail closed.

## Error Mapping

Provider-identified invalid email, invalid password, existing email, password-reset, missing CAPTCHA, and invalid/expired CAPTCHA outcomes remain controlled application errors. The frontend presents specific safe guidance only when Wix identifies the category; unknown failures use `Authentication failed. Please try again.` No separate member lookup was added, avoiding a new account-enumeration surface.

CAPTCHA tokens are retained after ordinary credential/account failures. The widget is reset only when Wix explicitly reports a missing/renewed challenge or an invalid/expired token.

## Test Matrix

Automated fake-provider tests assert exact outbound Login V2 and Register V2 JSON, with and without CAPTCHA; exact verification JSON; immediate registration success; email-verification registration; owner approval; required success artifacts; known failure mapping; diagnostics redaction; callback identity validation; and the unchanged Google path. Route tests cover both signup response variants and confirm neither creates a Player Hub cookie before the authorization callback.

No live Wix credentials or uncontrolled addresses were used during local validation. Controlled existing/new member smoke testing remains a deployment verification step; test credentials must never be logged or committed.

## Security

Passwords, CAPTCHA tokens, Wix session/state tokens, visitor/member access tokens, cookies, and authorization headers are neither logged nor returned. Diagnostics remain limited to operation, state, provider error code, and HTTP status. The authoritative Wix callback, canonical member lookup, and Player Hub session creation boundary are unchanged.
