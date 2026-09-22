import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WixCouponAppliedWebhook, type WixWebhookIdentity } from "../src/integrations/wix/wixWebhook.js";

const shared = generateKeyPairSync("rsa", { modulusLength: 2048 });
const separate = generateKeyPairSync("rsa", { modulusLength: 2048 });
const unrelated = generateKeyPairSync("rsa", { modulusLength: 2048 });

const identities: WixWebhookIdentity[] = [
  identity("WIX_CIRCZLES_IN", "instance-circzles-in", separate.publicKey.export({ type: "spki", format: "pem" }).toString(), "app-separate"),
  identity("WIX_CIRCZLES_COM", "instance-circzles-com", shared.publicKey.export({ type: "spki", format: "pem" }).toString()),
  identity("WIX_COGZART_IN", "instance-cogzart-in", shared.publicKey.export({ type: "spki", format: "pem" }).toString()),
  identity("WIX_COGZART_COM", "instance-cogzart-com", shared.publicKey.export({ type: "spki", format: "pem" }).toString()),
];

function identity(storefrontTarget: WixWebhookIdentity["storefrontTarget"], instanceId: string, publicKey: string, appId = "app-shared"): WixWebhookIdentity {
  return { storefrontTarget, instanceId, publicKey, appId };
}

function couponAppliedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "wix-event-1",
    entityFqdn: "wix.ecommerce.coupons.v2.coupon",
    slug: "applied",
    entityId: "wix-coupon-1",
    actionEvent: { body: {
      coupon: { specification: { code: { value: "CZB3SMOKE260922" } } },
      wixAppOrderId: "wix-order-1",
    } },
    eventTime: "2026-09-22T10:00:00.000Z",
    ...overrides,
  };
}

function wixEnvelope(instanceId: unknown, innerEvent: unknown = couponAppliedEvent(), overrides: Record<string, unknown> = {}) {
  return {
    instanceId,
    eventType: "wix.ecommerce.coupons.v2.coupon_applied",
    data: JSON.stringify(innerEvent),
    ...overrides,
  };
}

function signedJwt(payload: unknown, privateKey: KeyObject = shared.privateKey) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${header}.${encodedPayload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
  return Buffer.from(`${signingInput}.${signature}`);
}

function wixJwt(instanceId: unknown, privateKey = shared.privateKey, innerEvent: unknown = couponAppliedEvent(), envelopeOverrides: Record<string, unknown> = {}) {
  return signedJwt({ data: JSON.stringify(wixEnvelope(instanceId, innerEvent, envelopeOverrides)) }, privateKey);
}

describe("Wix Coupon Applied webhook", () => {
  it.each([
    ["WIX_CIRCZLES_IN", "instance-circzles-in", separate.privateKey],
    ["WIX_CIRCZLES_COM", "instance-circzles-com", shared.privateKey],
    ["WIX_COGZART_IN", "instance-cogzart-in", shared.privateKey],
    ["WIX_COGZART_COM", "instance-cogzart-com", shared.privateKey],
  ] as const)("verifies the two-stage envelope and maps %s", (storefront, instanceId, privateKey) => {
    const parsed = new WixCouponAppliedWebhook(identities).verifyAndParse(wixJwt(instanceId, privateKey));
    expect(parsed).toMatchObject({ provider: "WIX", storefrontTarget: storefront, providerEventId: "wix-event-1", providerOrderId: "wix-order-1", couponCodes: ["CZB3SMOKE260922"] });
    expect(parsed.redeemedAt.toISOString()).toBe("2026-09-22T10:00:00.000Z");
  });

  it("rejects an invalid signature and malformed JWT", () => {
    const webhook = new WixCouponAppliedWebhook(identities);
    expect(() => webhook.verifyAndParse(wixJwt("instance-circzles-com", unrelated.privateKey))).toThrowError(expect.objectContaining({ code: "WIX_WEBHOOK_UNAUTHORIZED" }));
    expect(() => webhook.verifyAndParse(Buffer.from("not-a-jwt"))).toThrowError(expect.objectContaining({ code: "WIX_WEBHOOK_UNAUTHORIZED" }));
  });

  it("requires JWT payload.data to contain valid outer-envelope JSON", () => {
    const webhook = new WixCouponAppliedWebhook(identities);
    expect(() => webhook.verifyAndParse(signedJwt({}))).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() => webhook.verifyAndParse(signedJwt({ data: "{" }))).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });

  it("rejects missing or malformed outer instance identity", () => {
    const webhook = new WixCouponAppliedWebhook(identities);
    expect(() => webhook.verifyAndParse(wixJwt(undefined))).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() => webhook.verifyAndParse(wixJwt({ bad: true }))).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });

  it("requires the exact outer event type and JSON-string inner data", () => {
    const webhook = new WixCouponAppliedWebhook(identities);
    expect(() => webhook.verifyAndParse(wixJwt("instance-circzles-com", shared.privateKey, couponAppliedEvent(), { eventType: "wrong.event" }))).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() => webhook.verifyAndParse(wixJwt("instance-circzles-com", shared.privateKey, couponAppliedEvent(), { data: "{" }))).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() => webhook.verifyAndParse(wixJwt("instance-circzles-com", shared.privateKey, couponAppliedEvent(), { data: { not: "a string" } }))).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });

  it("rejects the wrong entity FQDN or slug", () => {
    const webhook = new WixCouponAppliedWebhook(identities);
    expect(() => webhook.verifyAndParse(wixJwt("instance-circzles-com", shared.privateKey, couponAppliedEvent({ entityFqdn: "wrong.entity" })))).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() => webhook.verifyAndParse(wixJwt("instance-circzles-com", shared.privateKey, couponAppliedEvent({ slug: "updated" })))).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });

  it("fails closed for an unknown instance even when the shared app signature is valid", () => {
    expect(() => new WixCouponAppliedWebhook(identities).verifyAndParse(wixJwt("unknown-instance"))).toThrowError(expect.objectContaining({ code: "WIX_WEBHOOK_STOREFRONT_UNKNOWN" }));
  });

  it("does not allow either Wix app key to authenticate the other app's instance", () => {
    const webhook = new WixCouponAppliedWebhook(identities);
    expect(() => webhook.verifyAndParse(wixJwt("instance-circzles-com", separate.privateKey))).toThrowError(expect.objectContaining({ code: "WIX_WEBHOOK_STOREFRONT_UNKNOWN" }));
    expect(() => webhook.verifyAndParse(wixJwt("instance-circzles-in", shared.privateKey))).toThrowError(expect.objectContaining({ code: "WIX_WEBHOOK_STOREFRONT_UNKNOWN" }));
  });

  it("does not expose the signed token or public key in verification errors", () => {
    const token = wixJwt("instance-circzles-com", unrelated.privateKey);
    try {
      new WixCouponAppliedWebhook(identities).verifyAndParse(token);
      throw new Error("expected rejection");
    } catch (error) {
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain(token.toString("utf8"));
      expect(serialized).not.toContain(identities[1].publicKey!);
    }
  });

  it("retains bodyAsJson compatibility inside the parsed entity event", () => {
    const body = JSON.stringify((couponAppliedEvent().actionEvent as { body: unknown }).body);
    const parsed = new WixCouponAppliedWebhook(identities).verifyAndParse(wixJwt("instance-circzles-com", shared.privateKey, couponAppliedEvent({ actionEvent: { bodyAsJson: body } })));
    expect(parsed.providerOrderId).toBe("wix-order-1");
  });
});
