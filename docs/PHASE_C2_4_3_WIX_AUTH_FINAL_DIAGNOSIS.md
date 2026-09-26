# Phase C2.4.3 - Wix Email Authentication Failure Diagnosis

## Status

Implemented and locally validated on `phase-c2-4-3-wix-auth-final-diagnosis`. This phase changes no CAPTCHA mechanism, Google OAuth flow, logout behavior, session cookie configuration, database schema, progression, or rewards behavior.

## Pipeline Audit

Email login and signup travel through `LoginForm` / `SignupForm`, `apiClient`, the Fastify direct-email routes, and `WixDirectAuthProvider`. Login V2 and Register V2 responses are parsed as Wix state-machine outcomes. A successful email flow creates a Wix redirect session; only the existing callback exchanges the authorization code, validates `/members/v1/members/my`, resolves the canonical Player Hub identity, and creates the Player Hub session cookie.

The generic user-facing message was introduced after `WixDirectAuthProvider` failed to recognize a provider error code. The frontend deliberately replaced unrecognized backend errors with a safe generic message.

## Exact Finding

The code-level information-loss defect was the error-code extractor. It recognized direct string values such as `errorCode: "invalidPassword"`, but Wix state-machine metadata can place a code inside `additionalData` custom-value wrappers. A response such as `additionalData.errorCode.stringValue` therefore preserved `state: "FAILURE"` while losing the error code, forcing the generic branch.

The screenshots establish that production reached that generic branch, but they do not expose the live Wix state or code. No live Wix request was made during this implementation, so this document does not invent or claim a captured production payload. The added redacted diagnostics are the mechanism for identifying the exact deployed outcome on the next controlled smoke test.

## Safe Diagnostics

`WixDirectAuthProvider` now emits one structured outcome for Login V2, Register V2, and verification responses:

```text
operation: LOGIN | REGISTER | VERIFY
state: provider state or null
errorCode: extracted provider code or null
status: HTTP status
```

No password, CAPTCHA token, Wix state/session token, cookie, access token, refresh token, request body, or raw provider response is passed to the logger. State and code values are length-limited.

## State And Failure Handling

The adapter preserves camelCase and snake_case forms of `sessionToken`, `stateToken`, and `errorCode`, plus all supported states:

- `SUCCESS`
- `EMAIL_VERIFICATION_REQUIRED`
- `REQUIRE_EMAIL_VERIFICATION`
- `REQUIRE_OWNER_APPROVAL`
- `OWNER_APPROVAL_REQUIRED`
- `FAILURE`

Wrapped error-code scalar values are now extracted without collecting provider messages. Known codes map to controlled application errors. Unknown login/signup failures remain fail-closed.

Successful email login and verification now distinguish these internal failures:

- unsupported success state
- missing Wix session token
- missing Wix identity
- redirect-session failure
- authorization-code exchange failure
- canonical member-identity failure

Player Hub still creates a session cookie only after the authorization-code exchange and canonical member validation succeed.

## User Messages

- Account not found: `Account not found. Please create a profile first.`
- Wrong password: `Incorrect password.`
- Existing signup email: `This email is already registered. Please login.`
- Email verification: `Please verify your email before continuing.`
- Owner approval: `Your account is pending approval.`
- CAPTCHA outcome: `Security verification required.`
- Unknown outcome: `Authentication failed. Please try again.`

## Validation Scope

Automated tests use fake Wix responses and make no external calls. Coverage includes successful login, wrong password, unknown account, new signup verification, existing signup email, required/invalid CAPTCHA, camelCase and snake_case state envelopes, wrapped custom-value error codes, redacted LOGIN/REGISTER diagnostics, missing identity, callback identity verification, and unchanged Google flow.

A controlled deployed smoke test remains required to record the exact real Wix `state`, `errorCode`, and HTTP status now that those safe fields are observable.
