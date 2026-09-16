# Phase 3G-D Result: Rename Card Consumption

## Scope

Phase 3G-D implements authenticated, server-authoritative Rename Card consumption and display-name changes. It adds generic consumption history and the real Inventory dialog. Coupon redemption, Wix coupon/profile updates, Reward Wheel authority, Store administration, and production migration remain outside this phase.

## Schema And Transaction

Migration `0014_tired_polaris.sql` adds immutable `inventory_consumptions` with three restrictive foreign keys, positive quantity and non-negative quantity-after checks, player-scoped idempotency uniqueness, history indexes, and JSON replay snapshots. It is additive and schema-only and was generated but not run.

One transaction takes a player rename advisory lock, checks replay, locks the player, rejects an unchanged name, locks and verifies the player's positive-quantity Rename Card, decrements exactly one, updates only `players.display_name`, inserts consumption history, emits `inventory.item.consumed` and `player.display_name.changed`, and returns authoritative Inventory. Any failure rolls back every effect.

Exact same-player/key/item/normalized-name replay returns the original consumption timestamp, previous/new names, public ID, and quantity-after without another decrement or event. Different item or name reuse returns `IDEMPOTENCY_CONFLICT`. Player serialization and Inventory row locking prevent concurrent final-card uses from both succeeding.

## Identity And Validation

Display names are edge-trimmed, single-line, free of Unicode control/format characters, and 2-32 Unicode code points. Legitimate Unicode and internal characters are preserved. Names are not globally unique or lowercased.

Only `players.display_name` changes. `player_id`, `user_id`, immutable `public_player_id`, Wix identity links/member ID, and sessions remain unchanged. `/api/me` and public profile reads therefore return the new name through the existing immutable player linkage; historical submissions and leaderboards are not rewritten.

## API And Frontend

Authenticated `POST /api/me/display-name` accepts strict `{ inventoryItemId, displayName }` plus a required `Idempotency-Key`. The browser cannot supply player/public identity, quantity, or reward type.

In API mode, a positive-quantity Rename Card opens an accessible responsive dialog showing current name, new-name input, code-point counter, and the permanent-Player-ID note. Zero quantity shows no cards remaining. Confirmation is non-optimistic: only backend success replaces Inventory, synchronizes the confirmed display name, closes the dialog, and plays one success cue. Errors preserve authoritative state and useful input. Uncertain requests retain their key; definitive success or 4xx responses end that intent.

The Profile identity panel now follows configured data mode. API mode uses `/api/me`; mock mode preserves its existing preview behavior. No direct profile rename bypass exists.

## Verification Status

Automated tests use fake repositories and serialized transaction harnesses and make no external calls. They cover Unicode validation, identity immutability, quantities, replay/conflict, wrong/foreign/empty items, final-card concurrency, rollback injection, authentication, strict request validation, and `/api/me` refresh behavior. This does not claim live PostgreSQL concurrency testing.

No migration, seed, Neon write, real rename, Wix action, production action, or main-branch change occurred during implementation.
