# Phase 3A Result

Date: 2026-09-02

## Implemented

- Separate `backend/` Node.js TypeScript application.
- Fastify HTTP server.
- Drizzle ORM schema for the minimal identity/auth database.
- PostgreSQL client wiring.
- Opaque session token architecture with HttpOnly cookies.
- Development-only login route.
- `GET /health`.
- `GET /api/me`.
- Development seed script.
- Backend tests for identity creation, duplicate Wix identity handling, session behavior, `/api/me`, and production dev-login lockout.
- Minimal frontend API client and data mode switch for `playerService.getCurrentPlayer()`.

## Database Tables Created For Phase 3A

Only the minimal identity/auth tables were designed and migrated:

- `users`
- `players`
- `wix_identity_links`
- `auth_sessions`

No missions, leaderboards, economy, XP, store, inventory, wheel, friends, chat, seasons, notifications, video upload, or migration tables were implemented.

## Endpoints

- `GET /health`
- `GET /api/me`
- `POST /api/dev/login`

`POST /api/dev/login` is disabled when `NODE_ENV=production`.

## Authentication Flow

Development:

1. `POST /api/dev/login`.
2. Backend creates or loads the dev Wix-like identity.
3. Backend stores an auth session and sets the `cz_session` HttpOnly cookie.
4. `GET /api/me` resolves cookie -> session -> user -> player.

Production:

Production Wix authentication was not faked. See `docs/WIX_AUTH_POC.md`.

## Tests

Backend test coverage includes:

- `publicPlayerId` format and uniqueness sample.
- First-time Wix identity creates user/player.
- Existing Wix identity returns existing user/player.
- Duplicate Wix identity does not create duplicates.
- Valid session returns the correct player.
- Expired session returns no player.
- `GET /api/me` requires auth.
- `GET /api/me` returns player after dev login.
- Production cannot use dev login.

## Wix POC Result

Current official Wix Headless documentation supports OAuth redirect-session member login with PKCE and configured callback URIs.

Silent cross-subdomain handoff from an already authenticated Wix Studio session to `dashboard.circzles.in` is not proven in this workspace.

## Known Limitations

- No live PostgreSQL database was available or provisioned in this workspace.
- Docker is not installed here.
- `psql` is not installed here.
- `DATABASE_URL` is not set in the shell environment.
- Migrations were written, but not applied to a live database during this run.
- No live Wix credentials or configured Headless client were available.
- Production Wix auth endpoint is intentionally not implemented.

## Validation Results

- Frontend `npm run lint`: passed.
- Frontend `npm run build`: passed.
- Backend `npm run lint`: passed.
- Backend `npm run typecheck`: passed.
- Backend `npm test`: passed, 2 files and 9 tests.
- Backend `npm run build`: passed.
- Drizzle migration generation: passed, 4 tables.
- Live PostgreSQL connection: not run because no local PostgreSQL/Docker/`DATABASE_URL` was available.

## CORS And Cookie Security

Development:

- `FRONTEND_ORIGIN=http://localhost:3000`.
- Backend CORS allows that single origin with credentials.
- Cookie uses `HttpOnly`, `SameSite=Lax`, `Secure=false` for localhost development.

Production target:

- `FRONTEND_ORIGIN=https://dashboard.circzles.in`.
- Do not use wildcard CORS for authenticated APIs.
- Cookie should use `HttpOnly`, `Secure=true`, `SameSite=Lax`, host-only scope for the API/session domain strategy selected during deployment.
- CSRF risk should be reviewed before production mutations. For cookie-authenticated state-changing endpoints, add CSRF tokens or same-site origin checks before enabling real production auth.

## Next Recommended Phase

Phase 3B should prove production Wix authentication in staging with a real Wix Headless client and a real PostgreSQL database before adding game systems.
