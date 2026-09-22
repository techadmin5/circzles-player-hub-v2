# API Contracts Blueprint

## General Rules

- Authenticated player endpoints infer the player from the session.
- Frontend must not send authoritative costs, balances, XP, rewards, rank, or player identity.
- Responses use frontend-friendly DTO fields compatible with current `src/types`.
- All mutation endpoints accept optional `Idempotency-Key` header.

## Error Format

```json
{
  "code": "INSUFFICIENT_POINTS",
  "message": "Not enough Synapse Points.",
  "details": {},
  "requestId": "req_..."
}
```

Common codes:

- `UNAUTHORIZED`
- `FORBIDDEN`
- `VALIDATION_FAILED`
- `NOT_FOUND`
- `PUZZLE_CODE_INVALID`
- `PUZZLE_ALREADY_OWNED`
- `SUBMISSION_ALREADY_APPROVED`
- `INSUFFICIENT_POINTS`
- `ITEM_ALREADY_OWNED`
- `ITEM_UNAVAILABLE`
- `MISSION_NOT_COMPLETE`
- `MISSION_ALREADY_CLAIMED`
- `DUPLICATE_FRIEND_REQUEST`
- `SELF_FRIEND_REQUEST`
- `RATE_LIMITED`

## Frontend Service Mapping

| frontend service | endpoint |
|---|---|
| `playerService.getCurrentPlayer()` | `GET /api/me` |
| `playerService.getPublicProfile(publicPlayerId)` | `GET /api/players/:publicPlayerId/public-profile` |
| `playerService.renameDisplayName(displayName)` | `POST /api/me/display-name` |
| `puzzleService.getOwnedPuzzles()` | `GET /api/me/puzzles` |
| `puzzleService.getPuzzle(id)` | `GET /api/puzzles/:puzzleId` |
| `puzzleService.claimByCode(code)` | `POST /api/puzzles/claim` |
| `submissionService.getSubmissions()` | `GET /api/submissions` |
| `submissionService.getSubmission(id)` | `GET /api/submissions/:submissionId` |
| `submissionService.createSubmission(input)` | `POST /api/submissions` |
| `leaderboardService.getLeaderboard(filters)` | `GET /api/leaderboards` |
| `missionService.getMissions()` | `GET /api/missions` |
| `missionService.claimMission(missionId)` | `POST /api/missions/:missionId/claim` |
| `storeService.getItems()` | `GET /api/store/items` |
| `storeService.purchaseItem(itemId)` | `POST /api/store/items/:itemId/purchase` |
| `inventoryService.getInventory()` | `GET /api/inventory` |
| `inventoryService.equipItem(itemId)` | `POST /api/inventory/:inventoryItemId/equip` |
| `couponService.getCoupons()` | `GET /api/me/coupons` |
| `activityService.getActivity()` | `GET /api/activity` |
| `friendService.getFriends()` | `GET /api/friends` |
| `friendService.searchPlayers(query)` | `GET /api/players/search?q=` |
| `friendService.sendRequest(playerId)` | `POST /api/friends/requests` |
| `friendService.getRequests()` | `GET /api/friends/requests` |
| `notificationService.getNotifications()` | `GET /api/notifications` |
| `notificationService.markAllRead()` | `POST /api/notifications/mark-all-read` |
| `seasonService.getCurrentSeason()` | `GET /api/seasons/current` |
| `rewardService.spinWheel()` | `POST /api/wheel/spin` |

## Important Endpoints

### GET /api/me

Authentication: required.

Response: current player profile DTO with `internalId`, `publicPlayerId`, `displayName`, rank, `progressionLevel`, XP, wallet balance, streak, badges, and stats.

Authority: server derives player from session.

Phase 3B status: `progressionLevel`, `rank`, `xp`, `xpNeeded`, and `synapsePoints` are backed by PostgreSQL progression/wallet state for real authenticated API responses. Profile cosmetics, badges, streak, and gameplay stats may still use explicit temporary defaults until their backend systems exist.

### Development-only game-state endpoints

These endpoints exist only for local verification and must return `FORBIDDEN` in production:

- `POST /api/dev/xp/grant`
- `POST /api/dev/points/credit`
- `POST /api/dev/points/debit`

Each endpoint derives the player from the authenticated session cookie. The request body may include `amount`, `reason`, optional `idempotencyKey`, and optional `metadata`; it must not include `playerId`, `internalId`, or `publicPlayerId`.

These routes use the same internal XP/economy services as future trusted backend systems. They are not production reward APIs.

### POST /api/puzzles/claim

Phase 3C status: implemented for authenticated player code claims.

Authentication: required. The backend derives the player from the session cookie.

Request:

```json
{ "code": "CC-11-18-R1-001" }
```

The request body must not include `playerId`, `internalId`, `publicPlayerId`, `puzzleId`, or `levelId`. The browser is not authoritative for ownership.

Response:

```json
{
  "success": true,
  "puzzle": {
    "id": "puzzle uuid",
    "name": "Metamorphosis",
    "runCode": "R1",
    "pieceCount": 121,
    "sizeLabel": "Standard",
    "levelId": 18,
    "image": "/puzzles/placeholder.svg",
    "description": "Playable puzzle variant",
    "status": "OWNED"
  }
}
```

Errors: `PUZZLE_CODE_INVALID`, `PUZZLE_CODE_ALREADY_CLAIMED`, `PUZZLE_ALREADY_OWNED`, `UNAUTHORIZED`, `VALIDATION_FAILED`.

Transaction: parse and normalize code, find active prefix, verify physical unit is unclaimed, verify current player does not already own the playable `puzzle_id`, insert `puzzle_claims`, insert `player_puzzles`, then commit both or neither. Future `puzzle.added` game-event processing must be emitted from trusted backend code, not from browser-supplied identifiers.

Physical code rule: the final hyphen segment is the serial; everything before the final hyphen is the prefix. The serial is digits only, must be greater than zero, and is stored as `bigint`. `CC-11-18-R1-001` and `CC-11-18-R1-1` represent the same physical unit.

### GET /api/me/puzzles

Phase 3C status: implemented.

Authentication: required. Returns only puzzle ownership for the current session player.

Response: array of player puzzle DTOs.

### GET /api/puzzles/:puzzleId

Phase 3C status: implemented.

Returns one playable puzzle variant by stable `puzzle_id`. `levelId` remains the puzzle difficulty/challenge identifier.

### POST /api/submissions

Request:

```json
{
  "playerPuzzleId": "uuid",
  "completionTimeMs": 83400,
  "videoUploadId": "uuid"
}
```

Response: submission DTO with `PENDING_REVIEW`.

Server authority: validates ownership and derives `puzzleId` and `levelId`.

### POST /api/uploads/videos/signed-url

Request: filename, size bytes, MIME type.

Response: `videoUploadId`, signed upload URL, object key, expiry.

Server authority: validates file constraints and storage key.

### POST /api/admin/submissions/:submissionId/review

Phase 3E-D status: implemented.

Authentication: admin permission required.

Request:

```json
{ "decision": "APPROVED", "reviewNote": "Clear solve." }
```

Idempotency: required through `Idempotency-Key`.

Transaction: insert review history, update submission status, process the one-time first-completion reward and ledgers, and update the all-time PB together. Missions, notifications, and broader audit logging remain future work.

Errors: `SUBMISSION_ALREADY_REVIEWED`, `IDEMPOTENCY_CONFLICT`, `FORBIDDEN`, `VALIDATION_FAILED`.

The route derives the reviewer from admin authorization and requires `Idempotency-Key`. It never accepts player, puzzle, reward, XP, SP, role, permission, reviewer, or target status as browser authority.

### GET /api/leaderboards/catalog

Authentication: current player session required.

Returns `mainLevels` and `sideQuests` from active, leaderboard-enabled competition settings joined to active, non-deleted canonical puzzles. Items expose only puzzle ID/name, run code, fractional-compatible `levelId`, explicit category, and display order.

### GET /api/leaderboards

Phase 3E-D requires authenticated `puzzleId=<canonical UUID>` and rejects additional filters. The configured leaderboard must currently be visible. Returns the puzzle, top 10 rows, and the authenticated player's real ranked row only when outside the top 10. Ranks use exact milliseconds and deterministic approval/submission ordering and are never persisted or calculated by the frontend. Country, state, friends, seasons, and period filters remain deferred.

### GET /api/players/:publicPlayerId/public-profile

Authentication: current player session required.

Phase 3E-F looks up an active player by validated `publicPlayerId` and returns only:

- `publicPlayerId`
- `displayName`
- `progressionRank`
- `approvedPuzzlesSolved`
- `avatarUrl`
- `equippedFrame`
- `displayedBadges`

`approvedPuzzlesSolved` counts distinct canonical `puzzleId` values from approved submissions. Duplicate approved attempts count once, and pending, rejected, or resubmission-required attempts do not count. Unknown, suspended, and deleted players return `PLAYER_NOT_FOUND`.

Until authoritative cosmetic systems exist, `avatarUrl` and `equippedFrame` are `null`, and `displayedBadges` is empty. The endpoint never exposes internal user/player IDs, email, Wix identity, session data, admin data, XP history, wallet balance, or private location.

### POST /api/missions/:missionId/claim

Phase 3F-C status: implemented and authenticated.

Request: a canonical mission UUID in the path, mandatory `Idempotency-Key` header (maximum 200 characters), and no authoritative body fields. An empty JSON object is tolerated, but player, period, progress, reward, XP, and Synapse Point values are rejected.

Server authority: derives the player and current UTC period, validates that the mission is currently available, locks the current progress row, requires `CLAIMABLE`, and reads active persisted reward configuration. Only positive XP and Synapse Point rewards are supported in this phase.

Transaction: reserve one immutable claim, aggregate and snapshot configured rewards, grant point/XP ledgers with deterministic keys and source type `MISSION_REWARD`, mark progress `CLAIMED`, and emit `mission.claimed`. All writes commit or roll back together. Exact same-key retries return the original claim result; cross-mission key reuse conflicts, and a second logical claim for the same player/mission/period is rejected.

Response: claim id, mission id, period key, claimed timestamp, awarded XP/SP totals, current game-state DTO, and an `idempotent` replay indicator. Internal player and ledger identifiers are not exposed.

Phase 3F-D frontend integration calls this endpoint only from the browser. It generates one UUID idempotency key for a logical claim and retains that key for retries while the claim remains unresolved. The browser sends an empty object and never supplies player identity, period, progress, or reward values. Successful results retain authoritative awarded totals and player state for the deferred Phase 3F-E feedback system.

### GET /api/missions

Phase 3F-B status: implemented and authenticated. The backend derives the player from the session and returns `{ missions: [...] }` containing current active mission identity, category, explicit period type/key, authoritative or zero-default progress, `claimable`, optional dates, and XP/Synapse Point reward previews. It never accepts or exposes an internal player ID. Reward previews are configuration only; no claim or grant occurs.

Phase 3F-D frontend status: API mode loads this endpoint in a client explorer with loading, retryable error, and valid empty states; it never falls back to mock missions after an API failure. Mock mode continues using local demo missions. Remaining-time labels are derived from `endsAt` for display only and do not determine eligibility.

### POST /api/store/items/:itemId/purchase

Request: none.

Server authority: determines active item, cost, balance, ownership eligibility.

Transaction: debit points, grant inventory/coupon/item, create activity, audit-sensitive events.

### POST /api/inventory/:inventoryItemId/equip

Request: none.

Server authority: validates ownership and item category. For frame equip, unequips other frames in same transaction.

### POST /api/me/display-name

Authentication: required player session cookie. Required `Idempotency-Key` header. Strict request body:

```json
{ "inventoryItemId": "uuid", "displayName": "NewName" }
```

The server derives player identity, trims and validates the requested display name, locks the player and owned Inventory item, requires a positive-quantity `RENAME_CARD`, consumes exactly one, changes `players.display_name`, writes immutable consumption history and semantic events, and returns the original stable result on exact replay.

Response includes `inventoryConsumptionId`, immutable `publicPlayerId`, previous and new display names, `inventoryItemId`, `remainingQuantity`, `consumedAt`, `idempotent`, and the authoritative Inventory DTO. It excludes user/Wix/session identity and private grant history. Errors include `DISPLAY_NAME_UNCHANGED`, `RENAME_CARD_NOT_AVAILABLE`, `RENAME_CARD_REQUIRED`, `IDEMPOTENCY_CONFLICT`, and `VALIDATION_FAILED`.

Never changes `player_id`, `user_id`, `public_player_id`, or `wix_member_id`.

### POST /api/wheel/spin

Authentication: required player session cookie. Body must be empty (`{}` is tolerated). `Idempotency-Key` is required, trimmed, non-empty, and at most 200 characters. The browser cannot submit player, cost, cooldown, segment, reward, quantity, probability, balance, XP, or Inventory values.

The response contains `spinId`, safe reward identity/type/label/value, authoritative resulting SP balance, configured `wheelSegmentIndex`, `spunAt`, `spinNumber`, `chargedSynapsePoints`, `cycleStartedAt`, `cycleEndsAt`, and `idempotent`. Exact same-player/key replay returns the immutable original snapshots even after tier changes, cycle expiry, or wheel deactivation. Historical pre-cycle rows may return nullable cycle fields.

One transaction serializes the player's wheel operation, resolves replay first, validates the active tier schedule, resolves the rolling cycle and next tier, validates the active window and eligible segments, performs secure weighted selection, debits the authoritative tier cost when nonzero, grants SP/XP/Inventory through existing ledgers, persists the spin, and emits `reward_wheel.spun`. The first committed spin starts the cycle and is free; the intended schedule is `0`, `300`, `450`, and `700` SP. Controlled failures include `WHEEL_NOT_AVAILABLE`, `WHEEL_DAILY_LIMIT_REACHED`, `WHEEL_NO_ELIGIBLE_REWARDS`, `WHEEL_CONFIGURATION_INVALID`, `INSUFFICIENT_POINTS`, and `VALIDATION_FAILED`.

### GET /api/wheel

Authentication: required player session cookie. Returns safe presentation plus authoritative `cycleSeconds`, cycle boundaries, spins used/remaining, maximum spins, next spin number/cost/free state, wallet affordability, `canSpin`, unavailable reason, and active segment presentation. The browser never derives a tier, free-spin eligibility, affordability, or local unlock. Segment weights, probability, RNG state, tier database IDs, internal player identity, ledger IDs, and grant IDs are never returned. No active wheel returns `{ "available": false, "wheel": null }`.

### Friends

- `GET /api/friends`
- `GET /api/friends/requests`
- `POST /api/friends/requests` with `{ "publicPlayerId": "CZ-..." }`
- `POST /api/friends/requests/:requestId/accept`
- `POST /api/friends/requests/:requestId/decline`
- `DELETE /api/friends/:publicPlayerId`
- `POST /api/friends/:publicPlayerId/block`

Constraints prevent duplicates and self-requests.

## Admin Endpoints

All `/api/admin/*` endpoints require a valid user session, an active `admin_users` row, and a server-side permission check. Client-supplied user, player, admin, or role identifiers are never authorization inputs.

### Phase 3E-B1 implemented endpoints

- `GET /api/admin/submissions` requires `SUBMISSIONS_REVIEW`. Query parameters are `status` (default `PENDING_REVIEW`), optional `puzzleId`, optional fractional `levelId`, and `limit` (default 50, maximum 100). Results are deterministically ordered by oldest `submittedAt`, then `submissionId`.
- `GET /api/admin/submissions/:submissionId` requires `SUBMISSIONS_REVIEW` and returns `SUBMISSION_NOT_FOUND` for an unknown UUID.

Both endpoints expose review-relevant submission, canonical puzzle, public player identity, player-puzzle, and video metadata. They do not expose email, Wix identity, session, token, secret, or private user fields. Phase 3E-B1 has no admin mutation endpoint.

### Future admin endpoints

- `GET /api/admin/overview`
- `GET /api/admin/players`
- `GET|POST|PATCH /api/admin/missions`
- `GET|POST|PATCH /api/admin/store/items`
- `GET|POST|PATCH /api/admin/seasons`
- `POST /api/admin/players/:id/point-adjustments`
- `GET /api/admin/audit-logs`

All sensitive admin mutations insert `audit_logs`.

## Phase 3D Submission Endpoints

All endpoints below require the authenticated session cookie. The server derives `playerId` from that session.

- `POST /api/uploads/videos/signed-url` accepts strict JSON `{ "filename", "mimeType", "sizeBytes" }`. Supported types are MP4, QuickTime, WebM, and M4V; the technical limit is 500 MiB. It returns `videoUploadId`, expiry, Cloudinary upload URL, public API key, backend-generated public ID, timestamp, and signature. It never returns the API secret.
- `POST /api/uploads/videos/:videoUploadId/complete` accepts no asset claims. The backend verifies the expected video with the storage provider, records authoritative bytes/duration, and marks the upload `COMPLETE`.
- `GET /api/submissions` returns only the current player's submissions, newest first.
- `GET /api/submissions/:submissionId` returns only the current player's submission; unknown and foreign IDs return `SUBMISSION_NOT_FOUND`.
- `POST /api/submissions` accepts strict JSON `{ "playerPuzzleId", "completionTimeMs", "videoUploadId" }` and optional `Idempotency-Key`. `completionTimeMs` must be from 1 through PostgreSQL integer maximum `2147483647`. The server derives canonical `puzzleId` and `levelId` from active ownership and creates `PENDING_REVIEW` only after video verification. Clients reuse one idempotency key while retrying the same logical attempt; changing puzzle, time, or video requires a new key.

Browser-supplied `playerId`, `puzzleId`, `levelId`, status, XP, points, and rewards are rejected. Upload failures use controlled codes including `VIDEO_STORAGE_NOT_CONFIGURED`, `VIDEO_UPLOAD_NOT_FOUND`, `VIDEO_UPLOAD_VERIFICATION_FAILED`, and `VIDEO_UPLOAD_ALREADY_USED`.
## Phase 3G-A Reward Catalog

### `GET /api/rewards/store`

Authentication: required player session cookie.

Returns `{ "items": StoreCatalogItem[] }`. Each item contains `listingId`, `rewardDefinitionId`, `code`, `rewardType`, `name`, `description`, nullable `imageUrl`, nullable `rarity`, `priceSynapsePoints`, `featured`, `displayOrder`, and nullable `purchaseLimit`.

Only active reward definitions and active listings are returned. `availableFrom` is inclusive and `availableUntil` is exclusive, evaluated against backend time. Internal reward/listing metadata and inactive scheduling details are not exposed. This is a read-only catalog endpoint; it does not purchase or grant a reward.

## Phase 3G-B Store Purchase

### `POST /api/rewards/store/:listingId/purchase`

Authentication: required player session cookie. `listingId` must be a UUID. Request body must be `{}` and `Idempotency-Key` is required, trimmed, non-empty, and at most 200 characters. Price, reward identity, player identity, balance, limits, and ownership outcomes are never accepted from the browser.

Returns `{ purchaseId, listingId, reward: { rewardDefinitionId, code, rewardType, name, imageUrl, rarity }, priceSynapsePoints, balanceAfter, purchasedAt, idempotent }`. Exact same-player/key/listing retries return the same immutable purchase with `idempotent: true`; another listing with the same key returns `409 IDEMPOTENCY_CONFLICT`.

Unavailable listings return `STORE_LISTING_UNAVAILABLE`, exhausted limits return `PURCHASE_LIMIT_REACHED`, and insufficient wallet balance uses the existing insufficient-points error. Failed purchases commit no debit, purchase, or event.

In Phase 3G-C, supported inventory rewards are granted in the same transaction. Unique rewards already owned return `ITEM_ALREADY_OWNED` before debit; Store listings for XP or Synapse Points return `STORE_REWARD_NOT_INVENTORY_SUPPORTED`. The authenticated Store catalog also returns `ownedQuantity`, `alreadyOwned`, `purchaseCount`, `remainingPurchases`, and server-derived `canPurchase`.

In Phase 3I-A, a Store listing backed by a `COUPON` reward creates internal coupon ownership in the purchase transaction instead of an Inventory item. Catalog `ownedQuantity` for coupons counts only the authenticated player's `ACTIVE`, unexpired coupon ownerships; `REDEEMED`, `REVOKED`, and effectively expired coupons do not contribute. Other supported rewards retain their Inventory behavior.

## Phase 3G-C Inventory And Equipment

### `GET /api/me/inventory`

Authentication: required player session cookie. Returns `{ items, equipment }` for the authenticated player only. Items contain safe reward presentation data, authoritative quantity and acquisition time, and `equippedSlots`; grant history and reward metadata are private.

### `POST /api/me/inventory/:inventoryItemId/equip`

Authentication: required player session cookie. Body is `{ "slot": "FRAME" | "AVATAR" | "BADGE_1" | "BADGE_2" | "BADGE_3" }`. The server verifies ownership, positive quantity, and reward/slot compatibility. Equipping replaces the existing item in that slot, while one inventory item cannot occupy multiple slots.

### `DELETE /api/me/equipment/:slot`

Authentication: required player session cookie. Removes the authenticated player's equipment assignment for the validated slot without removing ownership. Both equipment mutations return the refreshed Inventory DTO.

## Phase 3I-A Coupon Ownership

### `GET /api/me/coupons`

Authentication: required player session cookie. Returns `{ coupons }` scoped to the authenticated player. Each coupon contains `couponOwnershipId`, stable customer-facing `couponCode`, `rewardDefinitionId`, `rewardCode`, display name and description, nullable image and rarity, effective `status`, `issuedAt`, nullable `expiresAt`, and a safe display-metadata subset.

Expiration is derived at read time: a stored active coupon whose expiry has passed is returned as `EXPIRED`. Grant idempotency keys, issuance source identifiers, internal lifecycle timestamps, provider mappings/IDs, sync errors, redemption source identities, and credentials are not exposed. Phase 3I-B1 adds no provider or redemption mutation endpoint and performs no Wix or Shopify operation.

Phase 3I-B2 adds an internal Wix outbound adapter and sync service only. It adds no browser, player, admin, or provider callback endpoint. Wix app OAuth credentials/tokens, app-instance and site IDs, provider coupon IDs, query responses, and synchronization errors remain backend-internal and are not added to `GET /api/me/coupons`.

Phase 3I-B3 adds an internal Shopify outbound adapter and sync service for `SHOPIFY_COGZART` only. It adds no browser, player, admin, or provider callback endpoint. The canonical `*.myshopify.com` domain, client credentials, access tokens, DiscountCodeNode IDs, GraphQL responses, and synchronization errors remain backend-internal and are not added to `GET /api/me/coupons`. Wix mappings are rejected or skipped by the Shopify boundary. The internal lookup, create, exact-code replay, and deactivate path has been live-verified without changing this public API boundary.
