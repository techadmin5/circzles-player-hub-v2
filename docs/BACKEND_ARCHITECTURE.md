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
