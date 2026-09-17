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

`docs/PHASE_3I_A_COUPON_PREFLIGHT.sql` is a read-only, repeatable-read Development preflight. Before applying migration `0017`, run it manually against Neon DEVELOPMENT and review the coupon definition count, Inventory row count, total quantity, affected players, grant history, consumption history, and per-player detail.

- If historical coupon Inventory row count and total quantity are both zero, `0017` may remain schema-only.
- If either value is non-zero, Phase 3I-A is **not safe to migrate** until a deterministic backfill strategy is designed from the reported grants/consumptions and separately reviewed.

The API does not synthesize legacy ownership or combine Inventory and coupon rows, preventing silent duplication and double counting.

## Tests

Focused tests cover stable per-unit ownership, exact replay, conflicting replay, different grants coexisting, player-scoped reads, optional expiry, invalid reward types, authenticated API scoping, Store issuance, Reward Wheel issuance, preserved non-coupon routes, and transaction rollback simulations. Production-path tests invoke `grantCouponOwnershipInTransaction`, the shared entitlement router, and the Store/Reward Wheel entitlement wrappers with lightweight transaction doubles. Store quantity tests exercise the production ownership projection for active, expired, redeemed, revoked, cross-player, and non-coupon cases. These are not real PostgreSQL constraint or rollback tests.

## Boundaries And Limitations

There is no redemption endpoint, coupon scheduler, frontend redesign, Wix call, provider credential, external coupon code, or provider mapping. Future Phase 3I-B integration must map from internal ownership without making Wix authoritative.

## Verification

- Backend lint: passed.
- Backend typecheck: passed.
- Backend tests: passed, 20 files / 333 tests.
- Backend build: passed.

## Migration Status

**GENERATED / NOT YET APPLIED**

Migration `0017_lowly_miss_america.sql` was not run against Neon Development, Production, or any other database. The historical coupon preflight must be completed and reviewed before Development migration approval.
