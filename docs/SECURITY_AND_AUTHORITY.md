> Authentication update: [Native Player Hub authentication](NATIVE_PLAYER_HUB_AUTH.md) is the authoritative auth architecture and route contract. Wix auth references below describe the retired implementation. Business/gameplay contracts remain applicable.

# Security And Authority Blueprint

## Authority Rule

The frontend and website request or report actions. The backend determines results.

Allowed frontend calls:

- `purchaseItem(itemId)`
- `claimMission(missionId)`
- `spinWheel()`
- `equipItem(itemId)`
- `renameDisplayName(displayName)`
- `createSubmission({ puzzleId/playerPuzzleId, completionTime, videoUploadId })`

Disallowed frontend authority:

- prices
- point/XP gains
- balances
- wheel outcomes
- leaderboard ranks
- logged-in player ID
- mission validity
- submission approval rewards
- valuable website quest completion
- hidden gem discovery
- review completion
- commerce purchase/coupon completion

## Ecosystem Security Rule

CircZles V2 must accept game-event inputs from the dashboard, the main website, future commerce systems, and future review/form systems, but the browser must not be authoritative for valuable mission rewards.

Examples:

- A low-value `website.page_visited` mission may be recorded when the backend can associate the request with an authenticated player and a valid page-event definition.
- A valuable `website.gem_found` mission must not trust `gemFound=true` from browser JavaScript.
- A `website.review_submitted` mission should eventually be verified from the real review/form/order system, not merely from a clicked button.

For valuable ecosystem events, the backend must validate:

- authenticated player
- valid mission/event
- valid page/gem/action/order/review
- eligibility and date window
- whether already completed
- idempotency
- source-system proof or server-side verification

## Authentication

- Every player endpoint derives identity from server session.
- Every admin endpoint requires admin role/permission.
- Wix handoff tokens must be short-lived, signed, audience-bound, and single-use.
- Sessions can be revoked.
- Website, dashboard, commerce, and review integrations must map back to the same V2 player identity before rewards are evaluated.

## Authorization

Player access rules:

- Players can read public profiles.
- Players can mutate only their own inventory/settings/submissions/friends.
- Players cannot approve submissions, edit mission definitions, or adjust balances.

Admin access rules:

- Submission reviewers can review submissions.
- Economy admins can perform point/XP corrections.
- Store admins can manage store items.
- Mission admins can manage mission definitions.
- Super admins can assign admin roles.

## Idempotency And Concurrency

Frontend button disabling is helpful UX but never the primary protection.

Use:

- database unique constraints
- row-level locks where balances/ownership change
- serializable or repeatable-read transactions for economy-critical flows
- `Idempotency-Key` for client retried mutations
- deterministic idempotency keys for internal reward processing

## Sensitive Transactions

### Store Purchase

Lock wallet row, validate item, validate balance/ownership, insert debit transaction, update wallet, grant inventory/coupon, emit event, commit.

### Wheel Spin

Lock wallet row, validate cost/cooldown, debit points, choose reward server-side, grant reward, insert spin row, emit events, commit.

### Submission Approval

Lock submission row, insert review, update status, insert `submission_reward_grants` once, grant XP/points, update leaderboard, emit events, commit.

Submission video authority:

1. Player uploads video to Cloudinary.
2. Backend stores Cloudinary URL/reference and submission metadata in PostgreSQL.
3. Admin manually reviews.
4. Only approved submissions feed leaderboard/reward processing.

PostgreSQL must not store large video binaries.

### Mission Claim

Lock player mission progress, validate claimable, mark claimed, grant rewards, emit events, commit.

### Rename Card Use

Lock inventory row, validate quantity/consumable, validate display name, decrement or consume card, update `players.display_name`, emit event, commit.

### Friend Acceptance

Lock request row, insert ordered friendship pair, update request status, emit notifications, commit.

## Audit Logs

All sensitive admin actions require immutable audit logs:

- submission review
- mission create/edit/activate/deactivate
- store item changes
- season changes
- point/XP correction
- player moderation
- notification broadcast
- leaderboard moderation
- admin role changes

Audit logs store actor, action, entity, before/after payload, request ID, and timestamp.

## Soft Delete Policy

Soft delete:

- users
- players
- puzzles
- store items
- missions
- seasons
- reward definitions

Append-only/no hard deletion:

- point transactions
- XP transactions
- submission reviews
- wheel spins
- audit logs
- game events

Hard delete only for short-lived technical artifacts where policy allows it, such as expired sessions or unused upload placeholders after retention.

## Production Authentication Controls

- Website handoffs are signed by the source site's server, expire within five minutes, have an audience and unique token ID, and are consumed once.
- Browser-supplied Wix member IDs, emails, user IDs, and player IDs are not authentication evidence.
- Verified-email linking is allowed only from a successfully verified server-side identity; conflicts fail closed.
- Direct assertions must originate from the canonical `circzles.com` adapter and match the requested authentication method.
- Player Hub stores no password, Google/Facebook credential, or OTP.
- Session cookies are opaque, HttpOnly, persistent, revocable, and backed by hashed database rows.
- Production frontend configuration cannot select mock data mode.
