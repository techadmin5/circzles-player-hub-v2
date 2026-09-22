import { describe, expect, it } from "vitest";
import { WixAppOAuthClient, type WixAppOAuthConfig, type WixOAuthHttpClient } from "../src/integrations/wix/wixAppOAuthClient.js";

type HttpCall = { url: string; init: RequestInit };

const appId = "d24ad742-958c-47eb-896b-a267753fe404";
const appSecret = "test-app-secret-never-log";
const circzlesInAppId = "b984c368-a4e7-4ccf-8d5e-d598fb3707c8";
const circzlesInAppSecret = "test-circzles-in-app-secret-never-log";
const circzlesInInstanceId = "17b5821b-ed4c-46ca-acfb-597fa311099d";
const circzlesComInstanceId = "3faf71ce-2e7f-4f12-8d65-c4dca4773615";
const cogzartInInstanceId = "171975f0-0a17-4d45-a115-c8c1766fe7a5";
const cogzartComInstanceId = "9e80b75f-990d-4bc4-9301-ff12afe489d2";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function tokenResponse(accessToken = "oauth-access-token", expiresIn = 14_400) {
  return response({ access_token: accessToken, token_type: "Bearer", expires_in: expiresIn });
}

function config(overrides: Partial<WixAppOAuthConfig> = {}): WixAppOAuthConfig {
  return {
    sharedApp: { appId, appSecret },
    storefrontApps: {
      WIX_CIRCZLES_IN: { appId: circzlesInAppId, appSecret: circzlesInAppSecret },
    },
    instanceIds: {
      WIX_CIRCZLES_COM: circzlesComInstanceId,
      WIX_CIRCZLES_IN: circzlesInInstanceId,
      WIX_COGZART_IN: cogzartInInstanceId,
      WIX_COGZART_COM: cogzartComInstanceId,
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
  it("uses the circzles.in-specific app credentials and instance", async () => {
    const fake = fetchSequence(tokenResponse());
    const client = new WixAppOAuthClient({ fetchImpl: fake.fetchImpl, getConfig: () => config() });
    await expect(client.getAccessToken("WIX_CIRCZLES_IN")).resolves.toBe("oauth-access-token");

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe("https://www.wixapis.com/oauth2/token");
    expect(fake.calls[0].init.method).toBe("POST");
    expect(new Headers(fake.calls[0].init.headers).get("Content-Type")).toBe("application/json");
    expect(requestBody(fake.calls[0])).toEqual({
      grant_type: "client_credentials",
      client_id: circzlesInAppId,
      client_secret: circzlesInAppSecret,
      instance_id: circzlesInInstanceId,
    });
  });

  it.each([
    ["WIX_CIRCZLES_COM", circzlesComInstanceId],
    ["WIX_COGZART_IN", cogzartInInstanceId],
    ["WIX_COGZART_COM", cogzartComInstanceId],
  ] as const)("uses the shared app credentials for %s", async (storefront, instanceId) => {
    const fake = fetchSequence(tokenResponse());
    const client = new WixAppOAuthClient({ fetchImpl: fake.fetchImpl, getConfig: () => config() });
    await expect(client.getAccessToken(storefront)).resolves.toBe("oauth-access-token");

    expect(requestBody(fake.calls[0])).toEqual({
      grant_type: "client_credentials",
      client_id: appId,
      client_secret: appSecret,
      instance_id: instanceId,
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
    [{ appId: undefined, appSecret }, "WIX_APP_ID_MISSING"],
    [{ appId, appSecret: undefined }, "WIX_APP_SECRET_MISSING"],
  ] as const)("fails safely when shared app credentials are missing", async (sharedApp, code) => {
    const fake = fetchSequence(tokenResponse());
    const client = new WixAppOAuthClient({ fetchImpl: fake.fetchImpl, getConfig: () => config({ sharedApp }) });
    await expect(client.getAccessToken("WIX_CIRCZLES_COM")).rejects.toMatchObject({ code });
    expect(fake.calls).toHaveLength(0);
  });

  it("fails for a missing circzles.in secret without affecting shared-app storefronts", async () => {
    const fake = fetchSequence(tokenResponse("shared-token"));
    const client = new WixAppOAuthClient({
      fetchImpl: fake.fetchImpl,
      getConfig: () => config({
        storefrontApps: { WIX_CIRCZLES_IN: { appId: circzlesInAppId, appSecret: undefined } },
      }),
    });

    await expect(client.getAccessToken("WIX_CIRCZLES_COM")).resolves.toBe("shared-token");
    await expect(client.getAccessToken("WIX_CIRCZLES_IN")).rejects.toMatchObject({
      code: "WIX_APP_SECRET_MISSING",
      details: { storefront: "WIX_CIRCZLES_IN" },
    });
    expect(fake.calls).toHaveLength(1);
  });

  it("does not require the shared secret when circzles.in-specific credentials exist", async () => {
    const fake = fetchSequence(tokenResponse("circzles-in-token"));
    const client = new WixAppOAuthClient({
      fetchImpl: fake.fetchImpl,
      getConfig: () => config({ sharedApp: { appId, appSecret: undefined } }),
    });

    await expect(client.getAccessToken("WIX_CIRCZLES_IN")).resolves.toBe("circzles-in-token");
    await expect(client.getAccessToken("WIX_CIRCZLES_COM")).rejects.toMatchObject({ code: "WIX_APP_SECRET_MISSING" });
    expect(fake.calls).toHaveLength(1);
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
    const fake = fetchSequence(response({ appSecret, circzlesInAppSecret, access_token: "response-token" }, status));
    const client = new WixAppOAuthClient({ fetchImpl: fake.fetchImpl, getConfig: () => config() });
    const error = await client.getAccessToken("WIX_CIRCZLES_IN").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "WIX_OAUTH_HTTP_ERROR", details: { storefront: "WIX_CIRCZLES_IN", operation: "TOKEN", httpStatus: status } });
    expect(JSON.stringify(error)).not.toContain(appSecret);
    expect(JSON.stringify(error)).not.toContain(circzlesInAppSecret);
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

  it("does not share tokens between the two Wix apps", async () => {
    const fake = fetchSequence(tokenResponse("com-token"), tokenResponse("in-token"));
    const client = new WixAppOAuthClient({ fetchImpl: fake.fetchImpl, getConfig: () => config(), now: () => 0 });
    await expect(client.getAccessToken("WIX_CIRCZLES_COM")).resolves.toBe("com-token");
    await expect(client.getAccessToken("WIX_CIRCZLES_IN")).resolves.toBe("in-token");
    await expect(client.getAccessToken("WIX_CIRCZLES_COM")).resolves.toBe("com-token");
    await expect(client.getAccessToken("WIX_CIRCZLES_IN")).resolves.toBe("in-token");
    expect(fake.calls.map((call) => requestBody(call))).toEqual([
      expect.objectContaining({ client_id: appId, instance_id: circzlesComInstanceId }),
      expect.objectContaining({ client_id: circzlesInAppId, instance_id: circzlesInInstanceId }),
    ]);
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
