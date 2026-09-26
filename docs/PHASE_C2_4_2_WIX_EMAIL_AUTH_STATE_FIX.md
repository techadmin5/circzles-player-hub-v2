# Phase C2.4.2 - Wix Email Authentication State Fix

## Status

Implemented and locally validated on `phase-c2-4-2-wix-email-auth-state-fix`. No database, migration, session-cookie, Google OAuth, logout, identity-authority, or game-system change is included.

## Root Cause

Wix Login V2, Register V2, and Verify During Authentication are state-machine APIs. The adapter handled the expected state names but parsed only camelCase `sessionToken`, `stateToken`, and `errorCode`. Wix's REST response examples also use `session_token`, `state_token`, and `error_code`. A real successful login could therefore lose its session token, while a valid signup email-verification response could lose its state token. Both then fell through to generic failure handling.

The UI also treated login as redirect-only. It had no safe path for a legitimate `EMAIL_VERIFICATION_REQUIRED` result from Login V2, and operation-specific unknown failures could surface the backend's generic provider message.

## Backend State Handling

The Wix adapter now normalizes the documented camelCase and REST snake_case response fields while retaining the existing request and security architecture.

- `SUCCESS` is accepted only when a non-empty Wix session token and Wix identity ID are present.
- `EMAIL_VERIFICATION_REQUIRED` and `REQUIRE_EMAIL_VERIFICATION` preserve the Wix state token inside the existing authenticated-encryption challenge envelope.
- `FAILURE` is mapped from documented Wix error codes to controlled Player Hub `AppError` responses.
- Missing required success/verification fields fail closed without creating a redirect or Player Hub session.
- The browser never receives Wix visitor tokens, state tokens, session tokens, access tokens, refresh tokens, or raw provider errors.

Player Hub session creation remains exclusively in the existing OAuth callback after Wix authorization-code exchange and canonical `/members/v1/members/my` identity validation. An email login or signup response never directly creates a Player Hub session.

## Login Flow

1. Login V2 returns `SUCCESS`: the adapter requires the session token and provider identity, then starts the existing full-page PKCE redirect.
2. Login V2 returns email verification required: the API returns an opaque `EMAIL_VERIFICATION_REQUIRED` challenge and the login form displays the verification-code step.
3. Verification succeeds: the same PKCE redirect and canonical member callback complete authentication.
4. Verification or login fails: the form exits its loading state immediately and displays a controlled message. Email-auth requests use a 20-second upper bound so a stalled provider request cannot leave the form indefinitely busy.

Login mappings:

- `invalidEmail`: `Account not found. Please create a profile first.`
- `invalidPassword`: `Incorrect password. Please try again.`
- `missingCaptchaToken`: `Please complete the security check.`
- `invalidCaptchaToken`: `Security check expired. Please verify again.`
- unknown: `Unable to complete login. Please try again.`

## Signup Flow

Register V2 must return an email-verification-required state and a state token. The token is sealed into the opaque challenge; the form displays `Please verify your email to continue.` and submits the OTP through the existing verification endpoint. A direct unverified signup session is never accepted.

Signup mappings:

- `emailAlreadyExists`: `This email is already registered. Please log in.`
- `invalidEmail`: `Enter a valid email address.`
- `missingCaptchaToken`: `Please complete the security check.`
- `invalidCaptchaToken`: `Security check expired. Please try again.`
- unknown: `Unable to create account. Please try again.`

## CAPTCHA Lifecycle

The corrected Wix payload remains `captchaTokens: [{ Recaptcha: token }]`. Wrong-password, unknown-account, and existing-account responses do not clear a solved token. The widget resets only when the token is invalid/expired or Wix explicitly requests a new challenge after a token was submitted.

## Validation Scope

Automated coverage includes successful camelCase and REST snake_case login responses, login-time email verification, signup verification, missing success identity, wrong password, unknown account, existing account, invalid email, required/invalid CAPTCHA, safe unknown failures, callback identity validation, and the unchanged Google authorization path. Provider calls remain mocked; no Wix or database runtime call is part of this validation.
