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

Migration status: **GENERATED / NOT YET APPLIED**. No migration command was run and no database was accessed.

## Historical Ownership Compatibility

Phase 3I-A Development verification created one real ownership before `coupon_code` existed. Migration `0018` therefore adds the column as nullable, deterministically backfills every existing ownership with `CZ` plus 16 uppercase hexadecimal characters from the ownership UUID's MD5 digest, then applies `NOT NULL`, format, and uniqueness enforcement. The code reveals neither the UUID nor player PII. A collision aborts uniqueness creation rather than remaining silent. The migration creates no provider mappings or redemption history for existing rows.

## Coupon Code And Benefit Model

New ownerships receive the same deterministic code representation from their server-generated ownership UUID. `GET /api/me/coupons` adds `couponCode` while preserving all existing fields and hiding provider mappings, provider IDs, sync errors, source identities, and credentials.

Provider-neutral reward metadata supports:

- `PERCENTAGE` with a positive percentage no greater than 100.
- `FIXED_AMOUNT` with explicit positive `INR` and `USD` values.

No live currency conversion occurs. Indian storefronts select INR; other configured storefronts select USD. Every projection request carries total usage limit 1 and per-customer usage limit 1.

## Provisioning Foundation

`CouponProviderGateway` defines future provision and disable operations without an implementation. `createCouponProvisioningPlanInTransaction` validates active ownership and benefit metadata, safely creates or reuses one mapping for each of the five storefronts, and returns provider-neutral requests. Mapping transitions are explicitly validated and retain provider ID, sync attempts/successes, errors, and disable state for future retry/reconciliation workers.

B1 contains no Wix or Shopify HTTP client, credential, site/shop ID, network call, admin mutation endpoint, or public provider webhook.

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

No Production, Neon, Wix API, or Shopify API access occurred during B1 implementation.
