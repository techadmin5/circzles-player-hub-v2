# CircZles Player Hub V2

Frontend foundation for `dashboard.circzles.in`, replacing the previous Wix/Velo iframe dashboard with a typed Next.js App Router application.

## Commands

```bash
npm install
npm run dev
npm run build
```

## Phase 3A Backend POC

The frontend remains mock-first. To point only `playerService.getCurrentPlayer()` at the backend POC:

```bash
NEXT_PUBLIC_DATA_MODE=api
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

Backend app:

```bash
cd backend
npm install
npm run dev
```

Backend validation:

```bash
cd backend
npm run typecheck
npm test
npm run build
```

PostgreSQL is configured with `backend/.env.example`. Docker is not required; set `DATABASE_URL` to any local PostgreSQL instance. Migrations are in `backend/drizzle`.

## Architecture

- `src/app` - route tree for public, player, future, and admin areas.
- `src/components` - reusable UI, navigation, modals, effects, and cards.
- `src/features` - feature screens composed from services and components.
- `src/services` - Promise-based replaceable mock API layer.
- `src/mocks` - realistic CircZles data only consumed by services.
- `src/types` - shared domain contracts.
- `src/config` - feature flags, progression, and design tokens.
- `src/hooks` - app hooks such as sound preferences.
- `src/lib` - utility helpers.

## Domain Rules

- `levelId` is the puzzle difficulty/challenge level and is preserved exactly.
- `progressionLevel` is the player XP/RPG progression level.
- `internalId`, `publicPlayerId`, and `displayName` are separate identity concepts.
- Rename Cards update only `displayName`.

## Mock Services

Components request actions such as `purchaseItem(itemId)`, `spinWheel()`, and `claimMission(missionId)`. They do not send authoritative costs, rewards, ranks, or balances. Replace service implementations later to connect real APIs without redesigning components.

## Connecting the Real Backend Later

Keep component imports pointed at service modules. When PostgreSQL, auth bridge, uploads, leaderboards, missions, economy, and social APIs exist, replace the mock internals in `src/services` while keeping the exported method signatures stable.
