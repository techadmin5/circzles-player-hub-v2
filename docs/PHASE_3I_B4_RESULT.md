# Phase 3I-B4 Result: Inbound Coupon Redemption Synchronization

## Status

IMPLEMENTED, AUTOMATED-TESTED, AND PROVIDER-TRANSPORT LIVE-VERIFIED.

No database migration was generated or run for B4, and no Production database migration is required. Provider transport was verified as described below; this was not a full paid-order test across every storefront.

## Inbound Provider Routes

- `POST /api/webhooks/wix/coupon-redemption`
- `POST /api/webhooks/shopify/orders-paid`

These are provider-authenticated callback routes, not player-session or browser endpoints. Responses expose only a safe processing status. Valid processed events, exact duplicates, and irrelevant events return 2xx. Invalid provider authentication returns 401, malformed payloads return 400, and retryable internal or provider-disable failures return 5xx.

Both routes are registered in an encapsulated Fastify plugin. Only that plugin replaces the inherited JSON/text parsers with buffer parsers, preserving the exact request bytes for cryptographic verification without changing JSON parsing elsewhere.

## Wix Coupon Applied

B4 uses the official Wix Coupons V2 **Coupon Applied** event, event type `wix.ecommerce.coupons.v2.coupon_applied`. Wix documents this event as occurring when an order using the coupon is completed or manually marked paid, so it represents completed/paid coupon use rather than a checkout button click or deprecated Velo `onOrderPaid` behavior.

The signed JWT is read from the raw request body. Its RS256 signature is verified with the Wix app webhook public key before any event data is trusted. Parsing then follows the official self-hosted envelope exactly: signed JWT -> verified JWT `payload.data` JSON string -> Wix event envelope -> envelope `data` JSON string -> Coupons V2 Coupon Applied entity event. The outer Wix envelope supplies `instanceId` and `eventType`; the inner entity event supplies the expected entity/slug, coupon code at `actionEvent.body.coupon.specification.code` as either a raw string or wrapped `{ value }`, provider order identity at `actionEvent.body.wixAppOrderId`, stable event `id`, and `eventTime`. Coupon codes are trimmed, normalized to uppercase, and then required to match the unchanged 1-20 uppercase ASCII alphanumeric canonical format.

The separate `circzles.in` Wix app uses `WIX_CIRCZLES_IN_WEBHOOK_PUBLIC_KEY`. The original shared app uses `WIX_WEBHOOK_PUBLIC_KEY` for the other three Wix storefronts. A valid signature alone is insufficient: `instanceId` from the parsed, signature-protected Wix event envelope must map to exactly one storefront assigned to the same verified app key. Unknown or cross-app instances fail closed. Secrets, public-key material, and raw signed tokens are never logged or returned.

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

## Live Provider Verification

### Wix

- A real `circzles.in` Coupons V2 Coupon Applied event reached `POST /api/webhooks/wix/coupon-redemption` from the configured live storefront instance.
- The real payload supplied lowercase `specification.code`; the parser's canonical uppercase normalization was added and verified.
- The final real-order webhook returned HTTP 200.
- Wix dashboard **Test** events use a Wix development/test instance rather than the configured live storefront instance. They correctly fail closed with `WIX_WEBHOOK_STOREFRONT_UNKNOWN` and HTTP 401; this does not indicate a failure of the live storefront mapping.
- The shared Wix app for `circzles.com`, `cogzart.in`, and `cogzart.com` was configured with the Coupon Applied webhook and correct public key, and a released app version delivered a dashboard Test request to the backend. No real payment or paid-order test was performed on those three storefronts.

### Shopify

- The installed app was released and approved with `read_discounts`, `write_discounts`, and `read_orders`; `currentAppInstallation.accessScopes` confirmed all three.
- The `ORDERS_PAID` webhook subscription was created with ID `gid://shopify/WebhookSubscription/2273199849638` for `POST /api/webhooks/shopify/orders-paid`.
- A synthetic webhook with a valid Shopify signature reached the callback and returned HTTP 200 with `{ ok: true, status: "IGNORED" }`.
- No real Shopify payment or paid-order test was performed.

### PostgreSQL Runtime Stability

Live webhook testing exposed a checked-out `pg.Client` error-listener gap during connection termination. Pool lifecycle handling now covers checked-out clients as well as idle pool errors: broken clients are logged and discarded without crashing the Node process, while active query/transaction failures and mission processor failures continue to surface normally.

## Migration Status

No migration was required or generated. B4 reuses the existing `coupon_ownerships`, `coupon_provider_mappings`, and `coupon_redemptions` structure from migration `0018_brave_wild_child.sql`.

## Automated Validation

Tests use generated test RSA keys, fake HMAC secrets, injected handlers, repositories, gateways, and sync services. They make no external calls. Coverage includes:

- Shopify valid/invalid/missing/malformed HMAC, constant-time length guard, configured-shop validation, paid order parsing, no discount, unrelated candidates, and malformed payloads.
- Wix valid nested self-hosted JWT/envelope/entity fixtures for all four storefront mappings, separate/shared app-key isolation, invalid signatures, missing or malformed outer/inner JSON, wrong event/entity/slug, unknown instances, raw/wrapped lowercase code normalization, invalid-code rejection, exact field extraction, and inner `bodyAsJson` compatibility.
- First authoritative redemption, one redemption/event, exact replay, conflicting replay, DB-owned-code resolution, Wix/Shopify disable delegation, disabled-mapping exclusion, and post-commit disable failure.
- Encapsulated raw-body preservation, 2xx duplicate/irrelevant responses, authentication rejection, and retryable 5xx behavior.

## Verification Boundaries

- B4 required no schema migration and no Production database migration.
- The `circzles.in` Wix path was verified with a real order. The shared Wix storefronts and Shopify path were transport/authentication checks only.
- Real USD payment testing was intentionally not performed for the shared Wix storefronts or Shopify closeout.
- The backend remains authoritative for redemption. Provider disable failures remain retryable and cannot roll back or reactivate an accepted redemption.
- The cross-provider simultaneous-redemption race described above remains; B4 does not make independent provider checkouts globally atomic.
