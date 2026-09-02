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
- `puzzleService.claimBySku(sku)`
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

- Frontend: Next.js App Router, deployed separately at `dashboard.circzles.in`.
- Backend: Node.js + TypeScript HTTP API.
- Database: PostgreSQL as authoritative game-state database.
- Object storage: provider-independent video/object storage abstraction.
- Auth: V2 session established through a secure Wix member bridge proof of concept.
- Realtime: future-ready event and notification model, no realtime requirement for first backend release.
- Wix: retained for main website, existing member identity bridge, commerce integration, and optional coupon integration. Wix CMS must not remain authoritative for game state.

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

## Provider Boundaries

Keep provider-specific integrations behind interfaces:

- `AuthBridgeProvider` for Wix member proof/exchange.
- `ObjectStorageProvider` for signed uploads and playback URLs.
- `CommerceProvider` for future Wix coupon/checkout operations.
- `EventPublisher` for future realtime notifications.

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
- Puzzle claim by SKU

Each operation must commit or roll back all resulting ledgers, inventory grants, mission progress, leaderboard updates, notifications, and audit records together.

## Frontend Contract Recommendations

No immediate frontend changes are required before backend implementation.

Recommended DTO refinements before production API wiring:

- Rename `Puzzle.id`, `Submission.id`, `StoreItem.id`, etc. at API boundary to stable UUID-backed ids while preserving frontend-friendly `id` fields in DTOs.
- Add explicit `wallet` and `xp` response DTOs for post-action state refreshes.
- Add optional `requestId` and `serverTime` to action responses.
- Add `videoUploadId` to the submission creation flow once signed uploads are introduced.
