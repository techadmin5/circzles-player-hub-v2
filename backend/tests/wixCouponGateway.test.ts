import { describe, expect, it } from "vitest";
import type { CouponProvisionRequest, CouponStorefrontTarget } from "../src/domain/couponBridge.js";
import {
  WixCouponGateway,
  buildWixCreateCouponBody,
  resolveWixCouponStorefront,
  wixCouponStorefronts,
  type WixCouponHttpClient,
} from "../src/integrations/wix/wixCouponGateway.js";
import type { WixAccessTokenProvider } from "../src/integrations/wix/wixAppOAuthClient.js";

type HttpCall = { url: string; init: RequestInit };

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function queryResponse(coupons: unknown[], totalResults = coupons.length) {
  return response({ coupons, totalResults });
}

function getCouponResponse(id: string, code = "CZ95F70BA56FDCF99B") {
  return response({ coupon: { id, specification: { code } } });
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

function accessTokens(accessToken = "test-oauth-access-token"): WixAccessTokenProvider {
  return { getAccessToken: async () => accessToken };
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
      limitedToOneItem: false,
      appliesToSubscriptions: false,
      percentOffRate: 20,
    } });
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
  it("queries safely, then creates with an instance-bound OAuth access token", async () => {
    const fake = fetchSequence(queryResponse([]), response({ id: "wix-coupon-1" }), getCouponResponse("wix-coupon-1"));
    const gateway = new WixCouponGateway({ accessTokens: accessTokens(), fetchImpl: fake.fetchImpl });
    await expect(gateway.provision(request())).resolves.toEqual({ providerCouponId: "wix-coupon-1" });

    expect(fake.calls.map((call) => [call.init.method, call.url])).toEqual([
      ["POST", "https://www.wixapis.com/stores/v2/coupons/query"],
      ["POST", "https://www.wixapis.com/stores/v2/coupons"],
      ["GET", "https://www.wixapis.com/stores/v2/coupons/wix-coupon-1"],
    ]);
    expect(headers(fake.calls[1]).get("Authorization")).toBe("test-oauth-access-token");
    expect(headers(fake.calls[1]).has("wix-site-id")).toBe(false);
    expect(JSON.stringify([...headers(fake.calls[1])])).not.toContain("app-secret");
    expect(headers(fake.calls[1]).get("Content-Type")).toBe("application/json");
    expect(body(fake.calls[1])).toEqual(buildWixCreateCouponBody(request()));
    expect(body(fake.calls[0])).toEqual({ query: { paging: { limit: 100, offset: 0 } } });
    expect(JSON.stringify(body(fake.calls[0]))).not.toContain("specification.code");
  });

  it("reuses an exact code match from the first page without creating another coupon", async () => {
    const fake = fetchSequence(queryResponse([{ id: "existing-wix-id", specification: { code: "CZ95F70BA56FDCF99B" } }]));
    const gateway = new WixCouponGateway({ accessTokens: accessTokens(), fetchImpl: fake.fetchImpl });
    await expect(gateway.provision(request())).resolves.toEqual({ providerCouponId: "existing-wix-id" });
    expect(fake.calls).toHaveLength(1);
  });

  it("ignores unrelated query rows and proceeds to create", async () => {
    const fake = fetchSequence(queryResponse([{ id: "other", specification: { code: "OTHER" } }]), response({ id: "created-id" }), getCouponResponse("created-id"));
    const gateway = new WixCouponGateway({ accessTokens: accessTokens(), fetchImpl: fake.fetchImpl });
    await expect(gateway.provision(request())).resolves.toEqual({ providerCouponId: "created-id" });
    expect(fake.calls).toHaveLength(3);
  });

  it("finds an exact code match on the second page", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `other-${index}`, specification: { code: `OTHER${index}` } }));
    const fake = fetchSequence(
      queryResponse(firstPage, 101),
      queryResponse([{ id: "second-page-match", specification: { code: "CZ95F70BA56FDCF99B" } }], 101),
    );
    const gateway = new WixCouponGateway({ accessTokens: accessTokens(), fetchImpl: fake.fetchImpl });
    await expect(gateway.provision(request())).resolves.toEqual({ providerCouponId: "second-page-match" });
    expect(fake.calls.map((call) => body(call))).toEqual([
      { query: { paging: { limit: 100, offset: 0 } } },
      { query: { paging: { limit: 100, offset: 100 } } },
    ]);
  });

  it("creates exactly once after multiple pages contain no exact match", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `other-${index}`, specification: { code: `OTHER${index}` } }));
    const fake = fetchSequence(
      queryResponse(firstPage, 101),
      queryResponse([{ id: "last-other", specification: { code: "LASTOTHER" } }], 101),
      response({ id: "created-id" }),
      getCouponResponse("created-id"),
    );
    const gateway = new WixCouponGateway({ accessTokens: accessTokens(), fetchImpl: fake.fetchImpl });
    await expect(gateway.provision(request())).resolves.toEqual({ providerCouponId: "created-id" });
    expect(fake.calls.filter((call) => call.url === "https://www.wixapis.com/stores/v2/coupons")).toHaveLength(1);
  });

  it("rejects exact-code matches split across separate pages as ambiguous", async () => {
    const firstPage = [
      { id: "first-match", specification: { code: "CZ95F70BA56FDCF99B" } },
      ...Array.from({ length: 99 }, (_, index) => ({ id: `other-${index}`, specification: { code: `OTHER${index}` } })),
    ];
    const fake = fetchSequence(
      queryResponse(firstPage, 101),
      queryResponse([{ id: "second-match", specification: { code: "CZ95F70BA56FDCF99B" } }], 101),
    );
    const gateway = new WixCouponGateway({ accessTokens: accessTokens(), fetchImpl: fake.fetchImpl });
    await expect(gateway.provision(request())).rejects.toMatchObject({ code: "WIX_COUPON_RECOVERY_AMBIGUOUS" });
    expect(fake.calls).toHaveLength(2);
  });

  it.each([
    { coupons: [], totalResults: -1 },
    { coupons: [], totalResults: 1.5 },
    { coupons: [], totalResults: 1 },
    { coupons: "not-an-array", totalResults: 0 },
  ])("rejects malformed pagination responses safely", async (malformed) => {
    const fake = fetchSequence(response(malformed));
    const gateway = new WixCouponGateway({ accessTokens: accessTokens(), fetchImpl: fake.fetchImpl });
    await expect(gateway.provision(request())).rejects.toMatchObject({ code: "WIX_COUPON_RESPONSE_INVALID" });
    expect(fake.calls).toHaveLength(1);
  });

  it.each([undefined, " "])("rejects an exact query match with a missing or blank id", async (id) => {
    const fake = fetchSequence(queryResponse([{ id, specification: { code: "CZ95F70BA56FDCF99B" } }]));
    const gateway = new WixCouponGateway({ accessTokens: accessTokens(), fetchImpl: fake.fetchImpl });
    await expect(gateway.provision(request())).rejects.toMatchObject({ code: "WIX_COUPON_RESPONSE_INVALID" });
    expect(fake.calls).toHaveLength(1);
  });

  it("does not duplicate a remote coupon when a later retry can recover it", async () => {
    let created = false;
    const calls: HttpCall[] = [];
    const fetchImpl: WixCouponHttpClient = async (input, init = {}) => {
      calls.push({ url: String(input), init });
      if (String(input).endsWith("/query")) return queryResponse(created ? [{ id: "stable-id", specification: { code: "CZ95F70BA56FDCF99B" } }] : []);
      if (init.method === "GET") return getCouponResponse("stable-id");
      created = true;
      return response({ id: "stable-id" });
    };
    const gateway = new WixCouponGateway({ accessTokens: accessTokens(), fetchImpl });
    await gateway.provision(request());
    await gateway.provision(request());
    expect(calls.filter((call) => call.url === "https://www.wixapis.com/stores/v2/coupons")).toHaveLength(1);
  });

  it("fails when direct create verification returns a conflicting coupon code", async () => {
    const fake = fetchSequence(queryResponse([]), response({ id: "created-id" }), getCouponResponse("created-id", "DIFFERENTCODE"));
    const gateway = new WixCouponGateway({ accessTokens: accessTokens(), fetchImpl: fake.fetchImpl });
    await expect(gateway.provision(request())).rejects.toMatchObject({ code: "WIX_COUPON_VERIFICATION_FAILED", details: { operation: "GET" } });
  });

  it("fails when direct create verification returns a malformed coupon", async () => {
    const fake = fetchSequence(queryResponse([]), response({ id: "created-id" }), response({ coupon: { id: "created-id" } }));
    const gateway = new WixCouponGateway({ accessTokens: accessTokens(), fetchImpl: fake.fetchImpl });
    await expect(gateway.provision(request())).rejects.toMatchObject({ code: "WIX_COUPON_RESPONSE_INVALID", details: { operation: "GET" } });
  });

  it("recovers an ambiguous create when the coupon appears on a later bounded query", async () => {
    const delays: number[] = [];
    const fake = fetchSequence(
      queryResponse([]),
      response({ message: "uncertain" }, 500),
      queryResponse([]),
      queryResponse([{ id: "recovered-id", specification: { code: "CZ95F70BA56FDCF99B" } }]),
    );
    const gateway = new WixCouponGateway({
      accessTokens: accessTokens(),
      fetchImpl: fake.fetchImpl,
      recoveryDelaysMs: [10, 20, 40],
      delay: async (milliseconds) => { delays.push(milliseconds); },
    });
    await expect(gateway.provision(request())).resolves.toEqual({ providerCouponId: "recovered-id" });
    expect(delays).toEqual([10, 20]);
    expect(fake.calls.filter((call) => call.url === "https://www.wixapis.com/stores/v2/coupons")).toHaveLength(1);
  });

  it("fails safely when separate recovery matches are ambiguous", async () => {
    const coupon = { specification: { code: "CZ95F70BA56FDCF99B" } };
    const fake = fetchSequence(
      queryResponse([]),
      response({ message: "uncertain" }, 500),
      queryResponse([{ id: "one", ...coupon }, { id: "two", ...coupon }]),
    );
    const gateway = new WixCouponGateway({ accessTokens: accessTokens(), fetchImpl: fake.fetchImpl, recoveryDelaysMs: [0], delay: async () => undefined });
    await expect(gateway.provision(request())).rejects.toMatchObject({ code: "WIX_COUPON_RECOVERY_AMBIGUOUS" });
    expect(fake.calls.filter((call) => call.url === "https://www.wixapis.com/stores/v2/coupons")).toHaveLength(1);
  });

  it("exhausts bounded recovery without issuing a second create", async () => {
    const delays: number[] = [];
    const accessToken = "do-not-leak-recovery-token";
    const fake = fetchSequence(queryResponse([]), new Error(`uncertain transport ${accessToken}`), queryResponse([]), queryResponse([]), queryResponse([]));
    const gateway = new WixCouponGateway({
      accessTokens: accessTokens(accessToken),
      fetchImpl: fake.fetchImpl,
      recoveryDelaysMs: [10, 20, 40],
      delay: async (milliseconds) => { delays.push(milliseconds); },
    });
    const error = await gateway.provision(request()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "WIX_COUPON_RECOVERY_EXHAUSTED", details: { operation: "CREATE" } });
    expect(JSON.stringify(error)).not.toContain(accessToken);
    expect(delays).toEqual([10, 20, 40]);
    expect(fake.calls.filter((call) => call.url === "https://www.wixapis.com/stores/v2/coupons")).toHaveLength(1);
  });

  it("recovers a duplicate-code conflict through exact-code query", async () => {
    const fake = fetchSequence(
      queryResponse([]),
      response({ message: "duplicate code" }, 409),
      queryResponse([{ id: "existing-id", specification: { code: "CZ95F70BA56FDCF99B" } }]),
    );
    const gateway = new WixCouponGateway({ accessTokens: accessTokens(), fetchImpl: fake.fetchImpl, recoveryDelaysMs: [0], delay: async () => undefined });
    await expect(gateway.provision(request())).resolves.toEqual({ providerCouponId: "existing-id" });
    expect(fake.calls.filter((call) => call.url === "https://www.wixapis.com/stores/v2/coupons")).toHaveLength(1);
  });

  it("rejects blank or missing create ids", async () => {
    for (const malformed of [{}, { id: " " }]) {
      const fake = fetchSequence(queryResponse([]), response(malformed));
      const gateway = new WixCouponGateway({ accessTokens: accessTokens(), fetchImpl: fake.fetchImpl, recoveryDelaysMs: [] });
      await expect(gateway.provision(request())).rejects.toMatchObject({ code: "WIX_COUPON_RECOVERY_EXHAUSTED" });
    }
  });

  it("disables the exact provider coupon using the required field mask", async () => {
    const fake = fetchSequence(response({}));
    const gateway = new WixCouponGateway({ accessTokens: accessTokens(), fetchImpl: fake.fetchImpl });
    await gateway.disable({ storefrontTarget: "WIX_COGZART_COM", providerCouponId: "wix/id", couponCode: "CZ95F70BA56FDCF99B" });
    expect(fake.calls[0].url).toBe("https://www.wixapis.com/stores/v2/coupons/wix%2Fid");
    expect(fake.calls[0].init.method).toBe("PATCH");
    expect(headers(fake.calls[0]).has("wix-site-id")).toBe(false);
    expect(body(fake.calls[0])).toEqual({ fieldMask: { paths: ["active"] }, specification: { active: false } });
  });

  it.each([401, 403, 409, 429, 500])("handles Wix HTTP %s without leaking the OAuth token", async (status) => {
    const accessToken = "do-not-leak-this-token";
    const fake = fetchSequence(response({ message: accessToken }, status));
    const gateway = new WixCouponGateway({ accessTokens: accessTokens(accessToken), fetchImpl: fake.fetchImpl });
    const error = await gateway.provision(request()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "WIX_COUPON_HTTP_ERROR", details: { operation: "QUERY", httpStatus: status, storefront: "WIX_CIRCZLES_IN" } });
    expect(JSON.stringify(error)).not.toContain(accessToken);
    expect(String(error)).not.toContain(accessToken);
  });

  it("does not leak the OAuth token from an ambiguous transport failure", async () => {
    const accessToken = "do-not-leak-this-token";
    const fake = fetchSequence(new Error(`network failed with ${accessToken}`));
    const gateway = new WixCouponGateway({ accessTokens: accessTokens(accessToken), fetchImpl: fake.fetchImpl });
    const error = await gateway.provision(request()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "WIX_COUPON_REQUEST_FAILED" });
    expect(JSON.stringify(error)).not.toContain(accessToken);
  });

  it("rejects Shopify before making an HTTP request", async () => {
    const calls: CouponStorefrontTarget[] = [];
    const gateway = new WixCouponGateway({ accessTokens: { getAccessToken: async () => { calls.push("SHOPIFY_COGZART"); return "unused"; } }, fetchImpl: async () => response({}) });
    await expect(gateway.provision(request({ storefrontTarget: "SHOPIFY_COGZART", provider: "SHOPIFY" }))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(calls).toHaveLength(0);
  });
});
