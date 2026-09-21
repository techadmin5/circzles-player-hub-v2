import { describe, expect, it } from "vitest";
import type { CouponProvisionRequest } from "../src/domain/couponBridge.js";
import {
  ShopifyCouponGateway,
  buildShopifyCreateVariables,
  type ShopifyCouponHttpClient,
} from "../src/integrations/shopify/shopifyCouponGateway.js";
import type { ShopifyAccessTokenProvider } from "../src/integrations/shopify/shopifyAppOAuthClient.js";

type HttpCall = { url: string; init: RequestInit };

const shopDomain = "cogzart-test.myshopify.com";
const couponCode = "CZ95F70BA56FDCF99B";
const providerCouponId = "gid://shopify/DiscountCodeNode/123456789";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function lookupResponse(node: unknown) {
  return response({ data: { codeDiscountNodeByCode: node } });
}

function basicNode(id = providerCouponId, code = couponCode) {
  return {
    id,
    codeDiscount: {
      __typename: "DiscountCodeBasic",
      codes: { nodes: [{ code }] },
    },
  };
}

function createResponse(node: unknown = basicNode(), userErrors: unknown[] = []) {
  return response({ data: { discountCodeBasicCreate: { codeDiscountNode: node, userErrors } } });
}

function disableResponse(id = providerCouponId, userErrors: unknown[] = []) {
  return response({ data: { discountCodeDeactivate: { codeDiscountNode: { id }, userErrors } } });
}

function fetchSequence(...responses: Array<Response | Error>) {
  const calls: HttpCall[] = [];
  const fetchImpl: ShopifyCouponHttpClient = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error("No fake response configured.");
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetchImpl };
}

function accessTokens(accessToken = "test-shopify-access-token"): ShopifyAccessTokenProvider {
  return { getAccessToken: async () => accessToken, getShopDomain: () => shopDomain };
}

function request(overrides: Partial<CouponProvisionRequest> = {}): CouponProvisionRequest {
  return {
    couponOwnershipId: "70000000-0000-4000-8000-000000000001",
    couponCode,
    storefrontTarget: "SHOPIFY_COGZART",
    provider: "SHOPIFY",
    benefit: { type: "PERCENTAGE", percentage: 20 },
    startsAt: new Date("2026-09-21T05:00:00.000Z"),
    expiresAt: new Date("2026-10-21T05:00:00.000Z"),
    totalUsageLimit: 1,
    perCustomerUsageLimit: 1,
    ...overrides,
  };
}

function body(call: HttpCall) {
  return JSON.parse(String(call.init.body)) as { query: string; variables: Record<string, unknown> };
}

function createCalls(calls: HttpCall[]) {
  return calls.filter((call) => body(call).query.includes("discountCodeBasicCreate"));
}

describe("Shopify coupon request mapping", () => {
  it("maps 20 percent to Shopify's decimal fraction and required basic discount fields", () => {
    expect(buildShopifyCreateVariables(request())).toEqual({
      input: {
        title: `CircZles Reward ${couponCode}`,
        code: couponCode,
        startsAt: "2026-09-21T05:00:00.000Z",
        endsAt: "2026-10-21T05:00:00.000Z",
        context: { all: "ALL" },
        customerGets: {
          items: { all: true },
          value: { percentage: 0.2 },
          appliesOnOneTimePurchase: true,
          appliesOnSubscription: false,
        },
        usageLimit: 1,
        appliesOncePerCustomer: true,
      },
    });
  });

  it("maps a fixed USD amount once across all entitled items", () => {
    const result = buildShopifyCreateVariables(request({
      benefit: { type: "FIXED_AMOUNT", currency: "USD", amount: 6 },
      expiresAt: null,
    }));
    expect(result.input.endsAt).toBeNull();
    expect(result.input.customerGets.value).toEqual({
      discountAmount: { amount: 6, appliesOnEachItem: false },
    });
  });

  it("rejects non-USD fixed benefits and Wix storefronts", () => {
    expect(() => buildShopifyCreateVariables(request({ benefit: { type: "FIXED_AMOUNT", currency: "INR", amount: 500 } })))
      .toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() => buildShopifyCreateVariables(request({ storefrontTarget: "WIX_COGZART_COM", provider: "WIX" })))
      .toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });
});

describe("Shopify coupon GraphQL gateway", () => {
  it("reuses an exact basic-discount code match without creating", async () => {
    const fake = fetchSequence(lookupResponse(basicNode()));
    const gateway = new ShopifyCouponGateway({ fetchImpl: fake.fetchImpl, accessTokens: accessTokens() });
    await expect(gateway.provision(request())).resolves.toEqual({ providerCouponId });
    expect(fake.calls).toHaveLength(1);
    expect(body(fake.calls[0]).query).toContain("codeDiscountNodeByCode");
    expect(body(fake.calls[0]).variables).toEqual({ code: couponCode });
  });

  it("creates exactly once after no exact match and validates the returned code and GID", async () => {
    const fake = fetchSequence(lookupResponse(null), createResponse());
    const gateway = new ShopifyCouponGateway({ fetchImpl: fake.fetchImpl, accessTokens: accessTokens() });
    await expect(gateway.provision(request())).resolves.toEqual({ providerCouponId });

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].url).toBe(`https://${shopDomain}/admin/api/2026-07/graphql.json`);
    expect(fake.calls[1].init.method).toBe("POST");
    const headers = new Headers(fake.calls[1].init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Shopify-Access-Token")).toBe("test-shopify-access-token");
    expect(body(fake.calls[1]).query).toContain("discountCodeBasicCreate");
    expect(body(fake.calls[1]).variables).toEqual(buildShopifyCreateVariables(request()));
    expect(createCalls(fake.calls)).toHaveLength(1);
  });

  it("fails safely for malformed lookup data and incompatible discount types", async () => {
    const malformed = fetchSequence(response({ data: {} }));
    const malformedGateway = new ShopifyCouponGateway({ fetchImpl: malformed.fetchImpl, accessTokens: accessTokens() });
    await expect(malformedGateway.provision(request())).rejects.toMatchObject({ code: "SHOPIFY_COUPON_RESPONSE_INVALID" });

    const wrongType = fetchSequence(lookupResponse({
      id: providerCouponId,
      codeDiscount: { __typename: "DiscountCodeFreeShipping" },
    }));
    const wrongTypeGateway = new ShopifyCouponGateway({ fetchImpl: wrongType.fetchImpl, accessTokens: accessTokens() });
    await expect(wrongTypeGateway.provision(request())).rejects.toMatchObject({ code: "SHOPIFY_COUPON_TYPE_CONFLICT" });
  });

  it("fails when case-insensitive lookup does not preserve the canonical code exactly", async () => {
    const fake = fetchSequence(lookupResponse(basicNode(providerCouponId, couponCode.toLowerCase())));
    const gateway = new ShopifyCouponGateway({ fetchImpl: fake.fetchImpl, accessTokens: accessTokens() });
    await expect(gateway.provision(request())).rejects.toMatchObject({ code: "SHOPIFY_COUPON_CODE_CONFLICT" });
  });

  it.each([
    basicNode("not-a-gid"),
    { id: providerCouponId, codeDiscount: { __typename: "DiscountCodeBasic", codes: { nodes: [] } } },
    { id: providerCouponId, codeDiscount: { __typename: "DiscountCodeBasic", codes: { nodes: [{ code: " " }] } } },
  ])("rejects malformed create result data", async (node) => {
    const fake = fetchSequence(lookupResponse(null), createResponse(node));
    const gateway = new ShopifyCouponGateway({
      fetchImpl: fake.fetchImpl,
      accessTokens: accessTokens(),
      recoveryDelaysMs: [],
    });
    await expect(gateway.provision(request())).rejects.toMatchObject({ code: "SHOPIFY_COUPON_RECOVERY_EXHAUSTED" });
    expect(createCalls(fake.calls)).toHaveLength(1);
  });

  it("validates top-level GraphQL errors without leaking raw provider data", async () => {
    const secret = "do-not-leak-graphql-token";
    const fake = fetchSequence(response({ errors: [{ message: secret }] }));
    const gateway = new ShopifyCouponGateway({ fetchImpl: fake.fetchImpl, accessTokens: accessTokens(secret) });
    const error = await gateway.provision(request()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "SHOPIFY_GRAPHQL_ERROR", details: { operation: "LOOKUP" } });
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  it("rejects deterministic mutation user errors without retrying create", async () => {
    const fake = fetchSequence(
      lookupResponse(null),
      createResponse(null, [{ code: "INVALID", field: ["code"], message: "invalid" }]),
    );
    const gateway = new ShopifyCouponGateway({ fetchImpl: fake.fetchImpl, accessTokens: accessTokens() });
    await expect(gateway.provision(request())).rejects.toMatchObject({ code: "SHOPIFY_COUPON_USER_ERROR" });
    expect(createCalls(fake.calls)).toHaveLength(1);
    expect(fake.calls).toHaveLength(2);
  });

  it("recovers an ambiguous transport outcome on a later exact-code lookup", async () => {
    const delays: number[] = [];
    const fake = fetchSequence(
      lookupResponse(null),
      new Error("uncertain transport"),
      lookupResponse(null),
      lookupResponse(basicNode()),
    );
    const gateway = new ShopifyCouponGateway({
      fetchImpl: fake.fetchImpl,
      accessTokens: accessTokens(),
      recoveryDelaysMs: [10, 20, 40],
      delay: async (milliseconds) => { delays.push(milliseconds); },
    });
    await expect(gateway.provision(request())).resolves.toEqual({ providerCouponId });
    expect(delays).toEqual([10, 20]);
    expect(createCalls(fake.calls)).toHaveLength(1);
  });

  it("recovers a duplicate-code user error without issuing another create", async () => {
    const fake = fetchSequence(
      lookupResponse(null),
      createResponse(null, [{ code: "TAKEN", field: ["code"], message: "taken" }]),
      lookupResponse(basicNode()),
    );
    const gateway = new ShopifyCouponGateway({
      fetchImpl: fake.fetchImpl,
      accessTokens: accessTokens(),
      recoveryDelaysMs: [0],
      delay: async () => undefined,
    });
    await expect(gateway.provision(request())).resolves.toEqual({ providerCouponId });
    expect(createCalls(fake.calls)).toHaveLength(1);
  });

  it("fails closed after bounded recovery and never creates twice", async () => {
    const delays: number[] = [];
    const fake = fetchSequence(
      lookupResponse(null),
      response({ errors: [{ message: "throttled", extensions: { code: "THROTTLED" } }] }),
      lookupResponse(null),
      lookupResponse(null),
      lookupResponse(null),
    );
    const gateway = new ShopifyCouponGateway({
      fetchImpl: fake.fetchImpl,
      accessTokens: accessTokens(),
      recoveryDelaysMs: [10, 20, 40],
      delay: async (milliseconds) => { delays.push(milliseconds); },
    });
    await expect(gateway.provision(request())).rejects.toMatchObject({ code: "SHOPIFY_COUPON_RECOVERY_EXHAUSTED" });
    expect(delays).toEqual([10, 20, 40]);
    expect(createCalls(fake.calls)).toHaveLength(1);
  });

  it("deactivates the exact DiscountCodeNode without deleting it", async () => {
    const fake = fetchSequence(disableResponse());
    const gateway = new ShopifyCouponGateway({ fetchImpl: fake.fetchImpl, accessTokens: accessTokens() });
    await gateway.disable({ storefrontTarget: "SHOPIFY_COGZART", providerCouponId, couponCode });
    expect(body(fake.calls[0]).query).toContain("discountCodeDeactivate");
    expect(body(fake.calls[0]).query).not.toContain("discountCodeDelete");
    expect(body(fake.calls[0]).variables).toEqual({ id: providerCouponId });
  });

  it("validates disable GraphQL and user errors", async () => {
    const graph = fetchSequence(response({ errors: [{ message: "failure" }] }));
    await expect(new ShopifyCouponGateway({ fetchImpl: graph.fetchImpl, accessTokens: accessTokens() }).disable({
      storefrontTarget: "SHOPIFY_COGZART",
      providerCouponId,
      couponCode,
    })).rejects.toMatchObject({ code: "SHOPIFY_GRAPHQL_ERROR" });

    const user = fetchSequence(disableResponse(providerCouponId, [{ code: "INVALID", message: "invalid" }]));
    await expect(new ShopifyCouponGateway({ fetchImpl: user.fetchImpl, accessTokens: accessTokens() }).disable({
      storefrontTarget: "SHOPIFY_COGZART",
      providerCouponId,
      couponCode,
    })).rejects.toMatchObject({ code: "SHOPIFY_COUPON_USER_ERROR" });
  });

  it("rejects Wix storefronts before token acquisition", async () => {
    let tokenCalls = 0;
    const gateway = new ShopifyCouponGateway({
      fetchImpl: async () => response({}),
      accessTokens: {
        getShopDomain: () => shopDomain,
        getAccessToken: async () => { tokenCalls += 1; return "unused"; },
      },
    });
    await expect(gateway.provision(request({ storefrontTarget: "WIX_CIRCZLES_COM", provider: "WIX" })))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(tokenCalls).toBe(0);
  });

  it.each([401, 403, 429, 500])("does not leak access tokens from Shopify HTTP %s", async (status) => {
    const accessToken = "do-not-leak-shopify-token";
    const fake = fetchSequence(response({ token: accessToken }, status));
    const gateway = new ShopifyCouponGateway({ fetchImpl: fake.fetchImpl, accessTokens: accessTokens(accessToken) });
    const error = await gateway.provision(request()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "SHOPIFY_COUPON_HTTP_ERROR", details: { operation: "LOOKUP", httpStatus: status } });
    expect(JSON.stringify(error)).not.toContain(accessToken);
  });
});
