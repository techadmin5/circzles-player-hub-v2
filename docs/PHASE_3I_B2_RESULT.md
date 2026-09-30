# Phase 3I-B2 Result: Wix Coupon Adapter

## Objective

Phase 3I-B2 implements the real outbound Wix coupon adapter for the four confirmed Wix storefronts while preserving the CircZles backend as the authoritative owner of coupon lifecycle state. This phase contains implementation and automated tests only. No live Wix mutation or provider smoke test was performed.

## Storefront Configuration

| Storefront | Domain | Wix site ID | Currency |
| --- | --- | --- | --- |
| `WIX_CIRCZLES_IN` | `https://www.circzles.in/` | `5cd5bcc4-823e-485a-b791-c22fb487aaf8` | INR |
| `WIX_CIRCZLES_COM` | `https://www.circzles.com/` | `3da04df5-2750-4b5b-a925-089d88e9f79d` | USD |
| `WIX_COGZART_IN` | `https://www.cogzart.in/` | `d37a119e-a978-451f-a39f-c33f6b1d145f` | INR |
| `WIX_COGZART_COM` | `https://www.cogzart.com/` | `35afe62f-b860-4e10-b033-918b8577a870` | USD |

All four self-managed app installations are confirmed:

| Storefront | Wix app instance ID |
| --- | --- |
| `WIX_CIRCZLES_IN` | `17b5821b-ed4c-46ca-acfb-597fa311099d` |
| `WIX_CIRCZLES_COM` | Environment-provided through `WIX_CIRCZLES_COM_INSTANCE_ID` |
| `WIX_COGZART_IN` | `171975f0-0a17-4d45-a115-c8c1766fe7a5` |
| `WIX_COGZART_COM` | `9e80b75f-990d-4bc4-9301-ff12afe489d2` |

These installation identifiers are non-secret configuration. The `circzles.com` installation moved with the replacement Wix site, so its current instance ID must be supplied at deployment and is deliberately not hardcoded in the adapter. `SHOPIFY_COGZART` is rejected by the Wix adapter and remains deferred to Phase 3I-B3.

## Wix API Boundary

The adapter uses these Wix Coupons API methods:

- `POST https://www.wixapis.com/stores/v2/coupons/query` for exact canonical-code recovery before create.
- `POST https://www.wixapis.com/stores/v2/coupons` to create a coupon when no exact code match exists.
- `GET https://www.wixapis.com/stores/v2/coupons/{id}` to verify a successful create directly.
- `PATCH https://www.wixapis.com/stores/v2/coupons/{id}` with field mask `active` to disable a provider coupon.

Authentication uses the self-managed Wix app OAuth `client_credentials` flow. The apps have the Manage Coupons scope `SCOPE.DC-COUPONS.MANAGE-COUPONS`. The backend posts the app ID, app secret, and target storefront's app-instance ID to `POST https://www.wixapis.com/oauth2/token`, then uses the returned access token as the coupon request `Authorization` value. App secrets and tokens remain backend-only, and coupon calls do not send the API-key-only `wix-site-id` header.

`WIX_CIRCZLES_COM`, `WIX_COGZART_IN`, and `WIX_COGZART_COM` use the original self-managed app configured by `WIX_APP_ID` and `WIX_APP_SECRET`. Its app ID is `d24ad742-958c-47eb-896b-a267753fe404`. `WIX_CIRCZLES_IN` is hosted in another Wix workspace and is installed from a separate self-managed app, so it uses `WIX_CIRCZLES_IN_APP_ID`, `WIX_CIRCZLES_IN_APP_SECRET`, and its own instance ID. Its app ID is `b984c368-a4e7-4ccf-8d5e-d598fb3707c8`. Both app IDs and all four instance IDs are non-secret configuration; both app secrets remain external backend-only configuration.

Credentials are resolved only when a storefront is used. Missing `circzles.in`-specific credentials do not break the three shared-app storefronts, and missing shared credentials do not break `circzles.in`. Access tokens are cached in memory by storefront, app ID, and instance ID and refreshed with a conservative pre-expiry window. Concurrent token requests for the same credential identity share one in-flight exchange. Token responses and provider errors are validated without exposing either app secret, access tokens, or raw credential requests. HTTP dependencies are injectable so automated tests make no network requests.

Create mapping preserves the canonical CircZles coupon code, uses a PII-free `CircZles Reward <couponCode>` name, maps percentage benefits to `percentOffRate`, maps B1-selected INR/USD fixed benefits to `moneyOffAmount`, and sends millisecond timestamps as strings. Scope is Wix Stores, total usage and per-customer usage are each one, `limitedToOneItem` and `appliesToSubscriptions` are explicitly `false`, and expiration is omitted when absent.

## Recovery And Synchronization

Provisioning queries Wix with supported `limit: 100` and `offset` pagination only, validates the reported `totalResults`, and performs exact canonical-code matching in memory across every represented page. One exact match reuses its Wix ID, no match proceeds to create, and multiple exact matches fail without choosing arbitrarily. This prevents a retry from knowingly creating a second coupon after an earlier remote create succeeded but local persistence did not.

After a successful create returns an ID, Get Coupon verifies that the returned entity has the same ID and canonical code. This direct verification does not depend on the new coupon appearing immediately in Query Coupons. If create has an ambiguous transport, malformed-success, HTTP 408/409/425/429, or 5xx outcome, the same provisioning call never creates again. It performs at most three exact-code recovery queries after injectable delays of 250 ms, 500 ms, and 1,000 ms. One later match is reused, duplicate matches remain an ambiguity failure, and exhausted recovery fails closed.

`WixCouponSyncService` reuses the Phase 3I-B1 transition rules. Successful provisioning stores `provider_coupon_id`, records sync timestamps, clears stale errors, and moves the mapping to `ACTIVE`. Successful disable moves a mapping to `DISABLED`. Safe provider failures move a valid mapping to `ERROR`, preserve an existing provider ID, and never alter or reactivate authoritative coupon ownership. Shopify mappings are not processed.

## Validation Scope

Automated tests use injected fake HTTP and repository boundaries. They cover all four site mappings, the separate `circzles.in` app, shared-app credential selection, missing-credential isolation, cross-app cache separation, Shopify rejection, OAuth request/configuration validation, safe token errors, refresh, concurrent token coalescing, percentage and fixed-amount request mapping, timestamps and expiration, headers/endpoints, response validation, disable requests, exact-code recovery and retry behavior, safe provider failures, state transitions, and Shopify isolation.

## Manual Wix Smoke Verification

A controlled live manual smoke test against the installed `circzles.com` app confirmed:

- OAuth `client_credentials` token acquisition succeeded.
- A read-only Query Coupons request returned HTTP 200 and live coupons.
- Create Coupon succeeded for code `CZB2SMOKE260921` with provider coupon ID `de64cfcf-78a9-4a50-b010-c3e328ea27e3`.
- An immediate Query Coupons request returned zero exact matches for that newly created code.
- Cleanup disable succeeded.
- Direct Get Coupon by ID returned HTTP 200 with the expected code, one-percent discount, one-use limits, and `active = false`.
- Wix had defaulted `limitedToOneItem` and `appliesToSubscriptions` to `true`, motivating the explicit `false` values now sent by CircZles.

This is observed provider query visibility lag from this smoke test, not a claim of a global Wix consistency guarantee. The smoke test made no CircZles database or Neon change, made no Production database change, and performed no Shopify operation.

No database migration was generated or run. The hardening implementation and automated tests made no Neon, Production database, Wix API, OAuth, coupon mutation, or Shopify operation. No live credential was used or stored by the implementation work. The live verification above was performed manually before this hardening patch and is recorded as supplied evidence.

## Deferred Work And Caveat

Phase 3I-B3 Shopify integration and Phase 3I-B4 authenticated inbound redemption synchronization remain deferred. B2 does not add a worker, public/admin sync endpoint, provider webhook, or reconciliation UI.

Independent provider checkouts remain separate external systems. Until authenticated redemption reports reach CircZles and pending disables finish, simultaneous checkout attempts can race. The B1 backend ownership and first confirmed internal redemption remain authoritative; provider failures must never reactivate a redeemed or revoked ownership.
