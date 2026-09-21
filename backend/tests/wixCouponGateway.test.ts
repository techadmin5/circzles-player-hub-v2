import { describe, expect, it } from "vitest";
import type { CouponProvisionRequest, CouponStorefrontTarget } from "../src/domain/couponBridge.js";
import {
  WixCouponGateway,
  buildWixCreateCouponBody,
  resolveWixCouponStorefront,
  wixCouponStorefronts,
  type WixCouponHttpClient,
} from "../src/integrations/wix/wixCouponGateway.js";

type HttpCall = { url: string; init: RequestInit };

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fetchSequence(...responses: Array<Response | Error>) {
  const calls: HttpCall[] = [];
  const fetchImpl: WixCouponHttpClient = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error("No fake response configured.");
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetchImpl };
}

function request(overrides: Partial<CouponProvisionRequest> = {}): CouponProvisionRequest {
  return {
    couponOwnershipId: "70000000-0000-4000-8000-000000000001",
    couponCode: "CZ95F70BA56FDCF99B",
    storefrontTarget: "WIX_CIRCZLES_IN",
    provider: "WIX",
    benefit: { type: "PERCENTAGE", percentage: 20 },
    startsAt: new Date("2026-09-21T05:00:00.000Z"),
    expiresAt: new Date("2026-10-21T05:00:00.000Z"),
    totalUsageLimit: 1,
    perCustomerUsageLimit: 1,
    ...overrides,
  };
}

function headers(call: HttpCall) {
  return new Headers(call.init.headers);
}

function body(call: HttpCall) {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

describe("Wix coupon storefront configuration", () => {
  it("maps all four Wix storefronts to the confirmed site, domain, and currency", () => {
    expect(wixCouponStorefronts).toEqual({
      WIX_CIRCZLES_IN: { domain: "https://www.circzles.in/", wixSiteId: "5cd5bcc4-823e-485a-b791-c22fb487aaf8", currency: "INR" },
      WIX_CIRCZLES_COM: { domain: "https://www.circzles.com/", wixSiteId: "b5d3a6d5-bc44-44d4-9b14-e7b673bfd171", currency: "USD" },
      WIX_COGZART_IN: { domain: "https://www.cogzart.in/", wixSiteId: "d37a119e-a978-451f-a39f-c33f6b1d145f", currency: "INR" },
      WIX_COGZART_COM: { domain: "https://www.cogzart.com/", wixSiteId: "35afe62f-b860-4e10-b033-918b8577a870", currency: "USD" },
    });
  });

  it("rejects the Shopify storefront", () => {
    expect(() => resolveWixCouponStorefront("SHOPIFY_COGZART")).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });
});

describe("Wix coupon request mapping", () => {
  it("maps percentage benefits and all required Wix fields", () => {
    const result = buildWixCreateCouponBody(request());
    expect(result).toEqual({ specification: {
      name: "CircZles Reward CZ95F70BA56FDCF99B",
      code: "CZ95F70BA56FDCF99B",
      startTime: "1789966800000",
      expirationTime: "1792558800000",
      usageLimit: 1,
      limitPerCustomer: 1,
      active: true,
      scope: { namespace: "stores" },
      percentOffRate: 20,
    } });
    expect(result.specification).not.toHaveProperty("limitedToOneItem");
    expect(result.specification.name).not.toMatch(/player|email/i);
  });

  it("uses the B1-selected fixed INR and USD amounts as moneyOffAmount", () => {
    expect(buildWixCreateCouponBody(request({ benefit: { type: "FIXED_AMOUNT", currency: "INR", amount: 500 } })).specification).toMatchObject({ moneyOffAmount: 500 });
    expect(buildWixCreateCouponBody(request({ storefrontTarget: "WIX_CIRCZLES_COM", benefit: { type: "FIXED_AMOUNT", currency: "USD", amount: 6 } })).specification).toMatchObject({ moneyOffAmount: 6 });
  });

  it("omits expirationTime when the ownership has no expiration", () => {
    expect(buildWixCreateCouponBody(request({ expiresAt: null })).specification).not.toHaveProperty("expirationTime");
  });
});

describe("Wix coupon HTTP gateway", () => {
  it("queries safely, then creates with API-key and site headers", async () => {
    const fake = fetchSequence(response({ coupons: [] }), response({ id: "wix-coupon-1" }));
    const gateway = new WixCouponGateway({ apiKey: "test-secret-key", fetchImpl: fake.fetchImpl });
    await expect(gateway.provision(request())).resolves.toEqual({ providerCouponId: "wix-coupon-1" });

    expect(fake.calls.map((call) => [call.init.method, call.url])).toEqual([
      ["POST", "https://www.wixapis.com/stores/v2/coupons/query"],
      ["POST", "https://www.wixapis.com/stores/v2/coupons"],
    ]);
    expect(headers(fake.calls[1]).get("Authorization")).toBe("test-secret-key");
    expect(headers(fake.calls[1]).get("wix-site-id")).toBe("5cd5bcc4-823e-485a-b791-c22fb487aaf8");
    expect(headers(fake.calls[1]).get("Content-Type")).toBe("application/json");
    expect(body(fake.calls[1])).toEqual(buildWixCreateCouponBody(request()));
    expect(JSON.stringify(body(fake.calls[0]))).toContain("CZ95F70BA56FDCF99B");
  });

  it("reuses one exact code match without creating another coupon", async () => {
    const fake = fetchSequence(response({ coupons: [{ id: "existing-wix-id", specification: { code: "CZ95F70BA56FDCF99B" } }] }));
    const gateway = new WixCouponGateway({ apiKey: "test-secret-key", fetchImpl: fake.fetchImpl });
    await expect(gateway.provision(request())).resolves.toEqual({ providerCouponId: "existing-wix-id" });
    expect(fake.calls).toHaveLength(1);
  });

  it("ignores unrelated query rows and proceeds to create", async () => {
    const fake = fetchSequence(response({ coupons: [{ id: "other", specification: { code: "OTHER" } }] }), response({ id: "created-id" }));
    const gateway = new WixCouponGateway({ apiKey: "test-secret-key", fetchImpl: fake.fetchImpl });
    await expect(gateway.provision(request())).resolves.toEqual({ providerCouponId: "created-id" });
    expect(fake.calls).toHaveLength(2);
  });

  it("rejects ambiguous exact-code recovery", async () => {
    const coupon = { specification: { code: "CZ95F70BA56FDCF99B" } };
    const fake = fetchSequence(response({ coupons: [{ id: "one", ...coupon }, { id: "two", ...coupon }] }));
    const gateway = new WixCouponGateway({ apiKey: "test-secret-key", fetchImpl: fake.fetchImpl });
    await expect(gateway.provision(request())).rejects.toMatchObject({ code: "WIX_COUPON_RECOVERY_AMBIGUOUS" });
    expect(fake.calls).toHaveLength(1);
  });

  it("does not duplicate a remote coupon when a later retry can recover it", async () => {
    let created = false;
    const calls: HttpCall[] = [];
    const fetchImpl: WixCouponHttpClient = async (input, init = {}) => {
      calls.push({ url: String(input), init });
      if (String(input).endsWith("/query")) return response({ coupons: created ? [{ id: "stable-id", specification: { code: "CZ95F70BA56FDCF99B" } }] : [] });
      created = true;
      return response({ id: "stable-id" });
    };
    const gateway = new WixCouponGateway({ apiKey: "test-secret-key", fetchImpl });
    await gateway.provision(request());
    await gateway.provision(request());
    expect(calls.filter((call) => call.url === "https://www.wixapis.com/stores/v2/coupons")).toHaveLength(1);
  });

  it("rejects blank or missing create ids", async () => {
    for (const malformed of [{}, { id: " " }]) {
      const fake = fetchSequence(response({ coupons: [] }), response(malformed));
      const gateway = new WixCouponGateway({ apiKey: "test-secret-key", fetchImpl: fake.fetchImpl });
      await expect(gateway.provision(request())).rejects.toMatchObject({ code: "WIX_COUPON_RESPONSE_INVALID" });
    }
  });

  it("disables the exact provider coupon using the required field mask", async () => {
    const fake = fetchSequence(response({}));
    const gateway = new WixCouponGateway({ apiKey: "test-secret-key", fetchImpl: fake.fetchImpl });
    await gateway.disable({ storefrontTarget: "WIX_COGZART_COM", providerCouponId: "wix/id", couponCode: "CZ95F70BA56FDCF99B" });
    expect(fake.calls[0].url).toBe("https://www.wixapis.com/stores/v2/coupons/wix%2Fid");
    expect(fake.calls[0].init.method).toBe("PATCH");
    expect(headers(fake.calls[0]).get("wix-site-id")).toBe("35afe62f-b860-4e10-b033-918b8577a870");
    expect(body(fake.calls[0])).toEqual({ fieldMask: { paths: ["active"] }, specification: { active: false } });
  });

  it("loads WIX_API_KEY only when an operation is attempted", async () => {
    const gateway = new WixCouponGateway({ getApiKey: () => undefined, fetchImpl: async () => { throw new Error("must not call fetch"); } });
    await expect(gateway.provision(request())).rejects.toMatchObject({ code: "WIX_API_KEY_MISSING" });
  });

  it.each([401, 403, 409, 429, 500])("handles Wix HTTP %s without leaking the API key", async (status) => {
    const apiKey = "do-not-leak-this-key";
    const fake = fetchSequence(response({ message: apiKey }, status));
    const gateway = new WixCouponGateway({ apiKey, fetchImpl: fake.fetchImpl });
    const error = await gateway.provision(request()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "WIX_COUPON_HTTP_ERROR", details: { operation: "QUERY", httpStatus: status, storefront: "WIX_CIRCZLES_IN" } });
    expect(JSON.stringify(error)).not.toContain(apiKey);
    expect(String(error)).not.toContain(apiKey);
  });

  it("does not leak the API key from an ambiguous transport failure", async () => {
    const apiKey = "do-not-leak-this-key";
    const fake = fetchSequence(new Error(`network failed with ${apiKey}`));
    const gateway = new WixCouponGateway({ apiKey, fetchImpl: fake.fetchImpl });
    const error = await gateway.provision(request()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "WIX_COUPON_REQUEST_FAILED" });
    expect(JSON.stringify(error)).not.toContain(apiKey);
  });

  it("rejects Shopify before making an HTTP request", async () => {
    const calls: CouponStorefrontTarget[] = [];
    const gateway = new WixCouponGateway({ apiKey: "test-secret-key", fetchImpl: async () => { calls.push("SHOPIFY_COGZART"); return response({}); } });
    await expect(gateway.provision(request({ storefrontTarget: "SHOPIFY_COGZART", provider: "SHOPIFY" }))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(calls).toHaveLength(0);
  });
});
