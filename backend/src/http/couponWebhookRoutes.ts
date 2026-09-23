import type { FastifyPluginAsync } from "fastify";
import { AppError, validationFailed } from "../domain/errors.js";
import type { CouponRedemptionWebhookHandler } from "../integrations/couponRedemptionWebhooks.js";

export interface CouponWebhookRouteOptions {
  handler?: CouponRedemptionWebhookHandler;
}

export const couponWebhookRoutes: FastifyPluginAsync<CouponWebhookRouteOptions> = async (app, options) => {
  app.removeContentTypeParser(["application/json", "text/plain"]);
  app.addContentTypeParser(["application/json", "text/plain"], { parseAs: "buffer" }, (_request, body, done) => done(null, body));

  app.post("/api/webhooks/wix/coupon-redemption", async (request, reply) => {
    const handler = requireHandler(options.handler);
    const result = await handler.handleWix(requireRawBody(request.body));
    return reply.send({ ok: true, status: result.status });
  });

  app.post("/api/webhooks/shopify/orders-paid", async (request, reply) => {
    const handler = requireHandler(options.handler);
    const result = await handler.handleShopify(requireRawBody(request.body), {
      hmac: header(request.headers["x-shopify-hmac-sha256"]),
      shopDomain: header(request.headers["x-shopify-shop-domain"]),
      webhookId: header(request.headers["x-shopify-webhook-id"]),
      eventId: header(request.headers["x-shopify-event-id"]),
      triggeredAt: header(request.headers["x-shopify-triggered-at"]),
      topic: header(request.headers["x-shopify-topic"]),
    });
    return reply.send({ ok: true, status: result.status });
  });
};

function requireRawBody(body: unknown) {
  if (!Buffer.isBuffer(body)) throw validationFailed("Webhook request body is malformed.");
  return body;
}

function requireHandler(handler: CouponRedemptionWebhookHandler | undefined) {
  if (!handler) throw new AppError("WEBHOOKS_NOT_CONFIGURED", "Provider webhooks are not configured.", 503);
  return handler;
}

function header(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
