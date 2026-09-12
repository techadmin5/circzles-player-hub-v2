# Phase 3G-A Result: Reward Definitions and Store Catalog

## Scope Completed

Phase 3G-A adds the canonical reward-definition and read-only store-listing foundation. It does not add purchases, inventory grants, equip/use behavior, Rename Card consumption, wheel reward authority, or commerce coupon bridging.

## Data Model

- `reward_definitions` identifies reusable rewards independently from whether they are sold. Supported types are `FRAME`, `BADGE`, `AVATAR`, `RENAME_CARD`, `COUPON`, `SYNAPSE_POINTS`, `XP`, and `COSMETIC`.
- `store_listings` supplies SP price, availability, featured state, ordering, and optional purchase limits for a reward definition.
- The listing-to-definition foreign key uses `ON DELETE RESTRICT` so a referenced canonical definition cannot be silently removed.
- Migration `0011_vengeful_junta.sql` is additive and schema-only. It contains no drops and no seed data. It is **APPLIED AND VERIFIED on Neon DEVELOPMENT**; no production migration occurred.

## API And Frontend

Authenticated `GET /api/rewards/store` returns only active definitions with active listings whose availability window includes the current server time. Its DTO exposes stable listing/definition IDs and display fields but excludes both metadata documents.

The Rewards page reads this endpoint only in API mode and has explicit loading, error/retry, and empty states. It does not fall back to mock data after an API failure. API catalog purchase controls remain disabled because purchase authority is a later phase; mock mode retains its existing local preview behavior.

## Interaction Polish

Store category controls now declare their tab sound semantics to the shared interaction router, eliminating the generic-button-plus-tab double cue. Mock purchase controls suppress the generic click cue and play the purchase sound only after the mock purchase succeeds. Settings switches use fixed internal thumb positioning and clipping so the thumb remains inside the track in both states.

## Neon Development Verification

Migration `0011_vengeful_junta.sql` was manually verified on Neon DEVELOPMENT. The following checks passed:

- `reward_definitions` exists.
- `store_listings` exists.
- `reward_definition_type` exists.
- `reward_definitions_code_unique` exists.
- The restrictive Store listing to reward-definition foreign key exists.
- The Store listing price constraint exists.

## Automated Verification

Automated backend tests use fake repositories and make no database or external-service calls. Phase 3G-B did not run a migration or seed and did not write to Neon, Wix, or production data.
