# Phase 3I-B1 Result: Provider-Neutral Multi-Store Coupon Bridge

## Objective

Phase 3I-B1 adds the internal foundation for projecting one authoritative coupon ownership to four Wix storefronts and one Shopify storefront. The CircZles backend remains authoritative; provider copies are mappings and cannot replace or reactivate internal ownership state.

## Schema

Generated migration `0018_brave_wild_child.sql` adds:

- Storefront targets `WIX_CIRCZLES_IN`, `WIX_CIRCZLES_COM`, `WIX_COGZART_IN`, `WIX_COGZART_COM`, and `SHOPIFY_COGZART`.
- Providers `WIX` and `SHOPIFY`.
- Mapping sync states `PENDING_CREATE`, `ACTIVE`, `PENDING_DISABLE`, `DISABLED`, and `ERROR`.
- A unique, uppercase ASCII, checkout-safe `coupon_ownerships.coupon_code` limited to 20 characters.
- `coupon_provider_mappings` with restrictive ownership history, provider/storefront validation, one mapping per ownership/storefront, scoped provider-ID uniqueness, sync timestamps/errors, and reconciliation indexes.
- `coupon_redemptions` with restrictive ownership history, one redemption per ownership, idempotency/source uniqueness, and audit lookup support.

Migration status: **APPLIED AND VERIFIED ON NEON DEVELOPMENT ONLY**.

Migration `0018_brave_wild_child.sql` was manually applied successfully to Neon DEVELOPMENT. Production was not touched.

Post-migration inspection verified:

- `coupon_provider_mappings` exists.
- `coupon_redemptions` exists.
- The `coupon_provider` enum exists.
- The `coupon_provider_sync_status` enum exists.
- The `coupon_storefront_target` enum exists.
- `coupon_ownerships.coupon_code` exists and is `NOT NULL`.

## Historical Ownership Compatibility

Phase 3I-A Development verification created one real ownership before `coupon_code` existed. Migration `0018` therefore adds the column as nullable, deterministically backfills every existing ownership with `CZ` plus 16 uppercase hexadecimal characters from the ownership UUID's MD5 digest, then applies `NOT NULL`, format, and uniqueness enforcement. The code reveals neither the UUID nor player PII. A collision aborts uniqueness creation rather than remaining silent. The migration creates no provider mappings or redemption history for existing rows.

The real Development ownership `0366efa4-5990-4cfb-a7d6-06db5722f261` was verified after migration with coupon code `CZ95F70BA56FDCF99B` and initial status `ACTIVE`.

## Coupon Code And Benefit Model

New ownerships receive the same deterministic code representation from their server-generated ownership UUID. `GET /api/me/coupons` adds `couponCode` while preserving all existing fields and hiding provider mappings, provider IDs, sync errors, source identities, and credentials.

Provider-neutral reward metadata supports:

- `PERCENTAGE` with a positive percentage no greater than 100.
- `FIXED_AMOUNT` with explicit positive `INR` and `USD` values.

No live currency conversion occurs. Indian storefronts select INR; other configured storefronts select USD. Every projection request carries total usage limit 1 and per-customer usage limit 1.

## Provisioning Foundation

`CouponProviderGateway` defines future provision and disable operations without an implementation. `createCouponProvisioningPlanInTransaction` validates active ownership and benefit metadata, safely creates or reuses one mapping for each of the five storefronts, and returns provider-neutral requests. Mapping transitions are explicitly validated and retain provider ID, sync attempts/successes, errors, and disable state for future retry/reconciliation workers.

B1 contains no Wix or Shopify HTTP client, credential, site/shop ID, network call, admin mutation endpoint, or public provider webhook.

## Development Provisioning Verification

Development-only reward definition `a0a8dfda-6533-49b2-8130-9bf62ff5f709`, code `DEV_3I_SMOKE_COUPON`, was configured with this provider-neutral metadata for the controlled smoke test:

```json
{
  "couponBenefit": {
    "type": "PERCENTAGE",
    "percentage": 20
  }
}
```

`createCouponProvisioningPlanInTransaction` was exercised against real Neon DEVELOPMENT. It created exactly five mappings:

- `WIX_CIRCZLES_IN` -> `WIX`
- `WIX_CIRCZLES_COM` -> `WIX`
- `WIX_COGZART_IN` -> `WIX`
- `WIX_COGZART_COM` -> `WIX`
- `SHOPIFY_COGZART` -> `SHOPIFY`

All mappings initially had `sync_status = PENDING_CREATE` and null `provider_coupon_id`. All five provisioning requests used coupon code `CZ95F70BA56FDCF99B`, a 20 percent benefit, `totalUsageLimit = 1`, and `perCustomerUsageLimit = 1`. Re-running provisioning remained idempotent at exactly five mappings and five distinct storefronts.

## Authoritative Redemption

`recordCouponRedemptionInTransaction` locks the ownership and records the first confirmed successful redemption atomically. It:

- Replays the exact storefront/source/idempotency identity safely.
- Rejects a conflicting second redemption.
- Rejects revoked and effectively expired ownerships.
- Changes `ACTIVE` to `REDEEMED` and sets the same canonical `redeemed_at` used by audit history and the event.
- Moves every non-disabled provider mapping to `PENDING_DISABLE`.
- Emits one `coupon.redeemed` event.
- Creates no Inventory ownership or grant rows.

No unauthenticated provider traffic is accepted in this phase.

## Development Redemption Verification

The first controlled redemption used storefront `WIX_CIRCZLES_IN`, source redemption ID `DEV-3IB1-REDEMPTION-001`, and idempotency key `dev-3ib1-redemption-001`. It created redemption ID `794e9082-e4df-43d3-87d9-c479279ed5fd` with canonical `redeemed_at = 2026-09-21T05:33:01.367Z`.

- The first redemption returned `idempotent = false`.
- The authoritative ownership became `REDEEMED`.
- Exact replay returned `idempotent = true` and the same redemption ID.
- A conflicting second redemption from `SHOPIFY_COGZART` was rejected with `COUPON_ALREADY_REDEEMED` and HTTP 409.

Final Development database reconciliation verified:

- Ownership status was `REDEEMED`.
- Exactly five provider mappings existed.
- All five mappings were `PENDING_DISABLE`.
- Exactly one `coupon_redemptions` row existed.
- Redemption storefront was `WIX_CIRCZLES_IN`.
- Exactly one `coupon.redeemed` game event existed.
- Event `source_type` was `COUPON_REDEMPTION`.
- Event `source_id` was `794e9082-e4df-43d3-87d9-c479279ed5fd`.

## Tests

Focused tests cover deterministic code format/stability and PII independence; five storefront/provider identities; invalid pairing; mapping replay and state transitions; percentage and INR/USD fixed benefits; invalid/missing/non-positive benefit values; all-storefront provisioning plans; authoritative redemption, exact replay, conflict, revocation, expiration, projection disablement, and single-event behavior; and the existing Store, Reward Wheel, Inventory, API, and Phase 3I-A issuance paths.

Production-path tests call the real mapping, transition, provisioning-plan, and redemption transaction functions through lightweight transaction doubles. They do not claim real PostgreSQL constraint, rollback, or concurrency testing.

## Validation

- Backend lint: passed.
- Backend typecheck: passed.
- Backend tests: passed, 21 files / 344 tests.
- Backend build: passed.
- Drizzle schema regeneration check: no additional schema changes.
- Git diff check: passed.

## Boundaries And Deferred Work

Provider adapters, credentials, outbound create/disable calls, authenticated inbound Wix/Shopify events, retries, reconciliation, and operational admin tooling remain for B2/B3/B4. Independent Wix and Shopify checkouts are separate external systems, so B1 cannot fully prevent simultaneous cross-store checkout before redemption reports reach CircZles. The first confirmed internal redemption remains final, and later provider failures must never reactivate it.

B1 validates the internal provider-neutral foundation only. It does not claim live Wix or Shopify integration. No Wix API calls, Shopify API calls, or real external coupon creation occurred; every `provider_coupon_id` remained null. Production was untouched, and B2/B3/B4 remain deferred.
