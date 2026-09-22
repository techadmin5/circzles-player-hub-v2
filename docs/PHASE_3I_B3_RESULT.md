# Phase 3I-B3 Result: Shopify Coupon Adapter

## Status

IMPLEMENTED AND AUTOMATED-TESTED. LIVE DIAGNOSTIC COMPLETED; SUCCESSFUL CREATE/DEACTIVATE VERIFICATION REMAINS PENDING.

No database migration was generated or run. No Shopify, Wix, Neon, Production, or other database call occurred during implementation or automated validation.

## Scope

Phase 3I-B3 adds an outbound Shopify implementation of the existing provider-neutral `CouponProviderGateway` for `SHOPIFY_COGZART`. CircZles coupon ownership and lifecycle state remain authoritative; Shopify discounts are provider projections represented by the existing B1 mapping rows.

The adapter does not add a public, player, admin, webhook, or provider callback endpoint. It does not add a worker or alter the B1 ownership and redemption rules. Phase 3I-B4 authenticated inbound redemption synchronization remains separate.

## Configuration And Authentication

Backend configuration adds:

- `SHOPIFY_SHOP_DOMAIN`
- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`

The shop domain must be a canonical single-store `*.myshopify.com` hostname. A safe accidental `https://` prefix or trailing slash is normalized, while HTTP, paths, credentials, ports, query strings, fragments, nested hostnames, and unrelated domains are rejected. The canonical domain has not yet been manually verified and is intentionally not hardcoded or guessed from `shop.cogzart.com`.

`ShopifyAppOAuthClient` uses:

- `POST https://{shop}.myshopify.com/admin/oauth/access_token`
- `Content-Type: application/x-www-form-urlencoded`
- `grant_type=client_credentials`

The client ID is non-secret configuration. The client secret remains environment-only. Returned access tokens are cached using `expires_in`, refreshed with a conservative pre-expiry window, and coalesced when concurrent callers request the same shop/app token. Errors exclude credentials, access tokens, and raw provider responses.

The app requires Shopify Admin API scope `write_discounts`.

## GraphQL Boundary

All discount operations use Shopify Admin GraphQL API version `2026-07` at:

`POST https://{shop}.myshopify.com/admin/api/2026-07/graphql.json`

Requests authenticate through `X-Shopify-Access-Token`.

Before creating, the gateway uses current `codeDiscountNodeByCode(code: ...)`. Shopify documents this lookup as case-insensitive. CircZles still requires the returned redeem code to equal the canonical code exactly and requires the underlying type to be `DiscountCodeBasic`. Missing results proceed to create; malformed, case-conflicting, or incompatible discount results fail safely.

## Create Mapping

`discountCodeBasicCreate` creates an amount-off code with:

- title `CircZles Reward <couponCode>`
- the exact canonical CircZles coupon code
- authoritative `startsAt` and nullable `endsAt`
- `context: { all: ALL }` for all buyers
- all items eligible
- purchase-type flags intentionally omitted for compatibility with stores that do not use Shopify subscriptions
- `usageLimit: 1`
- `appliesOncePerCustomer: true`
- no enabled discount combinations

Percentage rewards convert whole backend percentages to Shopify fractions: 20 percent becomes `0.20`. Fixed rewards use the B1-selected USD amount and `discountAmount.appliesOnEachItem = false`, so the amount is distributed across eligible items rather than applied independently to every line item.

HTTP 200 alone is never treated as success. The gateway validates top-level GraphQL errors, mutation `userErrors`, the returned DiscountCodeNode GID, the `DiscountCodeBasic` type, and the exact canonical redeem code.

## Recovery And Disable

An ambiguous create outcome never issues a second create in the same provisioning call. Transport failures, retryable HTTP or GraphQL outcomes, malformed ambiguous success data, and duplicate-code user errors enter bounded exact-code recovery with injectable delays. A later compatible exact-code match is reused; deterministic user errors are not retried; exhaustion fails closed.

Disable uses `discountCodeDeactivate(id: ...)` and validates GraphQL errors, mutation user errors, and the returned node ID. The provider discount is not deleted.

## Synchronization

`ShopifyCouponSyncService` applies the existing B1 mapping transitions:

- successful provision: `PENDING_CREATE -> ACTIVE`
- successful deactivate: `PENDING_DISABLE -> DISABLED`
- safe provider failure: current valid state -> `ERROR`

Existing provider IDs are preserved when appropriate. Authoritative coupon ownership is not changed or reactivated by provider synchronization failures. Wix mappings are skipped by Shopify batch operations and rejected by direct Shopify operations.

## Automated Validation

Tests use injected fake HTTP, clocks, delays, token providers, gateways, and repositories. They make no external calls. Coverage includes domain validation, exact OAuth endpoint and form body, missing configuration, token validation/caching/refresh/coalescing, secret isolation, exact-code lookup, incompatible types, percentage and fixed-amount mapping, GraphQL and user errors, GID/code validation, bounded recovery with no second create, duplicate-code recovery, deactivation, mapping state transitions, and Wix isolation.

## Live Diagnostic

A controlled live diagnostic confirmed:

- Shopify client-credentials OAuth succeeded.
- The `read_discounts` exact-code lookup succeeded.
- The first `discountCodeBasicCreate` request reached Shopify and returned HTTP 200.
- Shopify returned `INVALID` mutation user errors for both `customerGets.appliesOnSubscription` and `customerGets.appliesOnOneTimePurchase` because explicit purchase-type fields are not permitted for this non-subscription store.
- No coupon was created.

`DiscountCustomerGetsInput` exposes both purchase-type fields as optional. The B3 mapping now omits them entirely rather than sending `true`, `false`, or `null` values.

## Deferred Verification

The diagnostic verified token exchange and read access but did not verify successful coupon creation or deactivation. The corrected create mapping, create/recovery visibility, and deactivation behavior still require a separately approved controlled Shopify smoke test using environment-only credentials.
