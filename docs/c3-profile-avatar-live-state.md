# Phase C3: persisted profiles, avatars and live player state

Branch: `feature/c3-profile-avatar-live-state`
Base: `c4deb38aac81b59762f1542a1cbef4680a76032c` (current main at branch creation).

## Architecture

`players.avatar_source` explicitly selects DEFAULT, CUSTOM_UPLOAD or INVENTORY_AVATAR. DEFAULT resolves to the existing neutral `/brand/avatar.svg`, CUSTOM_UPLOAD uses the persisted backend-managed photo URL, and INVENTORY_AVATAR resolves the player's equipped owned inventory reward. Missing assets fall back to the neutral icon. Provider photos remain identity metadata in `users.avatar_url`; they never select a Hub avatar. Buying/granting an avatar does not auto-equip it. Switching to default or photo clears the AVATAR equipment slot while preserving the uploaded photo for re-selection. Equipping/unequipping AVATAR updates the source within the existing equipment transaction and advisory lock. Other slots are preserved.

`PlayerProfileService` owns strict authenticated profile/avatar mutation payloads. The actor always comes from the session; payloads cannot set UUID, player number, public Player ID, email or an arbitrary image URL. Display names use the existing trimmed 2-32 code-point validator; locations are trimmed, bounded to 100 characters and reject controls. Changing a name still consumes one owned Rename Card with the existing idempotency, events and transaction rules. Name/location changes commit atomically. No new first/last-name fields or provider configuration changes.

`GET /api/auth/session` remains core identity without gameplay hydration. `GET /api/me` is a private/no-store full persisted snapshot, read in a repeatable-read transaction after ensuring existing game-state rows. It returns effective avatar/source/photo availability, display name, locations, backend wallet balance, XP, next XP threshold, progression level/rank, equipped frame, badge showcase and persisted puzzle/submission/best counts. Existing unsupported podium/season/streak placeholders remain zero. The photo's storage identifier is not returned to the browser or public profile. Public profiles use the same effective-avatar resolver.

The expanded existing Zustand `playerUiState.player` holds the complete hydrated profile. AuthProvider subscribes to it instead of keeping a separate full player state. Header, Hub metrics, profile, progression presentation, avatar picker and current-player public/leaderboard identities consume that snapshot. Production rank/level come from backend values; frontend code only renders progress percentages and matching presentation assets. Demo-only reward feedback helpers do not overwrite production state.

Every player-state mutation goes through a shared API-client wrapper: successful server mutation -> fresh `/api/me` -> complete store replacement -> mounted consumers rerender. Request ordering and session generations prevent older responses or logged-out sessions from restoring stale state. A committed action whose follow-up hydration fails still returns its successful mutation result; a visible sync warning offers Retry, and background refresh can recover. It does not automatically replay purchases/spins/claims. Async review-derived rewards refresh on focus, visibility change and every 15 seconds while visible. This is polling, not a websocket: external reviews may take up to the next poll to become visible.

## Durable photo storage

`POST /api/me/avatar/photo` accepts only JPEG/PNG/WebP, canonical base64 and at most 2 MiB decoded bytes (3 MiB HTTP body limit). MIME/header mismatch, oversized or malformed payloads fail server-side. Client checks are additional convenience. A small backend storage interface reuses the existing Cloudinary SDK and existing server credentials. Identifiers are generated server-side as `circzles/profile-avatars/<random UUID>`; overwrite is disabled. Cloudinary decodes the raster, applies an incoming maximum 512x512 transformation with `force_strip.strip_profile`, and restricts output formats. The adapter validates the resulting identifier, image resource, format, version, dimensions and byte count before deriving an HTTPS Cloudinary delivery URL. Credential or decoder errors expose only controlled messages.

Incoming metadata stripping follows the [Cloudinary transformation reference](https://cloudinary.com/documentation/transformation_reference): `force_strip` removes embedded metadata (with Cloudinary's documented DigitalSourceType exception); `strip_profile` handles color profiles. Real remote decoding/delivery is a rollout smoke test; automated storage tests mock the SDK boundary.

URLs/identifiers persist in PostgreSQL, not browser storage. Selected photos are public profile images. Old replaced or unattached uploaded assets are retained rather than deleting a possibly still-referenced image. Establish Cloudinary lifecycle/housekeeping for that prefix; uploads require an authenticated session and should be monitored for storage usage. This change does not add a dedicated photo quota; gateway/account quotas and asset lifecycle policy remain operational considerations. No credentials or environment variables were changed or inspected for this work.

## Migration and production prerequisites

- Additive `backend/drizzle/0022_player_profile_avatar.sql`, with snapshot and journal entry. Adds three profile-avatar columns and source/photo consistency constraints. Backfills only existing owned, positive-quantity, equipped AVATAR rewards as INVENTORY_AVATAR. Historical provider photos are not imported as custom photos. Migration application is managed once by the existing Drizzle journal, consistent with repository conventions.
- Migrations 0000-0021 are unchanged. No sequence SQL, Player ID change, reset or destructive data operation is added. Existing players, IDs, timestamps and equipment are preserved by a database fixture assertion.
- The historical one-time launch operator's migration loader is bounded to its already-reviewed 0000-0021 chain. Its reset/sequence logic is unchanged. Historical tests apply 0022 only after validating the old chain so the new ORM can read the new columns. Do not use that reset operator to roll out C3.
- An operator must review/apply 0022 through the normal migration process before running the new backend; coordinate deployment with schema readiness. No production migration/deployment/merge was performed.
- Existing Cloudinary cloud/key/secret configuration must be available to the backend. Missing configuration produces a controlled 503. After a separately authorized rollout, smoke-test a real JPEG/PNG/WebP upload, replace/default/photo re-selection, public URL rendering, refresh and logout/login on a second browser/device. Real Cloudinary delivery and physical multi-device production use have not been exercised here.
- Use an owned Rename Card for display-name changes; country/state changes do not consume one. Existing AVATAR catalog image URLs and owned inventory must be valid for inventory selection.

## Player-facing mutation audit

| Flow | Authoritative synchronization |
| --- | --- |
| Mission claim | Existing transactional XP/SP grants, then `/api/me` including updated threshold/level/rank |
| Store purchase | Existing wallet/inventory transaction, then `/api/me`; inventory is fetched by locker/picker; no auto-equip |
| Reward wheel spin | Existing transactional debit/reward grant, then `/api/me` |
| Inventory equip/unequip | Existing ownership checks/transaction; AVATAR source and frame hydrate from `/api/me` |
| Rename Card action | Existing transactional consumption/name update, then `/api/me` |
| Profile name/country/state | Authenticated validated transaction, returns full profile; client canonical refresh |
| Default/photo selection and upload | Backend-managed storage plus persisted equipment/source transaction; canonical refresh |
| Puzzle claim/submission creation | Existing domain logic, then `/api/me` for changed ownership/stats |
| Submission review on another surface | Existing review reward transaction; visible polling/focus fetches fresh `/api/me` |
| Video upload/sign/complete | Upload bookkeeping only; full state refresh occurs when submission is created |

## Validation and evidence

- Backend `npm test -- --maxWorkers=2`: **789 passed**, 42 files; no failures/skips.
- Backend `npm run lint`, `npm run typecheck`, `npm run build`: passed.
- Frontend `npm test`: **96 passed**; no failures/skips.
- Frontend `npm run lint`, `npx tsc --noEmit --incremental false`, `npm run build`: passed. No dedicated frontend typecheck script is configured; the direct TypeScript command supplies it.
- Backend `playerProfile.test.ts` covers real PGlite migrations, native signup/login, Google/Wix avatar decoupling, photo persistence/session renewal, inventory equip/default, owned avatar purchase, actual mission threshold crossing, atomic Rename Card/profile updates, immutable payload rejection, DB wallet/progression reads and storage constraints. No live database is connected.
- HTTP tests cover session enforcement, immutable/actor/URL injection rejection, canonical full `/api/me`, session identity actor selection and lightweight bootstrap. Existing native email, Google callback, rewards, wheel and Player ID sequence suites remain passing.
- Frontend `playerLiveState.test.mjs` mounts AuthProvider, GameShell, identity panel, production picker and current-player leaderboard identity. It exercises FileReader upload, owned/default choices, immediate profile/XP/SP/rank/progress rendering, every audited mutation wrapper, polling/focus, persistence rehydration, stale response/logout rejection and committed-mutation hydration failure recovery.

## Acceptance criteria

These checks confirm implemented behavior with automated fixtures; they do not claim a deployed production smoke test.

- [x] Every new player starts with neutral empty user icon - native/Google database tests and frontend render.
- [x] Google/provider photo does not override Player Hub avatar - Google/Wix provider metadata and chosen-photo tests.
- [x] Player can upload personal photo - mounted picker/FileReader test, persistence and storage adapter tests; live Cloudinary prerequisites above.
- [x] Player can select default avatar - picker and persisted-source reset tests.
- [x] Player can equip owned AVATAR inventory reward - ownership/equip database tests and picker filtering test.
- [x] Avatar updates immediately - mounted picker/hero/current-player leaderboard tests.
- [x] Avatar survives refresh - repeated canonical DB reads and frontend rehydration.
- [x] Avatar survives logout/login - renewed real sessions/native login plus frontend fresh provider mount; physical devices pending rollout smoke test.
- [x] Display name updates immediately and persists - atomic Rename Card test plus mounted UI/canonical rehydration.
- [x] Country/state persist - database and mounted profile updates.
- [x] Public Player ID remains immutable - strict payload rejection and migration/profile preservation assertions.
- [x] Synapse Points update immediately without refresh - mounted mutation tests and real wallet fixture.
- [x] XP updates immediately without refresh - mounted mutation tests and actual mission claim.
- [x] XP progress bar updates immediately - mounted threshold crossing checks 42% at fixture XP 1500/3600.
- [x] progressionLevel updates immediately - mounted backend level 5 fixture and actual mission threshold crossing.
- [x] Rank updates immediately - mounted Farmer fixture and backend progression assertions.
- [x] Reward purchase balance changes immediately - purchase wrapper/mounted shared state plus actual wallet debit/inventory purchase.
- [x] Reward Wheel balance changes immediately - wheel wrapper/mounted shared state plus existing wheel transaction suite.
- [x] Mission XP/SP rewards update immediately - claim wrapper/mounted shared state plus real mission claim.
- [x] `/api/me` rehydrates the exact persisted state - full snapshot/DB repeated reads and frontend refresh tests.
- [x] No regression to native email auth - full backend/frontend existing auth suites.
- [x] No regression to Google auth - existing issuer/callback/account suites plus avatar decoupling.
- [x] No regression to Player ID sequence - unchanged 0021/sequence logic, migration preservation and existing launch/identity sequence tests.
- [x] No unrelated C4/C5/Admin work included - change review; no responsive/redesign/admin scope.

## Exact changed files

- `backend/drizzle/0022_player_profile_avatar.sql`
- `backend/drizzle/meta/0022_snapshot.json`
- `backend/drizzle/meta/_journal.json`
- `backend/src/db/schema.ts`
- `backend/src/domain/identity.ts`
- `backend/src/domain/inventory.ts`
- `backend/src/domain/playerAvatar.ts`
- `backend/src/domain/playerIdentityActions.ts`
- `backend/src/domain/playerProfile.ts`
- `backend/src/domain/publicProfiles.ts`
- `backend/src/http/app.ts`
- `backend/src/operations/playerLaunchReset.ts`
- `backend/src/server.ts`
- `backend/src/storage/avatarStorage.ts`
- `backend/tests/http.test.ts`
- `backend/tests/playerIdentityMigration.test.ts`
- `backend/tests/playerLaunchReset.test.ts`
- `backend/tests/playerProfile.test.ts`
- `docs/c3-profile-avatar-live-state.md`
- `package.json`
- `src/components/auth/AuthProvider.tsx`
- `src/components/avatar/AvatarPicker.tsx`
- `src/components/game-shell/GameShell.tsx`
- `src/components/hub/HubMetricStrip.tsx`
- `src/components/hub/ProductionHub.tsx`
- `src/components/inventory/InventoryLocker.tsx`
- `src/components/leaderboard/LeaderboardPlayerIdentity.tsx`
- `src/components/leaderboard/PublicPlayerProfileModal.tsx`
- `src/components/missions/MissionExplorer.tsx`
- `src/components/player/AvatarFrame.tsx`
- `src/components/player/PlayerIdentityPanel.tsx`
- `src/components/player/PlayerLobbyHeader.tsx`
- `src/components/player/PlayerProfileView.tsx`
- `src/components/player/ProfileEditor.tsx`
- `src/components/player/PublicProfileView.tsx`
- `src/components/progression/ProgressionCodex.tsx`
- `src/components/rewards/StoreExplorer.tsx`
- `src/components/settings/SettingsPanel.tsx`
- `src/components/ui.tsx`
- `src/config/assets.ts`
- `src/lib/apiClient.ts`
- `src/stores/playerLiveState.test.mjs`
- `src/stores/playerUiState.ts`
- `src/types/index.ts`
