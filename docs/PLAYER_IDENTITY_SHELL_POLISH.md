# Player identity, desktop shell and Hub atmosphere

This change is limited to public Player IDs, the existing GameShell layout, and `/hub` presentation. Internal player/user UUIDs, authentication, ownership, gameplay rules and business integrations do not change.

## Permanent public Player IDs

New IDs are `<verified-email-local-part>_<player-number>`. For example, `Hazel@gmail.com` with number 1 becomes `hazel_001`, and number 1000 becomes `hazel_1000`.

The database derives the prefix from `users.verified_email` only when `email_verified_at` is present. It trims the email, checks for exactly one nonempty local/domain part without whitespace, replaces runs of non-ASCII-alphanumeric characters in the local part with `_`, strips surrounding underscores, lowercases ASCII letters, limits the prefix to 64 characters and trims any resulting trailing underscore. An unusable local part, malformed/missing email or unverified email becomes `player`. The email domain is never included. The same formatter is covered in TypeScript/SQL parity tests.

`players.player_number` is a positive, uniquely indexed PostgreSQL `bigint GENERATED ALWAYS AS IDENTITY` backed by `players_player_number_seq`, starting at 1 with increment 1, cache 1 and no cycle. A before-insert trigger creates `public_player_id` from that assigned number and verified email in the same insertion; callers cannot choose a public ID. `createPlayer()` uses `INSERT ... RETURNING` inside its caller's existing transaction. The original unique public ID index is retained. Both issued fields are protected by an update trigger. Display-name/avatar/email changes do not regenerate IDs.

Numbers are never recycled by account deletion, suspension, failed insertion, rollback or an insertion conflict. Gaps are expected for failed/conflicting transactions, rather than promising gapless numbering. Never reset/restart this sequence or use `TRUNCATE ... RESTART IDENTITY` in a live database. Application code does not count players or calculate a maximum to allocate a number.

## Existing-player migration and manual rollout

**Production launch exception:** the current 12 production players are confirmed disposable tests. For that launch, use `docs/PRODUCTION_PLAYER_LAUNCH_RESET.md` and its explicit reviewed operator reset BEFORE 0021 instead of the backfill procedure below. It leaves the table empty and the first real allocation at 1. The general backfill remains appropriate for databases whose existing players must survive. Do not run both rollout procedures.

Migration: `backend/drizzle/0021_sequential_player_identity.sql`, with the corresponding Drizzle journal and `0021_snapshot.json`.

All existing players, including suspended/deleted users, are ordered by **`players.created_at ASC, players.player_id ASC`**. `row_number()` assigns 1..N deterministically; `last_login_at` and display name are irrelevant. A safe temporary ID namespace lets all public IDs change in two phases without dropping their unique index or colliding with old IDs that already equal a proposed ID. Missing/unverified/unusable legacy emails become `player_<number>`; these do not block migration. An orphaned user relation or preexisting reserved migration namespace does block migration before any player row is changed.

The migration locks users, players and Rename Card replay records, preserves all UUIDs/ownership links and player timestamps, updates only public IDs/numbers and copied replay metadata, sets the new sequence above the migrated maximum (or to an uncalled 1 for an empty table), and asserts reconciliation before committing. Do not split its statements into independent autocommit operations: its locks and temporary map require one transaction. The Drizzle PostgreSQL migrator already wraps pending migrations in a transaction.

Manual steps, after review:

1. Back up the target database. Confirm migrations through 0020 are already applied. Prepare the reviewed backend/frontend build together; older public-profile validators do not recognize the new IDs.
2. Pause backend writes/registrations and gameplay mutations for the maintenance window. This avoids mixed-version reads and lock contention during backfill. Do not run the old backend while migrating.
3. Run `docs/player-identity-preflight.sql` against the explicitly selected target database. Save its total count and complete UUID/old/new-ID mapping. Duplicate proposed numbers/IDs, missing user relations and reserved namespace conflicts must be zero. Review the explicitly listed fallback players; do not invent ownership evidence or change their auth state.
4. From `backend`, have an operator run `npm run db:migrate` with the intended database connection. This applies the checked-in migration and records it in Drizzle's journal. No production migration is run by this development task. Avoid applying the SQL manually and then running Drizzle again without reconciling its journal.
5. With writes still paused, run `docs/player-identity-postflight.sql`. Compare total rows, UUIDs and the new mapping with saved preflight output. Every player must have one positive unique number and unique public ID. All missing-relations, temporary-ID and stale replay-ID counts must be zero. The next sequence value must be migrated maximum + 1; the audit deliberately avoids `nextval()`.
6. Deploy the matching reviewed application build manually, then resume writes. Verify a fresh registration and authenticated public profile/leaderboard lookup. Do not roll back only the application to its old ID validator; use the saved backup/mapping and a reviewed recovery plan if rollback is needed.

Previously shared `/profile/CZ-...` links stop resolving to the migrated player. There is no alias table or redirect in this scope. Legacy syntax remains accepted for lookup during rollout/test fixtures, but it cannot select a different player and does not alias a new ID. Profile lookups still enforce authentication and active-user status.

## Public-ID audit

- Database: `players.public_player_id` is the only relational public-ID column. Sessions/identity links use `user_id`; gameplay, submissions, progression, wallets, inventory, missions, leaderboard entries and reward records use internal `player_id` UUIDs.
- Denormalized runtime reference: `inventory_consumptions.metadata.publicPlayerId` for Rename Card idempotent responses. Migration updates that key using the owning internal UUID, preserving other metadata, quantities, record IDs, keys and timestamps. Game-event payloads created by this action contain display names/consumption details, not public IDs; they remain untouched. Arbitrary historical JSON annotations are not identity foreign keys and are not rewritten.
- Backend readers: `domain/identity.ts` (session/auth DTOs), `gameState.ts` (profile), `leaderboards.ts`, `publicProfiles.ts`, `adminSubmissions.ts`, `playerIdentityActions.ts`; all authoritative identity displays join/read the player row except the migrated Rename Card replay metadata.
- HTTP: `http/app.ts` validates `/api/players/:publicPlayerId/public-profile` with bounded new/legacy syntax. Mutations that reject client-supplied identity fields retain those checks. Native auth obtains player creation through the same shared insert without changing its security flow.
- Frontend: `types/index.ts`, `lib/apiClient.ts`, `services/index.ts`; identity panels, profile pages and leaderboard/Hub links; `components/ui.tsx`, `components/social/social.tsx`, friend pages and `/ui-lab` use IDs as display/search keys or profile URL segments. These are safe ASCII route segments. Friend-search placeholder now describes a Player ID rather than the retired format. Social services, mock data, historical docs and development-only fixture overrides are not production identity allocators. Real database creation ignores requested development fixture IDs.
- No SQL foreign keys or leaderboard rows point at the public text ID. Old IDs in historical documentation describe past operations and are not current lookup references.

## Desktop shell

The old root had a minimum viewport height and grew with long content, allowing document scroll to carry the sidebar with it. At the existing `lg` breakpoint, the root is now exactly `100dvh` with overflow contained. The sidebar is a non-scrolling flex sibling; its brand/footer do not shrink, and only its navigation region scrolls when necessary. The main column has a fixed top bar outside its independent scroll area. Both the nav and content use `min-height: 0` to allow proper flex shrinking.

Below `lg`, document scrolling, the sticky top bar, bottom navigation, More sheet and bottom padding remain. The main scroll region is keyboard-focusable and labelled. Browser zoom can move the layout into the existing mobile breakpoint rather than forcing a desktop sidebar into an unusably narrow viewport.

## Hub atmosphere and media

Only exact pathname `/hub` receives `HubAtmosphere` and the `cz-hub-dashboard` modifier; other routes retain their current background/surfaces. The background sits behind the top bar/content, ignores pointer events, has no layout size of its own, and uses a static aqua/violet/gold atmospheric fallback, optional image/video, dark readability overlay and ambient gradients. Scoped CSS overrides `.cz-surface`, `.cz-raised` and `.cz-inset` only inside dashboard `main`; backgrounds remain predominantly opaque, with restrained borders/shadows and 12px backdrop blur on primary surfaces.

Future assets:

- `public/media/hub-background.mp4` → `/media/hub-background.mp4`
- `public/media/hub-background-poster.jpg` → `/media/hub-background-poster.jpg`

Set the two nullable paths in `src/config/hubMedia.ts` after supplying these files. They default to `null`, so the current build makes no missing-media requests. The static fallback is complete without either asset. Images use Next Image; video uses autoplay, muted, loop, playsInline, preload none, no controls, decorative semantics and cover positioning. Reduced motion renders only poster/static atmosphere; preference changes are honored live. Video load/play errors and poster errors return to the static atmosphere without interrupting dashboard behavior.

## Validation

Backend tests execute historical migrations and the real new migration on ephemeral embedded PostgreSQL, never the configured production database. They cover sanitization/SQL parity, deterministic ties/backfill collisions, preserved UUIDs/session/wallet/replay records, sequence advancement/concurrent inserts/non-reuse, permanence and public-profile route validation. Frontend DOM tests cover Hub-only scoping, shell structure, mobile More navigation, poster/media/autoplay failure and reduced motion. Browser layout checks complement DOM tests for actual scrolling and responsive sizing.

The backend suite passed 744 tests across 40 files with `npm test -- --maxWorkers=2`; unrestricted parallelism first caused an existing webhook test's five-second startup timeout. The frontend suite passed all 88 tests. Backend lint, typecheck and build passed; frontend lint and build passed.

Local Chrome layout checks used the actual shell/dashboard markup and built CSS. At desktop widths 1440 and 2560, the document stayed one viewport tall while main content scrolled 500 pixels and the sidebar remained at top 0. At 1440×400, navigation scrolled independently and the footer remained visible. At mobile 390×844, tablet 768×1024, and a 200%-zoom-equivalent 960×540 CSS viewport, bottom navigation and content padding remained available without horizontal overflow. The zoom check used equivalent viewport/device scaling rather than changing Chrome's zoom control. `/puzzles` retained its opaque surfaces with no Hub atmosphere.
