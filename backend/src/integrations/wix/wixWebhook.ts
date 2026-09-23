import { verify } from "node:crypto";
import { AppError, validationFailed } from "../../domain/errors.js";
import type { ProviderCouponRedemptionEvent } from "../../domain/couponRedemptionSync.js";
import type { CouponStorefrontTarget } from "../../domain/couponBridge.js";

const WIX_COUPON_APPLIED_EVENT = "wix.ecommerce.coupons.v2.coupon_applied";
const WIX_COUPON_ENTITY = "wix.ecommerce.coupons.v2.coupon";

export interface WixWebhookIdentity {
  appId: string;
  publicKey?: string;
  instanceId?: string;
  storefrontTarget: Exclude<CouponStorefrontTarget, "SHOPIFY_COGZART">;
}

export class WixCouponAppliedWebhook {
  constructor(private identities: WixWebhookIdentity[]) {}

  verifyAndParse(rawBody: Buffer): ProviderCouponRedemptionEvent {
    const token = rawBody.toString("utf8").trim();
    const verified = verifyWixJwt(token, this.identities);
    const envelope = parseJsonStringRecord(verified.payload.data, "Wix webhook envelope is malformed.");
    const instanceId = nonblank(envelope.instanceId);
    if (!instanceId) throw validationFailed("Wix webhook instance id is invalid.");
    const identity = verified.identities.find((candidate) => candidate.instanceId?.trim() === instanceId);
    if (!identity) {
      throw new AppError("WIX_WEBHOOK_STOREFRONT_UNKNOWN", "Wix webhook storefront is not recognized.", 401);
    }
    const eventType = nonblank(envelope.eventType);
    if (eventType !== WIX_COUPON_APPLIED_EVENT) {
      throw validationFailed("Wix webhook event type is not Coupon Applied.");
    }

    const event = parseJsonStringRecord(envelope.data, "Wix Coupon Applied event is malformed.");
    if (event.entityFqdn !== WIX_COUPON_ENTITY || event.slug !== "applied") {
      throw validationFailed("Wix webhook event is not Coupon Applied.");
    }
    const body = readActionBody(event.actionEvent);
    const coupon = requireRecord(body.coupon, "Wix Coupon Applied payload is malformed.");
    const specification = requireRecord(coupon.specification, "Wix Coupon Applied payload is malformed.");
    const couponCode = readWrappedString(specification.code)?.toUpperCase() ?? null;
    const orderId = nonblank(body.wixAppOrderId);
    const eventId = nonblank(event.id);
    const redeemedAt = readDate(event.eventTime);
    if (!couponCode || !/^[A-Z0-9]{1,20}$/.test(couponCode)) throw validationFailed("Wix coupon code is invalid.");
    if (!orderId || orderId.length > 200) throw validationFailed("Wix coupon order id is invalid.");
    if (!eventId || eventId.length > 200) throw validationFailed("Wix coupon event id is invalid.");
    if (!redeemedAt) throw validationFailed("Wix coupon event time is invalid.");

    return {
      provider: "WIX",
      storefrontTarget: identity.storefrontTarget,
      providerEventId: eventId,
      providerOrderId: orderId,
      couponCodes: [couponCode],
      redeemedAt,
    };
  }
}

export function verifyWixJwt(token: string, identities: WixWebhookIdentity[]) {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) throw unauthorizedWix();
  const header = parseBase64UrlObject(parts[0]);
  if (header.alg !== "RS256") throw unauthorizedWix();
  const signature = decodeBase64Url(parts[2]);
  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
  const configured = identities.filter((identity) => identity.publicKey?.trim() && identity.instanceId?.trim());
  if (configured.length === 0) {
    throw new AppError("WIX_WEBHOOK_NOT_CONFIGURED", "Wix webhook verification is not configured.", 503);
  }
  const verified = configured.filter((candidate) => {
    try {
      return verify("RSA-SHA256", signingInput, normalizePublicKey(candidate.publicKey!), signature);
    } catch {
      return false;
    }
  });
  if (verified.length === 0) throw unauthorizedWix();
  return { identities: verified, payload: parseBase64UrlObject(parts[1]) };
}

function parseJsonStringRecord(value: unknown, message: string) {
  if (typeof value !== "string") throw validationFailed(message);
  try {
    return requireRecord(JSON.parse(value) as unknown, message);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw validationFailed(message);
  }
}

function readActionBody(value: unknown) {
  const action = requireRecord(value, "Wix Coupon Applied payload is malformed.");
  if (isRecord(action.body)) return action.body;
  if (typeof action.bodyAsJson === "string") {
    try {
      return requireRecord(JSON.parse(action.bodyAsJson) as unknown, "Wix Coupon Applied payload is malformed.");
    } catch (error) {
      if (error instanceof AppError) throw error;
    }
  }
  throw validationFailed("Wix Coupon Applied payload is malformed.");
}

function parseBase64UrlObject(value: string) {
  try {
    return requireRecord(JSON.parse(decodeBase64Url(value).toString("utf8")) as unknown, "Wix webhook token is malformed.");
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION_FAILED") throw unauthorizedWix();
    throw unauthorizedWix();
  }
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw unauthorizedWix();
  return Buffer.from(value, "base64url");
}

function normalizePublicKey(value: string) {
  const unescaped = value.trim().replace(/\\n/g, "\n");
  if (unescaped.includes("BEGIN PUBLIC KEY")) return unescaped;
  const decoded = Buffer.from(unescaped.replace(/\s/g, ""), "base64").toString("utf8");
  return decoded.includes("BEGIN PUBLIC KEY") ? decoded : unescaped;
}

function readWrappedString(value: unknown) {
  if (typeof value === "string") return nonblank(value);
  return isRecord(value) ? nonblank(value.value) : null;
}

function readDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw validationFailed(message);
  return value;
}

function nonblank(value: unknown) {
  return typeof value === "string" ? value.trim() || null : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unauthorizedWix() {
  return new AppError("WIX_WEBHOOK_UNAUTHORIZED", "Wix webhook authentication failed.", 401);
}
