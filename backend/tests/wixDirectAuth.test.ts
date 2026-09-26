import { describe, expect, it } from "vitest";
import { AppError } from "../src/domain/errors.js";
import { WixDirectAuthProvider } from "../src/integrations/wix/wixDirectAuth.js";

const config = {
  clientId: "canonical-circzles-com-client",
  callbackUrl: "https://api.example.test/api/auth/direct/google/callback",
  stateSecret: "test-state-secret-with-at-least-32-characters",
  apiBaseUrl: "https://wix.example.test",
};

const verifiedMember = {
  member: {
    id: "wix-member-1",
    loginEmail: "player@example.com",
    loginEmailVerified: true,
    status: "APPROVED",
    contact: { firstName: "Puzzle", lastName: "Player" },
    profile: { nickname: "Puzzle Player", photo: { url: "//static.wix.test/avatar.png" } },
  },
};

describe("WixDirectAuthProvider", () => {
  it("completes successful email login through PKCE and returns a verified Wix member", async () => {
    const wix = mockWix(
      ok({ access_token: "visitor-token" }),
      ok({ state: "SUCCESS", sessionToken: "member-session-token" }),
      ok({ redirectSession: { fullUrl: "https://wix.example.test/authorize-email" } }),
      ok({ access_token: "member-access-token", refresh_token: "member-refresh-token" }),
      ok(verifiedMember),
    );
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    const started = await provider.loginWithEmail({ email: "PLAYER@example.com", password: "safe-password", captchaToken: "visible-captcha-token", captchaType: "RECAPTCHA", returnTo: "/missions" });
    expect(started).toEqual({ authorizationUrl: "https://wix.example.test/authorize-email" });
    expect(bodyAt(wix.calls, 1)).toEqual({
      loginId: { email: "player@example.com" },
      password: "safe-password",
      captchaTokens: { Recaptcha: "visible-captcha-token" },
    });
    const redirectBody = bodyAt(wix.calls, 2);
    expect(redirectBody.auth.authRequest).toMatchObject({ clientId: config.clientId, responseMode: "query", responseType: "code", scope: "offline_access" });
    expect(redirectBody.auth.sessionToken).toBe("member-session-token");
    const completed = await provider.completeAuthorization({ code: "authorization-code", state: redirectBody.auth.authRequest.state as string });
    expect(completed).toEqual({
      returnTo: "/missions",
      identity: {
        sourceSite: "CIRCZLES_COM",
        provider: "EMAIL",
        externalIdentityId: "wix-member-1",
        verifiedEmail: "player@example.com",
        emailVerified: true,
        displayName: "Puzzle Player",
        firstName: "Puzzle",
        lastName: "Player",
        avatarUrl: "https://static.wix.test/avatar.png",
      },
    });
    expect(bodyAt(wix.calls, 3)).toMatchObject({ grantType: "authorization_code", codeVerifier: expect.any(String), redirectUri: config.callbackUrl });
    expect(wix.calls[4].init?.headers).toEqual({ Authorization: "member-access-token" });
  });

  it("rejects a Google-authenticated Wix member whose login email is explicitly unverified", async () => {
    const { provider, state, wix } = await startGoogleFlow();
    wix.responses.push(ok({ access_token: "member-token" }), ok({ member: { ...verifiedMember.member, loginEmailVerified: false } }));
    await expect(provider.completeAuthorization({ code: "code", state })).rejects.toMatchObject({ code: "WIX_MEMBER_IDENTITY_INVALID", statusCode: 502 });
    expect(wix.calls[3].url).toBe("https://wix.example.test/members/v1/members/my?fieldsets=FULL");
  });

  it("maps invalid credentials safely without returning provider data", async () => {
    const wix = mockWix(
      ok({ access_token: "visitor-token" }),
      failure(401, { message: "wrong password", access_token: "must-not-leak", refresh_token: "must-not-leak" }),
    );
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    const error = await captureError(provider.loginWithEmail({ email: "player@example.com", password: "wrong-password", returnTo: "/hub" }));
    expect(error).toMatchObject({ code: "WIX_INVALID_CREDENTIALS", statusCode: 401 });
    expect(JSON.stringify(error)).not.toContain("must-not-leak");
    expect(error.message).not.toContain("wrong password");
  });

  it("returns a controlled CAPTCHA contract without exposing Wix response details", async () => {
    const wix = mockWix(
      ok({ access_token: "visitor-token" }),
      failure(400, { details: { applicationError: { code: "RECAPTCHA_REQUIRED", message: "provider-secret-diagnostic" } } }),
    );
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    const error = await captureError(provider.loginWithEmail({ email: "player@example.com", password: "safe-password", returnTo: "/hub" }));
    expect(error).toMatchObject({ code: "WIX_CAPTCHA_REQUIRED", statusCode: 400, details: { captchaRequired: true } });
    expect(JSON.stringify(error)).not.toContain("provider-secret-diagnostic");
  });

  it("returns the controlled CAPTCHA contract when signup requires a challenge", async () => {
    const wix = mockWix(
      ok({ access_token: "visitor-token" }),
      failure(400, { code: "MISSING_CAPTCHA_TOKEN", password: "must-not-leak" }),
    );
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    const error = await captureError(provider.startEmailSignup({ displayName: "Puzzle Player", email: "player@example.com", password: "safe-password" }));
    expect(error).toMatchObject({ code: "WIX_CAPTCHA_REQUIRED", statusCode: 400, details: { captchaRequired: true } });
    expect(JSON.stringify(error)).not.toContain("must-not-leak");
  });

  it("creates an opaque signup challenge and forwards supported CAPTCHA data", async () => {
    const wix = mockWix(
      ok({ access_token: "visitor-token" }),
      ok({ state: "REQUIRE_EMAIL_VERIFICATION", stateToken: "provider-state-token" }),
    );
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    const result = await provider.startEmailSignup({
      displayName: "Puzzle Player",
      email: "player@example.com",
      password: "safe-password",
      captchaToken: "captcha-token",
      captchaType: "INVISIBLE_RECAPTCHA",
    });
    expect(result.challengeId).not.toContain("provider-state-token");
    expect(result.challengeId.split(".")).toHaveLength(3);
    expect(bodyAt(wix.calls, 1)).toEqual({
      loginId: { email: "player@example.com" },
      password: "safe-password",
      profile: { nickname: "Puzzle Player" },
      captchaTokens: { InvisibleRecaptcha: "captcha-token" },
    });
  });

  it("verifies signup OTP with Wix and resolves the verified identity after callback", async () => {
    const wix = mockWix(
      ok({ access_token: "visitor-token" }),
      ok({ state: "EMAIL_VERIFICATION_REQUIRED", stateToken: "provider-state-token" }),
    );
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    const challenge = await provider.startEmailSignup({ displayName: "Puzzle Player", email: "player@example.com", password: "safe-password" });
    wix.responses.push(
      ok({ state: "SUCCESS", sessionToken: "verified-session-token" }),
      ok({ redirectSession: { fullUrl: "https://wix.example.test/authorize-signup" } }),
      ok({ access_token: "member-token", refresh_token: "ignored-refresh-token" }),
      ok(verifiedMember),
    );
    const redirect = await provider.verifyEmailSignup({ challengeId: challenge.challengeId, code: "123456", returnTo: "/hub" });
    expect(redirect.authorizationUrl).toBe("https://wix.example.test/authorize-signup");
    expect(bodyAt(wix.calls, 2)).toEqual({ code: "123456", stateToken: "provider-state-token" });
    const state = bodyAt(wix.calls, 3).auth.authRequest.state as string;
    const completed = await provider.completeAuthorization({ code: "code", state });
    expect(completed.identity).toMatchObject({ provider: "EMAIL", externalIdentityId: "wix-member-1", verifiedEmail: "player@example.com", emailVerified: true });
    expect(JSON.stringify({ challenge, redirect, completed })).not.toContain("visitor-token");
    expect(JSON.stringify({ challenge, redirect, completed })).not.toContain("member-token");
    expect(JSON.stringify({ challenge, redirect, completed })).not.toContain("ignored-refresh-token");
  });

  it("rejects invalid provider verification and expired local signup challenges", async () => {
    let now = Date.parse("2026-09-24T00:00:00.000Z");
    const wix = mockWix(ok({ access_token: "visitor-token" }), ok({ state: "REQUIRE_EMAIL_VERIFICATION", stateToken: "provider-state-token" }));
    const provider = new WixDirectAuthProvider({ ...config, now: () => now }, wix.fetch);
    const challenge = await provider.startEmailSignup({ displayName: "Puzzle Player", email: "player@example.com", password: "safe-password" });
    now += 11 * 60 * 1000;
    await expect(provider.verifyEmailSignup({ challengeId: challenge.challengeId, code: "123456", returnTo: "/hub" })).rejects.toMatchObject({ code: "WIX_SIGNUP_CHALLENGE_INVALID" });

    const retryWix = mockWix(ok({ access_token: "visitor-token" }), ok({ state: "REQUIRE_EMAIL_VERIFICATION", stateToken: "state" }), failure(400, { code: "INVALID_CODE" }));
    const retryProvider = new WixDirectAuthProvider(config, retryWix.fetch);
    const retryChallenge = await retryProvider.startEmailSignup({ displayName: "Puzzle Player", email: "player@example.com", password: "safe-password" });
    await expect(retryProvider.verifyEmailSignup({ challengeId: retryChallenge.challengeId, code: "000000", returnTo: "/hub" })).rejects.toMatchObject({ code: "WIX_SIGNUP_VERIFICATION_INVALID", statusCode: 400 });
  });

  it("requests the full Wix member projection and returns a verified Google identity", async () => {
    const { provider, state, wix } = await startGoogleFlow();
    expect(bodyAt(wix.calls, 1).auth.authRequest).toMatchObject({ idp: "0e6a50f5-b523-4e29-990d-f37fa2ffdd69", responseMode: "query" });
    await expect(provider.completeAuthorization({ code: "code", state: `${state}tampered` })).rejects.toMatchObject({ code: "WIX_AUTH_STATE_INVALID", statusCode: 400 });
    wix.responses.push(ok({ access_token: "google-member-token" }), ok(verifiedMember));
    const completed = await provider.completeAuthorization({ code: "code", state });
    expect(wix.calls[3].url).toBe("https://wix.example.test/members/v1/members/my?fieldsets=FULL");
    expect(completed.identity).toMatchObject({ sourceSite: "CIRCZLES_COM", provider: "GOOGLE", externalIdentityId: "wix-member-1", emailVerified: true });
  });

  it("rejects a member identity that does not match the email authenticated by Wix", async () => {
    const wix = mockWix(
      ok({ access_token: "visitor-token" }),
      ok({ state: "SUCCESS", sessionToken: "session-token" }),
      ok({ redirectSession: { fullUrl: "https://wix.example.test/authorize" } }),
      ok({ access_token: "member-token" }),
      ok({ member: { ...verifiedMember.member, loginEmail: "other@example.com" } }),
    );
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    await provider.loginWithEmail({ email: "player@example.com", password: "safe-password", returnTo: "/hub" });
    const state = bodyAt(wix.calls, 2).auth.authRequest.state as string;
    await expect(provider.completeAuthorization({ code: "code", state })).rejects.toMatchObject({ code: "WIX_MEMBER_IDENTITY_INVALID", statusCode: 502 });
  });

  it("fails closed when direct-auth configuration is incomplete", () => {
    expect(() => new WixDirectAuthProvider({ ...config, clientId: "" }, mockWix().fetch)).toThrowError(AppError);
    expect(() => new WixDirectAuthProvider({ ...config, callbackUrl: "" }, mockWix().fetch)).toThrowError(AppError);
    try {
      new WixDirectAuthProvider({ ...config, clientId: "" }, mockWix().fetch);
    } catch (error) {
      expect(error).toMatchObject({ code: "DIRECT_AUTH_PROVIDER_NOT_CONFIGURED", statusCode: 503 });
    }
  });
});

async function startGoogleFlow() {
  const wix = mockWix(ok({ access_token: "visitor-token" }), ok({ redirectSession: { fullUrl: "https://wix.example.test/google" } }));
  const provider = new WixDirectAuthProvider(config, wix.fetch);
  await provider.getGoogleAuthorizationUrl({ returnTo: "/leaderboard" });
  return { provider, state: bodyAt(wix.calls, 1).auth.authRequest.state as string, wix };
}

function mockWix(...responses: Response[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const remaining = [...responses];
  const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: input.toString(), init });
    const response = remaining.shift();
    if (!response) throw new Error("Unexpected Wix request");
    return response;
  };
  return { calls, responses: remaining, fetch: mockFetch as typeof fetch };
}

function bodyAt(calls: Array<{ url: string; init?: RequestInit }>, index: number) {
  return JSON.parse(String(calls[index].init?.body)) as Record<string, unknown> & {
    auth: { authRequest: Record<string, unknown>; sessionToken?: string };
  };
}

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function failure(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function captureError(promise: Promise<unknown>) {
  try {
    await promise;
    throw new Error("Expected promise to reject");
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return error as AppError;
  }
}
