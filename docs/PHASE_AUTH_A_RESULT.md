# Phase Auth A Result

## Status

**IMPLEMENTED AND AUTOMATED-TESTED / EXTERNAL PROVIDER CONFIGURATION AND DATABASE MIGRATION PENDING**

## Implemented

- Multi-site verified identity linking to one internal user/player
- Per-site signed handoff verification and one-time replay protection
- First-entry provisioning and returning identity resolution
- Verified-email safe linking with conflict rejection
- 30-day inactivity sessions with daily-bounded sliding renewal
- Immediate logout revocation
- Provider-neutral email signup/login/verification and Google OAuth seams
- Real login/signup/handoff frontend flows
- Global session bootstrap and authenticated `GameShell` guard
- Production API-mode enforcement and preserved development-only login controls

All private gameplay routes continue deriving `player_id` from the authenticated session.

## Migration

`backend/drizzle/0019_glossy_polaris.sql` is generated and **was not run**. Before manual Development application, inspect historical `wix_identity_links`: the generated migration defaults existing links to `CIRCZLES_COM`, so any historical `circzles.in` link must be identified and handled deliberately.

## External Boundary

The signed website handoff contract is complete but must be implemented in each Wix site's server-side code with its own secret. Direct email/password, signup OTP, and Google login deliberately use an unconfigured provider adapter until the exact Wix Headless/member-auth contract is verified. There is no fake authentication success.

## Known Limitations

- Facebook is deferred.
- Direct email/Google live verification is blocked on the real Wix adapter and settings.
- Migration and real PostgreSQL concurrency were not runtime-tested in this implementation step.
- Browser cookie behavior must be verified using final Vercel/API custom domains.
