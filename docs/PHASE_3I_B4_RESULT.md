# Phase 3I-B4 Result: Inbound Coupon Redemption Synchronization

## Status

IMPLEMENTED AND AUTOMATED-TESTED. LIVE PROVIDER VERIFICATION NOT YET PERFORMED.

No database migration was generated or run. No Wix, Shopify, Neon, Production database, or other live provider call occurred during implementation or automated validation.

## Inbound Provider Routes

- `POST /api/webhooks/wix/coupon-redemption`
- `POST /api/webhooks/shopify/orders-paid`

These are provider-authenticated callback routes, not player-session or browser endpoints. Responses expose only a safe processing status. Valid processed events, exact duplicates, and irrelevant events return 2xx. Invalid provider authentication returns 401, malformed payloads return 400, and retryable internal or provider-disable failures return 5xx.

Both routes are registered in an encapsulated Fastify plugin. Only that plugin replaces the inherited JSON/text parsers with buffer parsers, preserving the exact request bytes for cryptographic verification without changing JSON parsing elsewhere.

## Wix Coupon Applied

B4 uses the official Wix Coupons V2 **Coupon Applied** event, event type `wix.ecommerce.coupons.v2.coupon_applied`. Wix documents this event as occurring when an order using the coupon is completed or manually marked paid, so it represents completed/paid coupon use rather than a checkout button click or deprecated Velo `onOrderPaid` behavior.

The signed JWT is read from the raw request body. Its RS256 signature is verified with the Wix app webhook public key before any event data is trusted. The verified envelope must identify a configured app instance and the expected event/entity/slug. The canonical code comes from `actionEvent.body.coupon.specification.code.value`, the provider order identity from `actionEvent.body.wixAppOrderId`, the stable delivery identity from event `id`, and the redemption time from `eventTime`.

The separate `circzles.in` Wix app uses `WIX_CIRCZLES_IN_WEBHOOK_PUBLIC_KEY`. The original shared app uses `WIX_WEBHOOK_PUBLIC_KEY` for the other three Wix storefronts. A valid signature alone is insufficient: the verified JWT `instanceId` must map to exactly one storefront assigned to that app key. Unknown or cross-app instances fail closed. Secrets, public-key material, and raw signed tokens are never logged or returned.

## Shopify Orders Paid

B4 uses Shopify `orders/paid`. `X-Shopify-Hmac-SHA256` is checked against the exact raw body with `HMAC-SHA256` and `SHOPIFY_CLIENT_SECRET`, a base64 digest, an explicit length check, and `timingSafeEqual`. The authenticated `X-Shopify-Shop-Domain` must exactly match configured canonical domain `rsgybz-wx.myshopify.com`, and `X-Shopify-Topic` must be `orders/paid`; the only accepted Shopify storefront is `SHOPIFY_COGZART`.

`X-Shopify-Event-Id` is preferred as the stable provider event identity, with `X-Shopify-Webhook-Id` as the fallback. The order `id`, `processed_at` (or authenticated webhook trigger timestamp fallback), and all syntactically canonical `discount_codes[].code` candidates are normalized. A code is never considered owned merely because it starts with `CZ`; exact ownership and storefront mapping are resolved against CircZles database records. No discounts or no owned candidate is a successful irrelevant event.

## Authority And Idempotency

The provider event ID is stored as `coupon_redemptions.source_redemption_id`, whose existing `(storefront_target, source_redemption_id)` uniqueness deduplicates deliveries. The idempotency key is a bounded SHA-256 digest over provider, storefront, event ID, order ID, provider redemption time, and normalized coupon candidates. Exact delivery replay converges on the original redemption. Reusing an event identity with different material details fails closed.

The Drizzle repository resolves the exact canonical code and storefront mapping, then calls the existing B1 `recordCouponRedemptionInTransaction` function. That function remains the only lifecycle authority: it locks ownership, writes one immutable redemption, transitions `ACTIVE -> REDEEMED`, marks non-disabled sibling mappings `PENDING_DISABLE`, and emits one `coupon.redeemed` event atomically. Provider callbacks cannot reactivate an ownership.

## Provider Disable Reconciliation

After the database transaction commits, B4 delegates pending Wix mappings to `WixCouponSyncService` and the Shopify mapping to `ShopifyCouponSyncService`. Already `DISABLED` mappings and mappings with no external provider ID are not called. Retryable `ERROR` mappings with an external ID are returned to `PENDING_DISABLE` before another attempt.

Provider disable calls are outside the authoritative redemption transaction. A disable failure therefore leaves the ownership `REDEEMED`, records the provider mapping error through existing sync behavior, and returns a retryable 5xx so the provider can redeliver. Exact webhook replay can continue reconciliation without creating another redemption.

## Cross-Provider Consistency Limit

CircZles PostgreSQL is authoritative and the first webhook transaction accepted by CircZles wins. Later distinct redemption events are rejected internally, and sibling provider copies are disabled as soon as synchronization runs. This does not mathematically prevent simultaneous independent Wix and Shopify checkouts: a narrow real-world race remains between external checkout acceptance and successful disable propagation to every storefront.

## Migration Status

No migration was required or generated. B4 reuses the existing `coupon_ownerships`, `coupon_provider_mappings`, and `coupon_redemptions` structure from migration `0018_brave_wild_child.sql`.

## Automated Validation

Tests use generated test RSA keys, fake HMAC secrets, injected handlers, repositories, gateways, and sync services. They make no external calls. Coverage includes:

- Shopify valid/invalid/missing/malformed HMAC, constant-time length guard, configured-shop validation, paid order parsing, no discount, unrelated candidates, and malformed payloads.
- Wix valid signed JWTs for all four storefront mappings, separate/shared app-key isolation, invalid signatures, malformed payloads, unknown instances, exact Coupon Applied parsing, and `bodyAsJson` compatibility.
- First authoritative redemption, one redemption/event, exact replay, conflicting replay, DB-owned-code resolution, Wix/Shopify disable delegation, disabled-mapping exclusion, and post-commit disable failure.
- Encapsulated raw-body preservation, 2xx duplicate/irrelevant responses, authentication rejection, and retryable 5xx behavior.

## Runtime Setup Before Live Verification

1. Configure `WIX_WEBHOOK_PUBLIC_KEY` for the shared Wix app and `WIX_CIRCZLES_IN_WEBHOOK_PUBLIC_KEY` for the separate `circzles.in` app.
2. Subscribe both Wix apps to Coupons V2 Coupon Applied using the deployed HTTPS Wix callback route and confirm each installed instance maps to its intended storefront.
3. Register Shopify `orders/paid` for the canonical shop and the deployed HTTPS Shopify callback route.
4. Keep Shopify and Wix outbound credentials configured so sibling `PENDING_DISABLE` mappings can be deactivated after redemption.
5. Perform controlled Development-only provider webhook and database reconciliation tests before any Production rollout.
