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
| `playerService.getProfile(playerId)` | `GET /api/players/:publicPlayerId` |
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
| `couponService.getCoupons()` | `GET /api/coupons` |
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

Phase 3E-B1 status: deferred; no review mutation route exists yet.

Authentication: admin permission required.

Request:

```json
{ "decision": "APPROVED", "reviewNote": "Clear solve." }
```

Idempotency: required through `Idempotency-Key`.

Transaction: update submission, insert review, award points/XP once, update leaderboard, evaluate missions, notify player, audit log.

Errors: `SUBMISSION_ALREADY_APPROVED`, `FORBIDDEN`, `VALIDATION_FAILED`.

### GET /api/leaderboards

Query params:

- `mode=GLOBAL|COUNTRY|STATE|FRIENDS`
- `puzzleId`
- `levelId`
- `seasonId`
- `period=ALL_TIME|SEASON`
- `country`
- `state`

Server returns ranked rows and current player's rank. Ranks are not calculated by the frontend.

### POST /api/missions/:missionId/claim

Request: none beyond path and optional idempotency header.

Server authority: validates progress and grants rewards.

Transaction: mark claimed, grant point/XP/inventory/coupon rewards, emit events.

### POST /api/store/items/:itemId/purchase

Request: none.

Server authority: determines active item, cost, balance, ownership eligibility.

Transaction: debit points, grant inventory/coupon/item, create activity, audit-sensitive events.

### POST /api/inventory/:inventoryItemId/equip

Request: none.

Server authority: validates ownership and item category. For frame equip, unequips other frames in same transaction.

### POST /api/me/display-name

Request:

```json
{ "displayName": "NewName" }
```

Server authority: validates Rename Card ownership if required, consumes one card, changes `displayName` only.

Never changes `player_id`, `user_id`, `public_player_id`, or `wix_member_id`.

### POST /api/wheel/spin

Request: none.

Server authority: spin cost, cooldown, RNG, reward, and balance.

Response matches frontend `RewardWheelResult`.

Transaction: debit cost, select segment, grant reward, persist spin.

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
- `POST /api/admin/submissions/:id/review`
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
