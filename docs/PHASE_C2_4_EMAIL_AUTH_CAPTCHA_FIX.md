# Phase C2.4 - Email Authentication CAPTCHA Fix

## Status

Implemented and locally validated on `phase-c2-4-email-auth-captcha-flow-fix`. This phase changes no schema, migration, session-cookie, Google OAuth, or game-authority behavior.

## Root Cause

The visible Wix Enterprise reCAPTCHA widget produced a real token and the frontend retained it through submission. The backend wire payload was incorrect, however: Wix Login V2 and Register V2 define `captchaTokens` as an array of CAPTCHA token objects, while Player Hub sent a single object. Wix therefore did not receive the solved token in its documented REST shape.

The backend also classified every provider error marker containing `CAPTCHA` as `WIX_CAPTCHA_REQUIRED`. That erased the distinction between an initial missing challenge and a rejected or expired token, so the forms reset the widget for every CAPTCHA-related response and presented an endless generic challenge loop.

## Resolution

- Login and Register now send visible tokens as `captchaTokens: [{ Recaptcha: token }]` and invisible tokens as `captchaTokens: [{ InvisibleRecaptcha: token }]`.
- The solved frontend token remains in state and is sent exactly as received. It is not cleared before or after a wrong-password, unknown-account, or existing-account response.
- An initial `missingCaptchaToken` / CAPTCHA-required response displays the widget without an unnecessary reset.
- Only Wix `invalidCaptchaToken` causes the stored token and widget to reset, with the message `Security check expired. Please try again.`
- Refreshing the page intentionally discards the in-memory CAPTCHA token; the next submit obtains a fresh provider challenge instead of persisting a security token in browser storage.

Official Wix references:

- https://dev.wix.com/docs/go-headless/authentication/members/custom-login-page/re-captcha/add-re-captcha-to-a-custom-login-page-rest
- https://dev.wix.com/docs/api-reference/business-management/headless/authentication/register-v-2
- https://dev.wix.com/docs/sdk/core-modules/sdk/oauth-strategy

## Error Mapping

Provider error codes are converted to controlled Player Hub errors without returning raw Wix payloads:

| Wix outcome | Player Hub message |
| --- | --- |
| Missing CAPTCHA token | Please complete the security check. |
| Invalid/expired CAPTCHA token | Security check expired. Please try again. |
| Login `invalidEmail` | Account not found. Please create a profile first. |
| Login `invalidPassword` | Incorrect password. Please try again. |
| Signup `emailAlreadyExists` | Account already exists. Please log in. |
| Invalid email input | Enter a valid email address. |

Unknown provider failures remain generic and fail closed. Passwords, CAPTCHA tokens, provider payloads, access tokens, and refresh tokens are not exposed in controlled errors.

## Verification

Automated adapter tests cover login with and without CAPTCHA data, exact visible/invisible Wix payload shapes, wrong password, unknown login email, initial CAPTCHA requirement, invalid/expired CAPTCHA, new verified-email signup, existing signup email, verification failure, and the unchanged Google flow. Frontend production build and lint validate the login/signup integration; the repository does not currently include a browser component-test runner.

The compact Enterprise widget remains suitable for narrow mobile layouts. Live Wix/Google calls are intentionally outside local automated validation, so deployed login and signup still require a controlled provider smoke test after review.
