# CircZles Backend Phase 3A

Minimal authentication, identity, session, and PostgreSQL proof of concept.

## Commands

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

## Environment

Copy `.env.example` to `.env` and set:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/circzles_player_hub
SESSION_SECRET=replace-with-at-least-32-random-characters
FRONTEND_ORIGIN=http://localhost:3000
```

Docker is not available in the current workspace environment, so local PostgreSQL must be supplied separately.

## Database

Phase 3A creates only:

- `users`
- `players`
- `wix_identity_links`
- `auth_sessions`

Migration:

```bash
npm run db:migrate
```

Current generated migration:

```text
drizzle/0000_slim_echo.sql
```

Development seed:

```bash
npm run seed:dev
```

The seed refuses to run when `NODE_ENV=production`.

## Endpoints

- `GET /health`
- `GET /api/me`
- `POST /api/dev/login`, disabled in production

Authentication uses an opaque session token in an HttpOnly cookie. The cookie identifies a session, which resolves to a user and then to a player.
