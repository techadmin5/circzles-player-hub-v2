# Wix Auth Proof Of Concept Notes

Date: 2026-09-02

## 1. Official Mechanism Researched

Official Wix documentation reviewed:

- Wix Headless member auth overview: `https://dev.wix.com/docs/go-headless/authentication/about-authentication`
- Wix login page REST flow: `https://dev.wix.com/docs/go-headless/authentication/members/wix-login-page/add-a-wix-login-page-rest`
- Allowed redirect URIs/domains: `https://dev.wix.com/docs/go-headless/authentication/setup/allow-redirect-uris-and-domains`
- Custom login page REST flow: `https://dev.wix.com/docs/go-headless/authentication/members/custom-login-page/build-a-custom-login-page-rest`
- Authentication methods overview: `https://dev.wix.com/docs/overview/auth-permissions/authentication-methods`

## 2. What Wix Supports

The current documented headless member path is OAuth-style member login using redirect sessions and PKCE. Wix login pages can redirect back to an allowed callback URI and exchange an authorization code for member tokens. Redirect URIs must be explicitly allowed.

Wix docs also describe custom login flows where a successful member login produces a session token, then a redirect session can authorize the member and produce access/refresh tokens.

## 3. What Was Tested

No live Wix site credentials, Wix headless client ID, allowed redirect URI, or Wix Velo backend secret were available in this workspace, so no live Wix authentication flow was executed.

Implemented and tested instead:

- V2 session architecture.
- Development-only identity bootstrap.
- `GET /api/me` session resolution.
- Production rejection of the development login route.

## 4. Existing-Login Behavior

Silent movement from an already logged-in Wix member on `circzles.in` to `dashboard.circzles.in` is not proven by the current workspace.

The official headless docs conclusively support redirect-session login/callback flows. They do not, by themselves, prove that a Wix Studio page can silently mint a secure one-time handoff for an already authenticated Wix member to an external V2 backend without a visible login.

## 5. Whether Silent Handoff Is Proven

Not proven.

Do not claim production silent SSO works until a Wix-site POC confirms one of these:

- Wix/Velo backend can identify the current logged-in member and mint a short-lived signed handoff token server-side.
- Or Wix Headless redirect/session APIs can complete authorization without visible re-login for an already authenticated Wix member.

## 6. Security Model

Recommended production model remains:

1. User authenticates on `circzles.in`.
2. Wix site initiates a supported Wix member auth or handoff flow.
3. V2 backend verifies Wix proof.
4. V2 backend maps `wixMemberId -> userId`.
5. V2 backend creates an opaque HttpOnly session for `dashboard.circzles.in`.

V2 must not trust player IDs, public player IDs, or display names from the browser as authentication proof.

## 7. Remaining Limitations

- Need a real Wix Headless/OAuth app client configuration.
- Need allowed callback URI for `dashboard.circzles.in`.
- Need confirmation of available Wix member ID fields.
- Need decision on whether callback uses query, fragment, web message, or a server-side one-time handoff token.
- Need logout behavior between Wix and V2.

## 8. Exact Production Flow Recommendation

For first production POC, implement Wix-supported OAuth redirect-session login against a staging callback:

`https://dashboard-staging.circzles.in/auth/wix/callback`

If that proves smooth for already authenticated Wix members, keep it. If it shows a visible login, evaluate a Wix Velo server-generated one-time handoff token only if Wix APIs support securely identifying the logged-in member server-side.

Until proven, V2 production auth endpoints should remain unimplemented or guarded behind explicit staging flags.
