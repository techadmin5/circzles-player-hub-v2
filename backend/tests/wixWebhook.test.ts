import { generateKeyPairSync, sign } from "node:crypto";
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

function event(overrides: Record<string, unknown> = {}) {
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

function jwt(instanceId: string, privateKey = shared.privateKey, data: unknown = event()) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    instanceId,
    eventType: "wix.ecommerce.coupons.v2.coupon_applied",
    data: JSON.stringify(data),
  })).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
  return Buffer.from(`${signingInput}.${signature}`);
}

describe("Wix Coupon Applied webhook", () => {
  it.each([
    ["WIX_CIRCZLES_IN", "instance-circzles-in", separate.privateKey],
    ["WIX_CIRCZLES_COM", "instance-circzles-com", shared.privateKey],
    ["WIX_COGZART_IN", "instance-cogzart-in", shared.privateKey],
    ["WIX_COGZART_COM", "instance-cogzart-com", shared.privateKey],
  ] as const)("verifies and maps %s", (storefront, instanceId, privateKey) => {
    const parsed = new WixCouponAppliedWebhook(identities).verifyAndParse(jwt(instanceId, privateKey));
    expect(parsed).toMatchObject({
      provider: "WIX",
      storefrontTarget: storefront,
      providerEventId: "wix-event-1",
      providerOrderId: "wix-order-1",
      couponCodes: ["CZB3SMOKE260922"],
    });
  });

  it("rejects an invalid signature and malformed JWT", () => {
    const webhook = new WixCouponAppliedWebhook(identities);
    expect(() => webhook.verifyAndParse(jwt("instance-circzles-com", unrelated.privateKey))).toThrowError(expect.objectContaining({ code: "WIX_WEBHOOK_UNAUTHORIZED" }));
    expect(() => webhook.verifyAndParse(Buffer.from("not-a-jwt"))).toThrowError(expect.objectContaining({ code: "WIX_WEBHOOK_UNAUTHORIZED" }));
  });

  it("does not expose the signed token or public key in verification errors", () => {
    const token = jwt("instance-circzles-com", unrelated.privateKey);
    try {
      new WixCouponAppliedWebhook(identities).verifyAndParse(token);
      throw new Error("expected rejection");
    } catch (error) {
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain(token.toString("utf8"));
      expect(serialized).not.toContain(identities[1].publicKey!);
    }
  });

  it("fails closed for an unknown instance even when the shared app signature is valid", () => {
    expect(() => new WixCouponAppliedWebhook(identities).verifyAndParse(jwt("unknown-instance")))
      .toThrowError(expect.objectContaining({ code: "WIX_WEBHOOK_STOREFRONT_UNKNOWN" }));
  });

  it("rejects malformed or wrong event payloads", () => {
    const webhook = new WixCouponAppliedWebhook(identities);
    expect(() => webhook.verifyAndParse(jwt("instance-circzles-com", shared.privateKey, "bad")))
      .toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() => webhook.verifyAndParse(jwt("instance-circzles-com", shared.privateKey, event({ slug: "updated" }))))
      .toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });

  it("accepts the documented bodyAsJson action envelope", () => {
    const body = JSON.stringify((event().actionEvent as { body: unknown }).body);
    const parsed = new WixCouponAppliedWebhook(identities).verifyAndParse(jwt(
      "instance-circzles-com",
      shared.privateKey,
      event({ actionEvent: { bodyAsJson: body } }),
    ));
    expect(parsed.providerOrderId).toBe("wix-order-1");
  });
});
