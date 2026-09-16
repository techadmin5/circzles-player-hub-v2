# Backend Architecture Blueprint

## Scope

This is a design-only blueprint for the future CircZles Player Hub V2 backend. It does not provision infrastructure, install backend frameworks, create migrations, or implement production code.

## Current Frontend Contracts Inspected

The frontend currently depends on Promise-based service facades in `src/services/index.ts`:

- `playerService.getCurrentPlayer()`
- `playerService.getProfile(playerId)`
- `playerService.renameDisplayName(displayName)`
- `puzzleService.getOwnedPuzzles()`
- `puzzleService.getPuzzle(id)`
- `puzzleService.claimByCode(code)`
- `submissionService.getSubmissions()`
- `submissionService.getSubmission(id)`
- `submissionService.createSubmission(input)`
- `leaderboardService.getLeaderboard(filters)`
- `missionService.getMissions()`
- `missionService.claimMission(missionId)`
- `storeService.getItems()`
- `storeService.purchaseItem(itemId)`
- `inventoryService.getInventory()`
- `inventoryService.equipItem(itemId)`
- `couponService.getCoupons()`
- `activityService.getActivity()`
- `friendService.getFriends()`
- `friendService.searchPlayers(query)`
- `friendService.sendRequest(playerId)`
- `friendService.getRequests()`
- `notificationService.getNotifications()`
- `notificationService.markAllRead()`
- `seasonService.getCurrentSeason()`
- `rewardService.spinWheel()`
- `adminService.*`

These boundaries are good. The backend should replace service implementations without requiring frontend redesign.

## Target Architecture

- CircZles Player Hub V2 is not a standalone dashboard. It is the gamification engine for the entire CircZles ecosystem.
- Frontend: Next.js App Router, deployed separately at `dashboard.circzles.in`.
- Backend: Node.js + TypeScript HTTP API.
- Database: PostgreSQL as authoritative game-state database.
- Object storage: Cloudinary is suitable for submission videos. Keep the storage boundary abstract enough that PostgreSQL stores only media references and metadata.
- Auth: V2 session established through a secure Wix member bridge proof of concept.
- Realtime: future-ready event and notification model, no realtime requirement for first backend release.
- Wix: retained for main website, existing member identity bridge, commerce integration, reviews/forms where useful, and optional coupon integration. Wix CMS must not remain authoritative for game state.

## Ecosystem Role

V2 must support secure interaction between:

- `circzles.in`
- `dashboard.circzles.in`
- Fastify backend
- PostgreSQL
- Cloudinary
- future commerce integrations
- future review/form integrations

The same player identity must be usable across the website, dashboard, future commerce, reviews, and website quests. Website-originated missions and dashboard-originated missions should feed the same future game-event and mission engine.

Examples of ecosystem event sources:

- Website: `website.page_visited`, `website.gem_found`, `website.quest_completed`, `website.review_submitted`, `website.cta_completed`
- Dashboard: `player.login`, `puzzle.added`, `submission.created`, `submission.approved`, `wheel.spun`, `store.purchase`, `friend.added`
- Commerce: `order.created`, `puzzle.purchased`, `coupon.used`

The backend must validate valuable events before rewarding them. Browser JavaScript may request or report an interaction, but it must not be authoritative for rewards.

## Bounded Contexts

- Identity: users, players, Wix member mappings, sessions, roles.
- Puzzle Ownership: puzzle catalog and player-puzzle ownership.
- Submissions: upload metadata, submission lifecycle, review.
- Economy: Synapse Point ledger and cached wallet balance.
- XP/Progression: XP ledger and progression level state.
- Leaderboards: best approved times per ranking scope.
- Missions: event-driven rule evaluation and reward claims.
- Store/Inventory/Coupons: purchasable and reward-granted assets.
- Social: friends, requests, blocks.
- Notifications/Activity: persistent user-facing history and alerts.
- Admin: role-protected operations and audit logs.
- Migration: Wix CMS extraction, transformation, validation, and cutover.

## Identity Decision

Use separate `users` and `players` tables.

Reason:

- `users` represents authentication and account ownership.
- `players` represents game identity, public player ID, display name, progression, region, and social presence.
- A user may eventually have admin permissions, auth sessions, linked providers, and operational state that should not be mixed into the public player profile.

Relationship:

`Wix Member -> users -> players`

Existing Wix members map to `users.wix_member_id`. Each ordinary player user has one primary `players` row for first release.

## Canonical Domain Rules

- `levelId` is the puzzle difficulty/challenge identifier. It belongs to puzzle/submission/leaderboard contexts.
- `progressionLevel` is player RPG/XP progression. It belongs to progression contexts.
- `internalId` maps to database UUIDs.
- `publicPlayerId` is permanent, unique, searchable, and not changed by Rename Cards.
- `displayName` is renameable and may change through a Rename Card or profile settings.
- `puzzleId` is the stable playable puzzle variant UUID. A design/name may have multiple playable variants with separate ownership, submissions, and leaderboards.
- Physical puzzle claim codes use the final hyphen segment as the serial and everything before it as the prefix. Code prefixes map to playable puzzle variants; serials are recorded only when claimed.

## Provider Boundaries

Keep provider-specific integrations behind interfaces:

- `AuthBridgeProvider` for Wix member proof/exchange.
- `ObjectStorageProvider` for Cloudinary signed uploads, Cloudinary URL/reference storage, and playback URLs.
- `CommerceProvider` for future Wix coupon/checkout operations.
- `ReviewProvider` for future verified review/form events.
- `WebsiteEventProvider` for website quest and CTA events from `circzles.in`.
- `EventPublisher` for future realtime notifications.

## Submission Media Flow

The intended submission media flow remains:

1. Player uploads video.
2. Cloudinary stores the video.
3. Cloudinary URL/reference is returned.
4. PostgreSQL stores only the Cloudinary URL/reference and submission metadata.
5. Admin manually reviews the submission.
6. Approved submission feeds leaderboard and reward processing.

## Backend Modules

- `auth`
- `users`
- `players`
- `puzzles`
- `submissions`
- `leaderboards`
- `missions`
- `economy`
- `progression`
- `store`
- `inventory`
- `coupons`
- `wheel`
- `friends`
- `notifications`
- `activity`
- `admin`
- `migration`

## Phase 3G-A Reward Catalog Boundary

`RewardCatalogService` owns the read-only store catalog contract and delegates persistence to `RewardCatalogRepository`. The Drizzle adapter joins active listings to active canonical reward definitions, applies backend-time availability rules, and returns a safe DTO without internal metadata. The authenticated HTTP route remains thin and does not accept player, price, ownership, or reward-grant authority from the browser.

Reward definition and store availability are separate concerns. Later purchase processing must lock and validate the authoritative listing, debit the wallet, and create inventory or consumable grant history in one transaction; Phase 3G-A deliberately implements none of those mutations.

## Phase 3G-B Store Purchase Boundary

`StorePurchaseService` validates operation identity and delegates the atomic operation to `StorePurchaseRepository`. The Drizzle repository serializes exact keys with a transaction advisory lock, takes shared row locks on canonical listing/reward configuration, then locks the player's wallet before checking limits. Paid operations reuse the shared point-ledger debit helper; free operations lock/read the wallet without creating a zero-value ledger record.

Purchase history and `store.purchase.completed` are written in the same transaction as the debit. The point ledger remains financial authority; `store_purchases` supplies business/audit snapshots and purchase-limit evidence.

## Phase 3G-C Inventory Boundary

`grantInventoryItemInTransaction` is the reusable, source-neutral entitlement engine. It validates supported reward types, serializes a player's reward row, enforces player-scoped idempotency and immutable-payload replay, appends `inventory_grants`, updates `player_inventory_items`, and emits `inventory.item.granted` in its caller's transaction.

Store purchase now validates unique ownership before charging and performs debit, purchase history, entitlement, current Inventory update, and both semantic events in one transaction. A failed grant rolls back every effect. Exact purchase replay returns purchase history before executing another grant.

`InventoryService` exposes authenticated list, equip, and unequip operations. Equipment changes serialize per player, validate owned positive-quantity items against explicit slots, and emit their event with the mutation. Public profiles project only the equipped Avatar image, Frame name, and three Badge names in slot order; quantities, grants, purchases, and metadata remain private.

API mode uses authoritative Inventory and Store responses with no mock fallback. The purchase response's `balanceAfter` replaces the displayed SP balance exactly. Rename Cards are visible and stackable but cannot be consumed until Phase 3G-D; Coupons are visible and stackable but cannot be redeemed or bridged to Wix yet.

## Operations Requiring Database Transactions

- Store purchase
- Reward wheel spin
- Submission approval/rejection/resubmission request
- Mission claim
- Level/rank reward grant
- Rename Card use
- Coupon grant
- Admin point/XP correction
- Friend request acceptance
- Puzzle claim by physical code

Each operation must commit or roll back all resulting ledgers, inventory grants, mission progress, leaderboard updates, notifications, and audit records together.

Phase 3F-A applies this rule to the internal append-only `game_events` stream. Existing authoritative producers write events through the same Drizzle transaction as puzzle ownership, submissions, reviews, PBs, points, XP, and progression changes. There is no public event-write API; future external ingestion requires a separately authenticated and validated boundary.

Phase 3F-B adds a data-driven mission evaluator and per-period player progress. A lightweight server-owned runner processes locked event batches without overlapping local ticks. Evaluation, capped progress, completion-event emission, and source-event acknowledgement share one transaction. Mission reads are authenticated; claims and reward grants remain separate Phase 3F-C authority.

Phase 3F-C adds authenticated mission claiming without adding browser reward authority. The claim transaction derives the current period, locks the player's progress, validates active persisted XP/SP rewards, reserves an immutable claim snapshot, writes deterministic reward ledgers, marks progress claimed, and emits `mission.claimed`. Player-scoped request idempotency and database uniqueness make retries replayable and concurrent claims single-grant. Frontend claim controls remain deferred.

## Frontend Contract Recommendations

No immediate frontend changes are required before backend implementation.

Recommended DTO refinements before production API wiring:

- Rename `Puzzle.id`, `Submission.id`, `StoreItem.id`, etc. at API boundary to stable UUID-backed ids while preserving frontend-friendly `id` fields in DTOs.
- Add explicit `wallet` and `xp` response DTOs for post-action state refreshes.
- Add optional `requestId` and `serverTime` to action responses.
- Add `videoUploadId` to the submission creation flow once signed uploads are introduced.

## Phase 3D Video Boundary

`SubmissionService` coordinates persistence and the `VideoStorage` interface. `CloudinaryVideoStorage` is the production adapter and uses the official Cloudinary Node SDK for signed upload parameters and authoritative asset lookup. Missing Cloudinary configuration does not prevent backend startup; only signing/finalization returns `VIDEO_STORAGE_NOT_CONFIGURED`.

The browser uploads directly to Cloudinary using a backend-generated public ID. It then asks the backend to finalize the upload. Submission creation joins the authenticated player's active `player_puzzles` row to the canonical puzzle, derives `puzzleId` and `levelId`, requires a `COMPLETE` upload owned by that player, and writes `PENDING_REVIEW` without XP, points, rewards, or leaderboard effects.

Optional environment variables are `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`. The secret remains backend-only and is covered by the rule against secret logging.

## Phase 3E-A Competition Configuration

Puzzle difficulty `levelId` supports one decimal place through PostgreSQL `NUMERIC(4,1)` on canonical puzzles and submission snapshots. Drizzle maps both columns in number mode, and DTO adapters explicitly return JavaScript numbers. `progressionLevel` remains an unrelated integer XP/RPG concept.

`puzzle_competition_settings` has exactly one row per canonical `puzzleId`. Its explicit `MAIN_LEVEL` or `SIDE_QUEST` category drives future tabs; category is never inferred from `.5`. Active, leaderboard-enabled rows are listed predictably by category and `displayOrder`. Future trusted admin operations may use the internal repository/service upsert boundary, but Phase 3E-A exposes no mutation route.

Reward authority lives in persisted settings through `rewardEnabled`, `synapseReward`, and `xpReward`. The Level 1-10 preset is an editable bootstrap helper for future admin use and is not attached to development puzzles or consulted by runtime reward logic. Side Quest rewards have no preset and must be configured independently.

## Phase 3E-B1 Admin Review Foundation

Admin authorization extends the existing cookie-session model. The backend hashes the session token and requires an active, unexpired, non-revoked `auth_sessions` row, an `ACTIVE` user, and an active `admin_users` row linked by `user_id`. Missing or invalid authentication returns `UNAUTHORIZED`; a valid non-admin, inactive admin, or insufficient role returns `FORBIDDEN`.

Roles map to permissions in backend code: `REVIEWER` has `SUBMISSIONS_REVIEW`; `SUPER_ADMIN` has `SUBMISSIONS_REVIEW` and `COMPETITION_CONFIG`. Routes request permissions rather than trusting role, user, player, or admin values from the browser.

Phase 3E-B1 initially implemented a read-only admin surface: submission queue and detail queries expose public player identity and review-relevant puzzle, run, timing, status, player-puzzle, and video metadata. The queue defaults to pending review, supports bounded filters, and orders oldest first with submission UUID as a deterministic tie-breaker. Phase 3E-D later adds the secured review mutation after completing atomic reward and PB processing.

## Phase 3E-C Internal Review Engine

`SubmissionReviewService` is a trusted internal boundary; it is not connected to an HTTP mutation route. Its repository locks the submission and performs review history insertion, status transition, first-completion reward snapshot, ledger credits, and ledger-reference persistence in one PostgreSQL transaction. Any failure rolls back status, history, grant, ledgers, wallet, and progression cache together.

The base completion reward is processed once per `(playerId, canonical puzzleId)`, enforced by `submission_reward_grants`. The first approved solve always creates a snapshot. Only an active persisted `puzzle_competition_settings` row with `rewardEnabled=true` supplies runtime SP and XP values; presets are never runtime authority. Missing, inactive, disabled, and zero-value settings produce a disabled/zero snapshot and no zero-value ledger transactions.

The first-completion insert is the concurrency arbiter. Only the transaction that inserts the unique player/puzzle grant may award ledgers. SP and XP use the existing wallet/progression locks and ledger algorithms through transaction-aware helpers with deterministic player-scoped idempotency keys. Later approved solves retain review history but cannot replace or repeat the first-completion reward.

Review idempotency is scoped to reviewer and key. Exact payload replay returns the original logical result; mismatched reuse and new decisions for reviewed submissions fail with controlled conflicts. Leaderboard entries, PB processing, ranking, and the review POST route remain deferred to Phase 3E-D.

## Phase 3E-D All-Time Leaderboards

`leaderboard_entries` stores one PB per `(playerId, canonical puzzleId)` and never stores rank. Every approved submission is processed inside the existing review transaction regardless of current leaderboard visibility. An atomic PostgreSQL upsert replaces the PB only when the candidate tuple is lower: completion milliseconds, database review timestamp, submission timestamp, then submission UUID. Uniqueness and the conditional upsert make concurrent fast/slow approvals converge on the actual best result.

First-completion rewards and PBs remain independent. The first approved solve may create one immutable reward grant; every later approved solve can improve the PB without another base reward. Rejection and resubmission decisions create neither PBs nor rewards. A PB failure rolls back review history, status, reward snapshot, ledgers, caches, and PB together.

Catalog visibility uses active, leaderboard-enabled persisted competition settings joined to active, non-deleted puzzles. It never infers category from fractional `levelId`. Ranking reads exact milliseconds and orders by time, approval, submission timestamp, and submission UUID. The API returns only the top 10 plus the authenticated player's real rank when outside that set.

The secure admin review POST route now derives reviewer identity from `SUBMISSIONS_REVIEW` authorization, requires strict input and idempotency, and invokes the atomic review engine. Seasons, regional/friend boards, cosmetics, and frontend leaderboard UI remain deferred.
