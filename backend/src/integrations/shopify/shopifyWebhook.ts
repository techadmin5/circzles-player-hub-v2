import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError, validationFailed } from "../../domain/errors.js";
import type { ProviderCouponRedemptionEvent } from "../../domain/couponRedemptionSync.js";

export interface ShopifyWebhookHeaders {
  hmac?: string;
  shopDomain?: string;
  webhookId?: string;
  eventId?: string;
  triggeredAt?: string;
  topic?: string;
}

export class ShopifyOrdersPaidWebhook {
  constructor(private config: { clientSecret?: string; shopDomain?: string }) {}

  verifyAndParse(rawBody: Buffer, headers: ShopifyWebhookHeaders): ProviderCouponRedemptionEvent | null {
    const secret = this.config.clientSecret?.trim();
    const configuredShop = this.config.shopDomain?.trim().toLowerCase();
    if (!secret || !configuredShop) {
      throw new AppError("SHOPIFY_WEBHOOK_NOT_CONFIGURED", "Shopify webhook verification is not configured.", 503);
    }
    verifyShopifyHmac(rawBody, headers.hmac, secret);
    if (headers.shopDomain?.trim().toLowerCase() !== configuredShop) {
      throw new AppError("SHOPIFY_WEBHOOK_UNAUTHORIZED", "Shopify webhook authentication failed.", 401);
    }
    if (headers.topic?.trim().toLowerCase() !== "orders/paid") {
      throw validationFailed("Shopify webhook topic is not orders/paid.");
    }

    const eventId = nonblank(headers.eventId) ?? nonblank(headers.webhookId);
    if (!eventId || eventId.length > 200) throw validationFailed("Shopify webhook event id is invalid.");
    const payload = parseJsonObject(rawBody, "Shopify webhook payload is malformed.");
    const orderId = readIdentifier(payload.id);
    if (!orderId || orderId.length > 200) throw validationFailed("Shopify paid order id is invalid.");
    const discountCodes = payload.discount_codes;
    if (!Array.isArray(discountCodes)) throw validationFailed("Shopify paid order discounts are malformed.");
    const couponCodes = [...new Set(discountCodes.map(readDiscountCode).filter((code): code is string => code !== null))];
    if (couponCodes.length === 0) return null;
    const redeemedAt = readDate(payload.processed_at) ?? readDate(headers.triggeredAt);
    if (!redeemedAt) throw validationFailed("Shopify paid order timestamp is invalid.");

    return {
      provider: "SHOPIFY",
      storefrontTarget: "SHOPIFY_COGZART",
      providerEventId: eventId,
      providerOrderId: orderId,
      couponCodes,
      redeemedAt,
    };
  }
}

export function verifyShopifyHmac(rawBody: Buffer, receivedHmac: string | undefined, secret: string) {
  const provided = nonblank(receivedHmac);
  if (!provided) throw new AppError("SHOPIFY_WEBHOOK_UNAUTHORIZED", "Shopify webhook authentication failed.", 401);
  let actual: Buffer;
  try {
    actual = Buffer.from(provided, "base64");
  } catch {
    throw new AppError("SHOPIFY_WEBHOOK_UNAUTHORIZED", "Shopify webhook authentication failed.", 401);
  }
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("base64"), "base64");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new AppError("SHOPIFY_WEBHOOK_UNAUTHORIZED", "Shopify webhook authentication failed.", 401);
  }
}

function readDiscountCode(value: unknown) {
  if (!isRecord(value)) throw validationFailed("Shopify paid order discounts are malformed.");
  const code = nonblank(value.code);
  return code && /^[A-Z0-9]{1,20}$/.test(code) ? code : null;
}

function parseJsonObject(rawBody: Buffer, message: string) {
  try {
    const parsed = JSON.parse(rawBody.toString("utf8")) as unknown;
    if (isRecord(parsed)) return parsed;
  } catch {
    // Mapped to one provider-safe validation error below.
  }
  throw validationFailed(message);
}

function readIdentifier(value: unknown) {
  if (typeof value === "string") return nonblank(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

function readDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nonblank(value: unknown) {
  return typeof value === "string" ? value.trim() || null : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
