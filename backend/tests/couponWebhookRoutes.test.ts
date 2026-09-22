import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { AppError } from "../src/domain/errors.js";
import type { CouponRedemptionWebhookHandler } from "../src/integrations/couponRedemptionWebhooks.js";
import { couponWebhookRoutes } from "../src/http/couponWebhookRoutes.js";

function app(handler: CouponRedemptionWebhookHandler) {
  const server = Fastify();
  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ code: error.code });
    return reply.status(500).send({ code: "INTERNAL_SERVER_ERROR" });
  });
  server.register(couponWebhookRoutes, { handler });
  return server;
}

describe("coupon webhook routes", () => {
  it("preserves the exact raw JSON bytes for Shopify HMAC verification", async () => {
    const payload = "{\n  \"id\": 123, \"discount_codes\": []\n}";
    let received: Buffer | undefined;
    const server = app({
      handleWix: async () => ({ status: "IGNORED" }),
      handleShopify: async (raw) => { received = raw; return { status: "IGNORED" }; },
    });
    const response = await server.inject({
      method: "POST",
      url: "/api/webhooks/shopify/orders-paid",
      headers: { "content-type": "application/json", "x-shopify-hmac-sha256": "test" },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(received?.equals(Buffer.from(payload))).toBe(true);
  });

  it.each(["DUPLICATE", "IGNORED"] as const)("returns 2xx for a valid %s event", async (status) => {
    const server = app({
      handleWix: async () => ({ status }),
      handleShopify: async () => ({ status }),
    });
    const response = await server.inject({ method: "POST", url: "/api/webhooks/wix/coupon-redemption", headers: { "content-type": "text/plain" }, payload: "signed.jwt.value" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, status });
  });

  it("returns 401 before domain processing when provider authentication fails", async () => {
    let processed = false;
    const server = app({
      handleWix: async () => { throw new AppError("WIX_WEBHOOK_UNAUTHORIZED", "Unauthorized.", 401); },
      handleShopify: async () => { processed = true; return { status: "REDEEMED" }; },
    });
    const response = await server.inject({ method: "POST", url: "/api/webhooks/wix/coupon-redemption", headers: { "content-type": "text/plain" }, payload: "bad.jwt.value" });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("WIX_WEBHOOK_UNAUTHORIZED");
    expect(processed).toBe(false);
  });

  it("returns a retryable 5xx when processing fails", async () => {
    const server = app({
      handleWix: async () => { throw new AppError("COUPON_DISABLE_RECONCILIATION_FAILED", "Retry.", 502); },
      handleShopify: async () => ({ status: "IGNORED" }),
    });
    const response = await server.inject({ method: "POST", url: "/api/webhooks/wix/coupon-redemption", headers: { "content-type": "text/plain" }, payload: "signed.jwt.value" });
    expect(response.statusCode).toBe(502);
  });
});
