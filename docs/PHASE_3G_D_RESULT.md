# Phase 3G-D Result: Rename Card Consumption

## Scope

Phase 3G-D implements authenticated, server-authoritative Rename Card consumption and display-name changes. It adds generic consumption history and the real Inventory dialog. Coupon redemption, Wix coupon/profile updates, Reward Wheel authority, Store administration, and production migration remain outside this phase.

## Schema And Transaction

Migration `0014_tired_polaris.sql` adds immutable `inventory_consumptions` with three restrictive foreign keys, positive quantity and non-negative quantity-after checks, player-scoped idempotency uniqueness, history indexes, and JSON replay snapshots. It is additive and schema-only and is **APPLIED AND VERIFIED - Neon DEVELOPMENT**. It has not been applied to production.

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

Development schema verification confirmed `inventory_consumptions`, player-scoped idempotency uniqueness, both quantity checks, all restrictive foreign keys, and an initial consumption count of zero.

## Development Runtime Verification

The controlled test used player `CZ-8F42KD`, whose original display name was `Smokey_OP`, and temporary reward `DEV_3GD_SMOKE_RENAME_CARD`. Inventory item `c9eb1448-b3e0-4775-b88d-af35af0c084c` began with quantity two.

The first real rename changed `Smokey_OP` to `SmokeTest_3GD`. It returned consumption `49e0cec0-da91-4569-8a61-e7108a4718c2`, remaining quantity one, and `idempotent=false`. The immutable public player ID remained `CZ-8F42KD`, and `GET /api/me` immediately returned `SmokeTest_3GD`.

An exact replay using the same Inventory item, normalized display name, and idempotency key returned the same consumption ID and remaining quantity with `idempotent=true`. It consumed no additional card and created no additional consumption or event.

A second legitimate use restored `SmokeTest_3GD` to `Smokey_OP`. It returned consumption `cc46a94b-ee99-4257-99be-5a93f9f633ca`, remaining quantity zero, and `idempotent=false`.

Final Development reconciliation confirmed display name `Smokey_OP`, public player ID `CZ-8F42KD`, Rename Card quantity zero, one grant, two consumptions, two `inventory.item.consumed` events, and two `player.display_name.changed` events. The replay added zero consumptions and zero events. The temporary reward was deactivated after testing.

No production migration or database action occurred. Wix and production identity remained untouched.
