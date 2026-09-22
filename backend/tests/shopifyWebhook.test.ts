import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ShopifyOrdersPaidWebhook, verifyShopifyHmac } from "../src/integrations/shopify/shopifyWebhook.js";

const secret = "test-shopify-webhook-secret";
const shopDomain = "rsgybz-wx.myshopify.com";

function body(overrides: Record<string, unknown> = {}) {
  return Buffer.from(JSON.stringify({
    id: 123456789,
    processed_at: "2026-09-22T10:00:00.000Z",
    discount_codes: [{ code: "CZB3SMOKE260922" }],
    ...overrides,
  }));
}

function headers(raw: Buffer, overrides: Record<string, string | undefined> = {}) {
  return {
    hmac: createHmac("sha256", secret).update(raw).digest("base64"),
    shopDomain,
    webhookId: "shopify-delivery-1",
    eventId: "shopify-event-1",
    triggeredAt: "2026-09-22T10:00:01.000Z",
    topic: "orders/paid",
    ...overrides,
  };
}

describe("Shopify orders/paid webhook", () => {
  it("verifies the exact raw body and normalizes an owned-code candidate", () => {
    const raw = body();
    const event = new ShopifyOrdersPaidWebhook({ clientSecret: secret, shopDomain }).verifyAndParse(raw, headers(raw));
    expect(event).toMatchObject({
      provider: "SHOPIFY",
      storefrontTarget: "SHOPIFY_COGZART",
      providerEventId: "shopify-event-1",
      providerOrderId: "123456789",
      couponCodes: ["CZB3SMOKE260922"],
    });
    expect(event?.redeemedAt.toISOString()).toBe("2026-09-22T10:00:00.000Z");
  });

  it("rejects invalid, missing, malformed, and unequal-length HMAC values", () => {
    const raw = body();
    expect(() => verifyShopifyHmac(raw, undefined, secret)).toThrowError(expect.objectContaining({ code: "SHOPIFY_WEBHOOK_UNAUTHORIZED" }));
    expect(() => verifyShopifyHmac(raw, "not-base64!", secret)).toThrowError(expect.objectContaining({ code: "SHOPIFY_WEBHOOK_UNAUTHORIZED" }));
    expect(() => verifyShopifyHmac(raw, Buffer.from("short").toString("base64"), secret)).toThrowError(expect.objectContaining({ code: "SHOPIFY_WEBHOOK_UNAUTHORIZED" }));
    expect(() => verifyShopifyHmac(Buffer.from("changed"), headers(raw).hmac, secret)).toThrowError(expect.objectContaining({ code: "SHOPIFY_WEBHOOK_UNAUTHORIZED" }));
  });

  it("rejects a different shop domain after HMAC verification", () => {
    const raw = body();
    const webhook = new ShopifyOrdersPaidWebhook({ clientSecret: secret, shopDomain });
    expect(() => webhook.verifyAndParse(raw, headers(raw, { shopDomain: "other.myshopify.com" })))
      .toThrowError(expect.objectContaining({ code: "SHOPIFY_WEBHOOK_UNAUTHORIZED" }));
  });

  it("does not expose the Shopify secret or raw payload in authentication errors", () => {
    const raw = body();
    try {
      new ShopifyOrdersPaidWebhook({ clientSecret: secret, shopDomain }).verifyAndParse(raw, headers(raw, { hmac: "invalid" }));
      throw new Error("expected rejection");
    } catch (error) {
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain(raw.toString("utf8"));
    }
  });

  it("returns irrelevant for paid orders with no usable discount code", () => {
    const webhook = new ShopifyOrdersPaidWebhook({ clientSecret: secret, shopDomain });
    const noDiscount = body({ discount_codes: [] });
    const unrelatedFormat = body({ discount_codes: [{ code: "not a canonical code" }] });
    expect(webhook.verifyAndParse(noDiscount, headers(noDiscount))).toBeNull();
    expect(webhook.verifyAndParse(unrelatedFormat, headers(unrelatedFormat))).toBeNull();
  });

  it("keeps all canonical candidates so ownership is resolved only by CircZles DB records", () => {
    const raw = body({ discount_codes: [{ code: "OTHER20" }, { code: "CZB3SMOKE260922" }, { code: "OTHER20" }] });
    const event = new ShopifyOrdersPaidWebhook({ clientSecret: secret, shopDomain }).verifyAndParse(raw, headers(raw));
    expect(event?.couponCodes).toEqual(["OTHER20", "CZB3SMOKE260922"]);
  });

  it("rejects malformed JSON, discount arrays, ids, and timestamps safely", () => {
    const webhook = new ShopifyOrdersPaidWebhook({ clientSecret: secret, shopDomain });
    const malformed = Buffer.from("{");
    expect(() => webhook.verifyAndParse(malformed, headers(malformed))).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    for (const raw of [body({ discount_codes: {} }), body({ id: {} })]) {
      expect(() => webhook.verifyAndParse(raw, headers(raw))).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    }
    const invalidTimestamp = body({ processed_at: "invalid" });
    expect(() => webhook.verifyAndParse(invalidTimestamp, headers(invalidTimestamp, { triggeredAt: undefined })))
      .toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });
});
