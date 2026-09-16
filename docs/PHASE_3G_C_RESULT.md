# Phase 3G-C Result: Inventory Ownership And Equipment

## Scope

Phase 3G-C adds authoritative Inventory grant history, current ownership, explicit equipment slots, atomic Store entitlements, real Inventory APIs/UI, Store ownership context, and equipped public-profile presentation. Rename Card consumption, Coupon redemption/Wix integration, Reward Wheel authority, and Store administration remain deferred.

## Ownership And Grants

Migration `0013_absurd_slayback.sql` defines immutable `inventory_grants`, cached `player_inventory_items`, `player_equipment`, and the five-value `equipment_slot` enum. All foreign keys use restrictive deletion. The migration is additive and schema-only; it was generated but not run.

Frames, Badges, Avatars, and Cosmetics are unique per reward definition and remain quantity one. Rename Cards and Coupons stack. XP and Synapse Points are rejected by the Inventory/Store entitlement path and continue to use their existing ledgers.

The generic transaction-aware grant helper uses player-scoped idempotency, validates immutable replay fields, serializes ownership changes, and emits `inventory.item.granted`. It is not Store-specific and can be reused by future mission, rank, or wheel reward authorities.

## Atomic Store Purchase

A supported Store purchase now validates availability, limits, wallet, and unique ownership before debit. SP debit, immutable purchase, Inventory grant, current ownership, `store.purchase.completed`, and `inventory.item.granted` commit together. Any grant failure rolls everything back. Exact purchase replay does not debit, stack, grant, or emit again.

The authenticated catalog supplies server-derived ownership and purchase context. API-mode Buy uses one stable key while an intent is unresolved, accepts `balanceAfter` as authoritative, refreshes catalog state, and plays one semantic success cue only after backend confirmation. Failed purchases retain the authoritative balance and receive error feedback without a success sound.

## Inventory And Equipment

`GET /api/me/inventory` returns only the authenticated player's safe item DTO and equipment summary. Equip and unequip APIs derive player identity from the session. Frame and Avatar have one slot each; Badges use three ordered slots; one item cannot occupy several slots. Rename Cards, Coupons, and generic Cosmetics are non-equippable.

The Inventory UI keeps mock mode for design previews and uses real API data in API mode without mock fallback. It provides loading, retry, error, and empty states; displays authoritative quantities and reward images when supplied; and updates equipment after backend success. Rename Card use and Coupon redemption are visibly deferred.

Public profiles now derive Avatar, Frame, and displayed Badges from equipment while preserving the existing public-safe response shape. Email, internal player identity, wallet, Inventory quantity, grant history, purchases, metadata, and Wix information remain excluded.

## Data And Verification Status

Phase 3G-B migration `0012_early_the_hood.sql` is **APPLIED AND VERIFIED - Neon DEVELOPMENT**. Verification confirmed its table, idempotency and ledger uniqueness, ledger-link check, four restrictive foreign keys, and zero purchase rows. No production migration occurred.

Because Development contains no existing purchases, no Inventory backfill is required there. Any other environment with purchases predating Inventory must be reconciled deliberately before enabling entitlements.

Automated tests use fake repositories and serialized transaction harnesses with no external calls. They cover grants, replay/conflicts, unique and stackable ownership, atomic Store integration/rollback, equipment rules, APIs, and public-profile safety. This does not claim live PostgreSQL concurrency testing.
