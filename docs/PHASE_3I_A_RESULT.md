# Phase 3I-A Result: Coupon Ownership Foundation

## Objective

Phase 3I-A establishes backend-authoritative, provider-independent coupon ownership. It does not implement coupon redemption or a Wix bridge.

## Design

Canonical coupon definitions continue to use `reward_definitions` with `reward_type = COUPON`. New grants create one stable `coupon_ownerships` row per issued unit rather than treating coupons as ordinary Inventory. Existing historical Inventory data is not rewritten.

Stored lifecycle states are `ACTIVE`, `REDEEMED`, and `REVOKED`. `EXPIRED` is derived for active coupons at read/use time from optional `expires_at`, avoiding a scheduler and stale stored expiration state.

## Schema

Migration `0017_lowly_miss_america.sql` adds the lifecycle enum and `coupon_ownerships`, including restrictive player/reward-definition foreign keys, stable ownership UUIDs, source identity and ordinal, player-scoped idempotency, issue/expiry/lifecycle timestamps, uniqueness constraints, lifecycle checks, and player/status/source query indexes.

The migration is additive and schema-only. It has no drops, data rewrites, seed rows, provider fields, or Wix dependencies.

## Grant Integration

The shared entitlement router sends `COUPON` rewards to the coupon authority and leaves supported non-coupon Inventory behavior unchanged. Store purchases and Reward Wheel spins create coupon ownership within their existing authoritative transactions. A failed coupon grant rolls back its debit/spin and operation history.

Issuance serializes per player, checks immutable same-key replay, and rejects alternate-key reuse of the same source even when the attempted reward definition differs. Database uniqueness identifies each issuance unit by `(player_id, source_type, source_id, issuance_ordinal)` and separately protects `(player_id, idempotency_key, issuance_ordinal)`. Successful issuance emits `coupon.issued` in the same transaction. This phase does not claim live PostgreSQL concurrency testing.

## API

Authenticated `GET /api/me/coupons` returns only the session player's safe coupon DTOs. It exposes stable ownership/reward identity, presentation fields, effective status, issued/expiry times, and whitelisted display metadata. It excludes idempotency/source internals, lifecycle audit timestamps, provider data, and secrets.

The Store catalog counts only `ACTIVE`, unexpired coupon ownership for the authenticated player. `REDEEMED`, `REVOKED`, and effectively expired coupons remain in ownership history but do not contribute to available Store `ownedQuantity`. Non-coupon quantities continue to come from Inventory.

## Historical Coupon Preflight

`docs/PHASE_3I_A_COUPON_PREFLIGHT.sql` was run as a read-only, repeatable-read inspection against the confirmed Neon DEVELOPMENT database before migration `0017` was applied.

- Historical `COUPON` reward definitions: 0.
- Historical coupon Inventory rows: 0.
- Historical coupon quantity: 0.
- Affected players: 0.
- Historical coupon grants: 0.
- Historical coupon consumptions: 0.
- `coupon_ownerships` did not exist before migration.
- Drizzle migration history ended at `0016_windy_xorn`.

Because both the historical coupon Inventory row count and total quantity were zero, no backfill was required and the schema-only migration was approved for Development.

The API does not synthesize legacy ownership or combine Inventory and coupon rows, preventing silent duplication and double counting.

## Development Migration Verification

Migration `0017_lowly_miss_america.sql` was applied manually and verified on Neon DEVELOPMENT only. Production and Wix were not touched.

Post-migration inspection verified:

- `coupon_ownerships` exists.
- The `coupon_ownership_status` enum exists.
- The named CHECK constraints `coupon_ownerships_expiry_check`, `coupon_ownerships_issuance_ordinal_check`, `coupon_ownerships_lifecycle_check`, `coupon_ownerships_redeemed_at_check`, and `coupon_ownerships_revoked_at_check` exist.
- Both expected foreign keys exist.
- The expected indexes exist.
- The table initially contained 0 coupon ownership rows.

## Development Runtime Smoke Test

The authenticated smoke test used Development player `CZ-8F42KD` and a temporary Development-only Store reward with code `DEV_3I_SMOKE_COUPON`, reward type `COUPON`, price 0 SP, and purchase limit 1.

The first purchase succeeded with purchase ID `69ebc82c-52a2-4676-859f-cbab8cdeb6f1` and coupon ownership ID `0366efa4-5990-4cfb-a7d6-06db5722f261`. It returned `rewardType = COUPON`, `priceSynapsePoints = 0`, and `idempotent = false`; the player's balance remained 361 SP. Authenticated `GET /api/me/coupons` returned the ownership with status `ACTIVE`.

An exact same-key replay returned the same purchase ID with `idempotent = true`. A second logical purchase with a different key was rejected with `PURCHASE_LIMIT_REACHED`.

Final Development database reconciliation verified:

- `store_purchase_rows = 1`
- `original_key_rows = 1`
- `rejected_second_key_rows = 0`
- `coupon_ownership_rows = 1`
- `coupon_source_rows = 1`
- `coupon_entitlement_key_rows = 1`
- `coupon_issued_events = 1`
- `purchase_completed_events = 1`
- `point_transaction_rows = 0`
- `purchase_has_no_debit_link = true`
- `purchase_price_snapshot = 0`
- `purchase_balance_after = 361`
- `coupon_status = ACTIVE`

## Tests

Focused tests cover stable per-unit ownership, exact replay, conflicting replay, different grants coexisting, player-scoped reads, optional expiry, invalid reward types, authenticated API scoping, Store issuance, Reward Wheel issuance, preserved non-coupon routes, and transaction rollback simulations. Production-path tests invoke `grantCouponOwnershipInTransaction`, the shared entitlement router, and the Store/Reward Wheel entitlement wrappers with lightweight transaction doubles. Store quantity tests exercise the production ownership projection for active, expired, redeemed, revoked, cross-player, and non-coupon cases. These are not real PostgreSQL constraint or rollback tests.

## Boundaries And Limitations

There is no redemption endpoint, coupon scheduler, frontend redesign, Wix call, provider credential, external coupon code, or provider mapping. Future Phase 3I-B integration must map from internal ownership without making Wix authoritative.

The Development verification covers the real PostgreSQL migration and one player's runtime behavior on Neon DEVELOPMENT. No Production migration was performed, no Wix/provider bridge was tested, and no real concurrent PostgreSQL race test was performed. Phase 3I-B remains separate.

## Verification

- Backend lint: passed.
- Backend typecheck: passed.
- Backend tests: passed, 20 files / 333 tests.
- Backend build: passed.

## Migration Status

**APPLIED AND VERIFIED ON NEON DEVELOPMENT ONLY**

Migration `0017_lowly_miss_america.sql` was applied manually to Neon DEVELOPMENT after the historical preflight passed. It has not been applied to Production.
