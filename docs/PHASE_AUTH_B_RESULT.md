# Phase Auth B Result

## Status

**IMPLEMENTED AND AUTOMATED-TESTED / LIVE WIX CONFIGURATION AND RUNTIME VERIFICATION PENDING**

## Implemented

- Real `WixDirectAuthProvider` selected only when the required Headless configuration is present
- Wix anonymous visitor token acquisition
- Authentication API Login V2 for email/password login
- Authentication API Register V2 plus Verify During Authentication for signup-only email OTP
- Optional visible/invisible Wix reCAPTCHA token forwarding and controlled challenge errors
- Wix-managed Google login using the documented Google connection ID
- Query-mode OAuth authorization-code flow with PKCE
- Authenticated `Get My Member` lookup after token exchange
- Strict `loginEmailVerified` requirement, canonical `CIRCZLES_COM` source, and expected-email matching for email flows
- Safe Wix member profile mapping into the existing `VerifiedExternalIdentity` contract
- Existing Player Hub HttpOnly session issuance only after Wix callback verification
- Encrypted, authenticated, expiring signup challenge and OAuth state values
- Local-only `returnTo` validation
- Unconfigured fail-closed fallback retained

No gameplay ownership, reward, mission, Inventory, coupon, leaderboard, submission, provider webhook, schema, or migration behavior changed.

## Signup Verification

Player Hub sends display name, email, password, and optional CAPTCHA response to Wix Register V2. Signup proceeds only when Wix returns the email-verification-required state and a state token. The browser receives an opaque encrypted challenge ID; the OTP remains Wix-managed and is never stored by Player Hub. Successful verification still completes Wix's documented PKCE authorization redirect before member identity is accepted.

The canonical Wix site must be configured to require signup email verification. If Wix returns immediate registration success, Player Hub fails closed with `WIX_SIGNUP_VERIFICATION_NOT_REQUIRED` instead of silently skipping the requested OTP.

## Google

Google authentication is initiated through a Wix Redirect Session with connection ID `0e6a50f5-b523-4e29-990d-f37fa2ffdd69`. Wix documents this as its built-in Google connection ID; it is not an old-site or custom-app installation identifier and therefore is not an environment variable. Wix owns the Google interaction. A successful callback validates authenticated state and expiry, exchanges the code using the PKCE verifier, obtains the current Wix member, and creates a Player Hub session without an extra OTP. A documented OAuth error callback validates the same state and stops with a sanitized application error before any exchange or Player Hub session creation.

## Environment

Required to activate the real adapter:

```text
WIX_CLIENT_ID=<circzles.com Headless OAuth client ID>
WIX_DIRECT_AUTH_CALLBACK_URL=<exact frontend callback URL>
```

The configured Wix callback URL path is `/auth/callback`. Google returns its result in the fragment and email keeps query mode; the frontend page forwards either strict result to `POST /api/auth/direct/google/callback`. `SESSION_SECRET` protects opaque direct-auth state and remains required by the existing session system. Wix Headless visitor/member OAuth does not require an app secret for these flows. If either direct-auth variable is absent, the backend uses `UnconfiguredDirectAuthProvider` and returns `DIRECT_AUTH_PROVIDER_NOT_CONFIGURED`.

## Manual Wix Setup

1. Create or select the canonical `circzles.com` Headless OAuth client and deploy its client ID as `WIX_CLIENT_ID`.
2. Add the exact `WIX_DIRECT_AUTH_CALLBACK_URL` to the client's allowed authorization redirect URIs, including scheme, host, path, and any trailing-slash choice.
3. Enable Google as a Wix member login provider for the canonical site.
4. Require email verification during signup in Wix member signup/login settings.
5. If CAPTCHA is enabled, configure the frontend CAPTCHA widget with Wix's documented site key and pass the resulting token through the existing request contract.
6. Keep all callback and frontend origins aligned with deployed Render/Vercel custom domains and verify cookie `Secure`, `SameSite`, and domain settings separately.

## Verification

Automated tests mock every Wix response and make no external call. Coverage includes successful email login, unverified member rejection, safe invalid-credential propagation, signup challenge creation, OTP verification, invalid/expired verification, Google state tampering, Google callback identity, wrong email/site identity, missing configuration, CAPTCHA forwarding, and provider token non-disclosure.

No Wix, Neon, Production, Shopify, Render, Vercel, or other runtime service was accessed. No migration was generated or run.
