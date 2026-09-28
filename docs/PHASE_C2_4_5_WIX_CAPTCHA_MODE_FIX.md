# Phase C2.4.5 - Wix CAPTCHA Mode Fix

## Status

Implemented and locally validated on `phase-c2-4-5-wix-captcha-mode-fix`. This phase changes no database schema, migration, Google OAuth, logout, session, PKCE, progression, rank, or reward behavior.

## Production Failure

The production Wix Login V2 diagnostic was HTTP 403 with provider error code `-19971`. The backend did not recognize that exact missing-CAPTCHA condition, so it returned a generic authentication failure. Because the forms rendered CAPTCHA only after receiving `WIX_CAPTCHA_REQUIRED`, the visible challenge never appeared.

## CAPTCHA Mode

The observed production login and signup behavior requires a token on the initial request, which matches Wix's **Always** mode. Player Hub therefore uses visible Enterprise reCAPTCHA for both email login and email signup. The forms load Wix's documented visible site key before the first submission, keep submit disabled until a real token exists, and send it as:

```json
{
  "captcha_tokens": [
    { "Recaptcha": "<provider token>" }
  ]
}
```

The Wix Headless project settings must remain aligned at **Settings > Site Member Settings > Signup & Login Security**:

- CAPTCHA for login: `Always`
- CAPTCHA for signup: `Always`

The dashboard could not be opened from the local coding environment, so this phase does not claim an independent dashboard read or silently change Wix configuration. If either setting is intentionally changed to **For suspected bots**, the corresponding form must execute Wix's documented invisible Enterprise CAPTCHA and send `InvisibleRecaptcha`; the backend already preserves that token type.

## Error And Retry Handling

Only the exact provider code `-19971` on HTTP 403 maps to `WIX_CAPTCHA_REQUIRED`. Other 403 responses are not classified as CAPTCHA failures. Existing explicit missing-CAPTCHA markers remain supported.

Expired or invalid CAPTCHA responses clear and reset the widget. Wrong-password, unknown-account, and existing-account failures retain the current token and do not recreate the widget unnecessarily. Passwords, email addresses, CAPTCHA tokens, session tokens, visitor tokens, cookies, and authorization headers are not logged.

## Final Flows

Email login and signup now require visible CAPTCHA completion before their first request. Login `SUCCESS` and Register V2 `SUCCESS` continue through the existing PKCE authorization redirect. Registration email-verification and owner-approval states retain their existing handling. Google authentication is unchanged.

## Automated Coverage

Backend tests cover exact `-19971` mapping, an unrelated 403 remaining non-CAPTCHA, retry with a visible token, visible `Recaptcha` payloads, invisible `InvisibleRecaptcha` payloads, invalid/expired CAPTCHA, successful login, successful signup, wrong password, unknown login email, existing signup account, diagnostics redaction, and the unchanged Google flow. Provider calls are mocked; no live Wix credentials or CAPTCHA tokens are used.
