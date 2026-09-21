import { describe, expect, it } from "vitest";
import { WixAppOAuthClient, type WixAppOAuthConfig, type WixOAuthHttpClient } from "../src/integrations/wix/wixAppOAuthClient.js";

type HttpCall = { url: string; init: RequestInit };

const appId = "d24ad742-958c-47eb-896b-a267753fe404";
const appSecret = "test-app-secret-never-log";
const circzlesComInstanceId = "3faf71ce-2e7f-4f12-8d65-c4dca4773615";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function tokenResponse(accessToken = "oauth-access-token", expiresIn = 14_400) {
  return response({ access_token: accessToken, token_type: "Bearer", expires_in: expiresIn });
}

function config(overrides: Partial<WixAppOAuthConfig> = {}): WixAppOAuthConfig {
  return {
    appId,
    appSecret,
    instanceIds: {
      WIX_CIRCZLES_COM: circzlesComInstanceId,
      WIX_CIRCZLES_IN: "circzles-in-instance",
      WIX_COGZART_IN: "cogzart-in-instance",
      WIX_COGZART_COM: "cogzart-com-instance",
    },
    ...overrides,
  };
}

function fetchSequence(...responses: Array<Response | Error>) {
  const calls: HttpCall[] = [];
  const fetchImpl: WixOAuthHttpClient = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error("No fake response configured.");
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetchImpl };
}

function requestBody(call: HttpCall) {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

describe("Wix app OAuth configuration and token requests", () => {
  it("uses the exact token endpoint and configured circzles.com app instance", async () => {
    const fake = fetchSequence(tokenResponse());
    const client = new WixAppOAuthClient({ fetchImpl: fake.fetchImpl, getConfig: () => config() });
    await expect(client.getAccessToken("WIX_CIRCZLES_COM")).resolves.toBe("oauth-access-token");

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe("https://www.wixapis.com/oauth2/token");
    expect(fake.calls[0].init.method).toBe("POST");
    expect(new Headers(fake.calls[0].init.headers).get("Content-Type")).toBe("application/json");
    expect(requestBody(fake.calls[0])).toEqual({
      grant_type: "client_credentials",
      client_id: appId,
      client_secret: appSecret,
      instance_id: circzlesComInstanceId,
    });
  });

  it("fails for a missing instance only when that storefront is used", async () => {
    const fake = fetchSequence(tokenResponse());
    const client = new WixAppOAuthClient({
      fetchImpl: fake.fetchImpl,
      getConfig: () => config({ instanceIds: { WIX_CIRCZLES_COM: circzlesComInstanceId } }),
    });
    await expect(client.getAccessToken("WIX_CIRCZLES_COM")).resolves.toBe("oauth-access-token");
    await expect(client.getAccessToken("WIX_CIRCZLES_IN")).rejects.toMatchObject({ code: "WIX_APP_INSTANCE_ID_MISSING" });
    expect(fake.calls).toHaveLength(1);
  });

  it.each([
    [{ appId: undefined }, "WIX_APP_ID_MISSING"],
    [{ appSecret: undefined }, "WIX_APP_SECRET_MISSING"],
  ] as const)("fails safely when shared app credentials are missing", async (override, code) => {
    const fake = fetchSequence(tokenResponse());
    const client = new WixAppOAuthClient({ fetchImpl: fake.fetchImpl, getConfig: () => config(override) });
    await expect(client.getAccessToken("WIX_CIRCZLES_COM")).rejects.toMatchObject({ code });
    expect(fake.calls).toHaveLength(0);
  });

  it.each([
    {},
    { access_token: " ", token_type: "Bearer", expires_in: 3600 },
    { access_token: "token", token_type: " ", expires_in: 3600 },
    { access_token: "token", token_type: "Unexpected", expires_in: 3600 },
    { access_token: "token", token_type: "Bearer", expires_in: 0 },
    { access_token: "token", token_type: "Bearer", expires_in: 1.5 },
  ])("rejects malformed token responses", async (payload) => {
    const fake = fetchSequence(response(payload));
    const client = new WixAppOAuthClient({ fetchImpl: fake.fetchImpl, getConfig: () => config() });
    await expect(client.getAccessToken("WIX_CIRCZLES_COM")).rejects.toMatchObject({ code: "WIX_OAUTH_RESPONSE_INVALID" });
  });

  it.each([401, 403, 429, 500])("handles OAuth HTTP %s without exposing credentials", async (status) => {
    const fake = fetchSequence(response({ appSecret, access_token: "response-token" }, status));
    const client = new WixAppOAuthClient({ fetchImpl: fake.fetchImpl, getConfig: () => config() });
    const error = await client.getAccessToken("WIX_CIRCZLES_COM").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "WIX_OAUTH_HTTP_ERROR", details: { storefront: "WIX_CIRCZLES_COM", operation: "TOKEN", httpStatus: status } });
    expect(JSON.stringify(error)).not.toContain(appSecret);
    expect(JSON.stringify(error)).not.toContain("response-token");
  });
});

describe("Wix app OAuth token caching", () => {
  it("reuses a valid token for the same storefront", async () => {
    const fake = fetchSequence(tokenResponse("cached-token"));
    const client = new WixAppOAuthClient({ fetchImpl: fake.fetchImpl, getConfig: () => config(), now: () => 0 });
    await expect(client.getAccessToken("WIX_CIRCZLES_COM")).resolves.toBe("cached-token");
    await expect(client.getAccessToken("WIX_CIRCZLES_COM")).resolves.toBe("cached-token");
    expect(fake.calls).toHaveLength(1);
  });

  it("refreshes a token inside the conservative expiry window", async () => {
    let now = 0;
    const fake = fetchSequence(tokenResponse("first-token", 120), tokenResponse("refreshed-token", 120));
    const client = new WixAppOAuthClient({ fetchImpl: fake.fetchImpl, getConfig: () => config(), now: () => now });
    await expect(client.getAccessToken("WIX_CIRCZLES_COM")).resolves.toBe("first-token");
    now = 59_000;
    await expect(client.getAccessToken("WIX_CIRCZLES_COM")).resolves.toBe("first-token");
    now = 60_000;
    await expect(client.getAccessToken("WIX_CIRCZLES_COM")).resolves.toBe("refreshed-token");
    expect(fake.calls).toHaveLength(2);
  });

  it("does not share tokens between storefronts", async () => {
    const fake = fetchSequence(tokenResponse("com-token"), tokenResponse("in-token"));
    const client = new WixAppOAuthClient({ fetchImpl: fake.fetchImpl, getConfig: () => config(), now: () => 0 });
    await expect(client.getAccessToken("WIX_CIRCZLES_COM")).resolves.toBe("com-token");
    await expect(client.getAccessToken("WIX_CIRCZLES_IN")).resolves.toBe("in-token");
    expect(fake.calls.map((call) => requestBody(call).instance_id)).toEqual([circzlesComInstanceId, "circzles-in-instance"]);
  });

  it("coalesces concurrent token requests for the same storefront", async () => {
    let calls = 0;
    let release: ((response: Response) => void) | undefined;
    const fetchImpl: WixOAuthHttpClient = async () => {
      calls += 1;
      return new Promise<Response>((resolve) => { release = resolve; });
    };
    const client = new WixAppOAuthClient({ fetchImpl, getConfig: () => config(), now: () => 0 });
    const first = client.getAccessToken("WIX_CIRCZLES_COM");
    const second = client.getAccessToken("WIX_CIRCZLES_COM");
    expect(calls).toBe(1);
    release?.(tokenResponse("shared-token"));
    await expect(Promise.all([first, second])).resolves.toEqual(["shared-token", "shared-token"]);
    expect(calls).toBe(1);
  });
});
