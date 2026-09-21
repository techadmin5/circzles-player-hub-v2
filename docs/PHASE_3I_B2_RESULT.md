# Phase 3I-B2 Result: Wix Coupon Adapter

## Objective

Phase 3I-B2 implements the real outbound Wix coupon adapter for the four confirmed Wix storefronts while preserving the CircZles backend as the authoritative owner of coupon lifecycle state. This phase contains implementation and automated tests only. No live Wix mutation or provider smoke test was performed.

## Storefront Configuration

| Storefront | Domain | Wix site ID | Currency |
| --- | --- | --- | --- |
| `WIX_CIRCZLES_IN` | `https://www.circzles.in/` | `5cd5bcc4-823e-485a-b791-c22fb487aaf8` | INR |
| `WIX_CIRCZLES_COM` | `https://www.circzles.com/` | `b5d3a6d5-bc44-44d4-9b14-e7b673bfd171` | USD |
| `WIX_COGZART_IN` | `https://www.cogzart.in/` | `d37a119e-a978-451f-a39f-c33f6b1d145f` | INR |
| `WIX_COGZART_COM` | `https://www.cogzart.com/` | `35afe62f-b860-4e10-b033-918b8577a870` | USD |

`SHOPIFY_COGZART` is rejected by the Wix adapter and remains deferred to Phase 3I-B3.

## Wix API Boundary

The adapter uses these Wix Coupons API methods:

- `POST https://www.wixapis.com/stores/v2/coupons/query` for exact canonical-code recovery before create.
- `POST https://www.wixapis.com/stores/v2/coupons` to create a coupon when no exact code match exists.
- `PATCH https://www.wixapis.com/stores/v2/coupons/{id}` with field mask `active` to disable a provider coupon.

Server-to-server requests use `Authorization: <API_KEY>`, the target `wix-site-id`, and JSON content type. `WIX_API_KEY` is optional at process startup, resolved only when a Wix operation is attempted, and remains backend-only. The HTTP client is injectable so automated tests make no network requests.

Create mapping preserves the canonical CircZles coupon code, uses a PII-free `CircZles Reward <couponCode>` name, maps percentage benefits to `percentOffRate`, maps B1-selected INR/USD fixed benefits to `moneyOffAmount`, and sends millisecond timestamps as strings. Scope is Wix Stores, total usage and per-customer usage are each one, and expiration is omitted when absent.

## Recovery And Synchronization

Provisioning queries by canonical coupon code and then performs an exact in-memory match. One exact match reuses its Wix ID, no match proceeds to create, and multiple exact matches fail without choosing arbitrarily. This prevents a retry from knowingly creating a second coupon after an earlier remote create succeeded but local persistence did not.

`WixCouponSyncService` reuses the Phase 3I-B1 transition rules. Successful provisioning stores `provider_coupon_id`, records sync timestamps, clears stale errors, and moves the mapping to `ACTIVE`. Successful disable moves a mapping to `DISABLED`. Safe provider failures move a valid mapping to `ERROR`, preserve an existing provider ID, and never alter or reactivate authoritative coupon ownership. Shopify mappings are not processed.

## Validation Scope

Automated tests use injected fake HTTP and repository boundaries. They cover all four site mappings, Shopify rejection, percentage and fixed-amount request mapping, timestamps and expiration, headers/endpoints, response validation, disable requests, exact-code recovery and retry behavior, safe provider failures, missing configuration, state transitions, and Shopify isolation.

No database migration was generated or run. No Neon, Production, Wix, or Shopify operation occurred during implementation. No live credential was used or stored.

## Deferred Work And Caveat

Phase 3I-B3 Shopify integration and Phase 3I-B4 authenticated inbound redemption synchronization remain deferred. B2 does not add a worker, public/admin sync endpoint, provider webhook, or reconciliation UI.

Independent provider checkouts remain separate external systems. Until authenticated redemption reports reach CircZles and pending disables finish, simultaneous checkout attempts can race. The B1 backend ownership and first confirmed internal redemption remain authoritative; provider failures must never reactivate a redeemed or revoked ownership.
