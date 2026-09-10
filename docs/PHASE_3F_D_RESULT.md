# Phase 3F-D Result

## Real Missions Integration

The Missions page keeps its server-rendered shell and mounts a focused client-side `MissionExplorer`. In API mode, the explorer loads authenticated `GET /api/missions` from the browser so session cookies remain authoritative. It renders loading, retryable error, empty, `IN_PROGRESS`, `CLAIMABLE`, and `CLAIMED` states without substituting mock data after an API failure.

The API DTO has explicit mission status, period, progress, date, and XP/Synapse Point reward types. Its adapter preserves backend `IN_PROGRESS` rather than translating it to a mock-only status, maps reward labels into the existing card contract, and derives a display-only remaining-time label from `endsAt`. Missions without an end date display `No expiry`; backend time remains the eligibility authority.

## Claim Flow

Claim controls call authenticated `POST /api/missions/:missionId/claim` with an empty JSON object and a browser-generated UUID `Idempotency-Key`. An immediate per-mission guard prevents rapid duplicate calls. The same key is retained after a failed or unresolved request so a retry addresses the same logical claim.

On success, the card is marked `CLAIMED` locally and API mode re-fetches missions to restore backend authority. The complete claim result remains available to the explorer, including awarded XP/SP and authoritative player state, and is used only for basic reward text and existing sound hooks. The frontend never calculates or changes balances. The reusable premium reward feedback system remains deferred to Phase 3F-E.

Known mission-domain failures produce concise card-level messages without marking the mission claimed, and controls recover after requests settle. The category filter set remains available even when a category or the entire active mission list is empty.

## Data Modes And Verification

Mock mode retains local missions and mock claim responses for visual/demo use. API mode uses only the real mission endpoints. No frontend test runner is configured in the current root project, so this phase adds no new test framework; frontend type safety and integration are validated by root lint and the Next.js production build. Existing backend tests remain the authority-boundary regression suite.

Migration `0010_medical_gideon.sql` had already been runtime verified on Neon DEVELOPMENT before this frontend phase. No migration or database write was performed as part of Phase 3F-D. Wix, production, and `main` were untouched.

API-mode smoke testing also exposed that an unexpected disconnect from an idle PostgreSQL pooled client could emit an unhandled pool error and terminate the backend process. The shared pool factory now installs an error listener that logs the idle-client failure and lets `pg.Pool` discard the broken client; later checkouts can establish a fresh connection. Active query and transaction errors still reject their callers normally. This hardening changes no schema or database data.

## Public Environment Resolution

A later API-mode smoke test found the browser reporting `data-data-mode="mock"` and rendering demo missions while root `.env.local` contained `NEXT_PUBLIC_DATA_MODE=api`. The environment audit found no process variable, `.env.development.local`, `.env.development`, `.env`, `next.config`, or package-script override. The root cause was a stale Next.js development process/client bundle: `NEXT_PUBLIC_*` values are statically inlined when `next dev` or `next build` starts and do not update inside an already-built browser bundle when `.env.local` changes. Restarting the root dev server is required after changing either public setting.

Public configuration now trims and lowercases the mode, so `api`, `Api`, and whitespace-padded equivalents resolve consistently; missing or unknown values remain safely in mock mode. API mode fails clearly when `NEXT_PUBLIC_API_BASE_URL` is absent. During development, `MissionExplorer` logs only the resolved mode and a boolean indicating whether the API base URL exists. Developers can also inspect the `data-data-mode` attribute immediately, including during loading or error states. No URL value, secret, or production diagnostic is logged.
