import { describe, expect, it } from "vitest";
import {
  ShopifyAppOAuthClient,
  normalizeShopifyShopDomain,
  type ShopifyAppOAuthConfig,
  type ShopifyOAuthHttpClient,
} from "../src/integrations/shopify/shopifyAppOAuthClient.js";

type HttpCall = { url: string; init: RequestInit };

const shopDomain = "cogzart-test.myshopify.com";
const clientId = "test-shopify-client-id";
const clientSecret = "test-shopify-client-secret-never-log";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function tokenResponse(accessToken = "shopify-access-token", expiresIn = 86_399) {
  return response({ access_token: accessToken, scope: "write_discounts", expires_in: expiresIn });
}

function config(overrides: Partial<ShopifyAppOAuthConfig> = {}): ShopifyAppOAuthConfig {
  return { shopDomain, clientId, clientSecret, ...overrides };
}

function fetchSequence(...responses: Array<Response | Error>) {
  const calls: HttpCall[] = [];
  const fetchImpl: ShopifyOAuthHttpClient = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error("No fake response configured.");
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetchImpl };
}

describe("Shopify shop-domain configuration", () => {
  it.each([
    ["Store-Name.myshopify.com", "store-name.myshopify.com"],
    ["store-name.myshopify.com/", "store-name.myshopify.com"],
    ["https://store-name.myshopify.com/", "store-name.myshopify.com"],
  ])("normalizes safe canonical domain input %s", (input, expected) => {
    expect(normalizeShopifyShopDomain(input)).toBe(expected);
  });

  it.each([
    "",
    "shop.cogzart.com",
    "myshopify.com",
    "nested.store.myshopify.com",
    "http://store-name.myshopify.com",
    "https://store-name.myshopify.com/admin",
    "https://user:password@store-name.myshopify.com",
    "store-name.myshopify.com.evil.example",
  ])("rejects unsafe or noncanonical domain input %s", (input) => {
    expect(() => normalizeShopifyShopDomain(input)).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });
});

describe("Shopify app OAuth requests", () => {
  it("uses the exact token endpoint and form-urlencoded client-credentials body", async () => {
    const fake = fetchSequence(tokenResponse());
    const client = new ShopifyAppOAuthClient({ fetchImpl: fake.fetchImpl, getConfig: () => config() });
    await expect(client.getAccessToken()).resolves.toBe("shopify-access-token");

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe(`https://${shopDomain}/admin/oauth/access_token`);
    expect(fake.calls[0].init.method).toBe("POST");
    expect(new Headers(fake.calls[0].init.headers).get("Content-Type")).toBe("application/x-www-form-urlencoded");
    expect(new URLSearchParams(String(fake.calls[0].init.body))).toEqual(new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }));
  });

  it.each([
    [{ shopDomain: undefined }, "VALIDATION_FAILED"],
    [{ clientId: undefined }, "SHOPIFY_CLIENT_ID_MISSING"],
    [{ clientSecret: undefined }, "SHOPIFY_CLIENT_SECRET_MISSING"],
  ] as const)("fails safely when required configuration is missing", async (override, code) => {
    const fake = fetchSequence(tokenResponse());
    const client = new ShopifyAppOAuthClient({ fetchImpl: fake.fetchImpl, getConfig: () => config(override) });
    await expect(client.getAccessToken()).rejects.toMatchObject({ code });
    expect(fake.calls).toHaveLength(0);
  });

  it.each([
    {},
    { access_token: " ", expires_in: 3600 },
    { access_token: "token", expires_in: 0 },
    { access_token: "token", expires_in: 1.5 },
  ])("rejects malformed token responses", async (payload) => {
    const fake = fetchSequence(response(payload));
    const client = new ShopifyAppOAuthClient({ fetchImpl: fake.fetchImpl, getConfig: () => config() });
    await expect(client.getAccessToken()).rejects.toMatchObject({ code: "SHOPIFY_OAUTH_RESPONSE_INVALID" });
  });

  it.each([400, 401, 403, 429, 500])("does not expose credentials from OAuth HTTP %s", async (status) => {
    const fake = fetchSequence(response({ clientSecret, access_token: "response-token" }, status));
    const client = new ShopifyAppOAuthClient({ fetchImpl: fake.fetchImpl, getConfig: () => config() });
    const error = await client.getAccessToken().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "SHOPIFY_OAUTH_HTTP_ERROR", details: { operation: "TOKEN", httpStatus: status } });
    expect(JSON.stringify(error)).not.toContain(clientSecret);
    expect(JSON.stringify(error)).not.toContain("response-token");
  });
});

describe("Shopify app OAuth token caching", () => {
  it("reuses a valid token and refreshes inside the conservative expiry window", async () => {
    let now = 0;
    const fake = fetchSequence(tokenResponse("first", 120), tokenResponse("refreshed", 120));
    const client = new ShopifyAppOAuthClient({ fetchImpl: fake.fetchImpl, getConfig: () => config(), now: () => now });
    await expect(client.getAccessToken()).resolves.toBe("first");
    now = 59_000;
    await expect(client.getAccessToken()).resolves.toBe("first");
    now = 60_000;
    await expect(client.getAccessToken()).resolves.toBe("refreshed");
    expect(fake.calls).toHaveLength(2);
  });

  it("coalesces concurrent requests for the same app and shop", async () => {
    let calls = 0;
    let release: ((value: Response) => void) | undefined;
    const fetchImpl: ShopifyOAuthHttpClient = async () => {
      calls += 1;
      return new Promise<Response>((resolve) => { release = resolve; });
    };
    const client = new ShopifyAppOAuthClient({ fetchImpl, getConfig: () => config(), now: () => 0 });
    const first = client.getAccessToken();
    const second = client.getAccessToken();
    expect(calls).toBe(1);
    release?.(tokenResponse("shared"));
    await expect(Promise.all([first, second])).resolves.toEqual(["shared", "shared"]);
    expect(calls).toBe(1);
  });
});
