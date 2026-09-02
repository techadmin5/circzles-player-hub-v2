# Security And Authority Blueprint

## Authority Rule

The frontend requests actions. The backend determines results.

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

## Authentication

- Every player endpoint derives identity from server session.
- Every admin endpoint requires admin role/permission.
- Wix handoff tokens must be short-lived, signed, audience-bound, and single-use.
- Sessions can be revoked.

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
