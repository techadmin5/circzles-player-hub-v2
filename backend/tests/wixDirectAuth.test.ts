import { describe, expect, it } from "vitest";
import { AppError } from "../src/domain/errors.js";
import { WixDirectAuthProvider } from "../src/integrations/wix/wixDirectAuth.js";

const config = {
  clientId: "canonical-circzles-com-client",
  callbackUrl: "https://app.example.test/auth/callback",
  stateSecret: "test-state-secret-with-at-least-32-characters",
  apiBaseUrl: "https://wix.example.test",
};
const productionCallbackUrl = "https://circzles-player-hub.vercel.app/auth/callback";

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
const authIdentity = { id: "wix-member-1" };

describe("WixDirectAuthProvider", () => {
  it("completes successful email login through PKCE and returns a verified Wix member", async () => {
    const wix = mockWix(
      ok({ access_token: "visitor-token" }),
      ok({ state: "SUCCESS", session_token: "member-session-token", identity: authIdentity }),
      ok({ redirectSession: { fullUrl: "https://wix.example.test/authorize-email" } }),
      ok({ access_token: "member-access-token", refresh_token: "member-refresh-token" }),
      ok(verifiedMember),
    );
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    const started = await provider.loginWithEmail({ email: "PLAYER@example.com", password: "safe-password", captchaToken: "visible-captcha-token", captchaType: "RECAPTCHA", returnTo: "/missions" });
    expect(started).toEqual({ authorizationUrl: "https://wix.example.test/authorize-email" });
    expect(bodyAt(wix.calls, 1)).toEqual({
      login_id: { email: "player@example.com" },
      password: "safe-password",
      captcha_tokens: [{ Recaptcha: "visible-captcha-token" }],
    });
    expect(bodyAt(wix.calls, 2).auth.authRequest.redirectUri).toBe(config.callbackUrl);
    const redirectBody = bodyAt(wix.calls, 2);
    expect(redirectBody.auth.authRequest).toMatchObject({ clientId: config.clientId, responseMode: "query", responseType: "code", scope: "offline_access" });
    expect(redirectBody.auth.authRequest.sessionToken).toBe("member-session-token");
    expect(redirectBody.auth.sessionToken).toBeUndefined();
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

  it("logs in without adding CAPTCHA data when Wix does not require a challenge", async () => {
    const wix = mockWix(
      ok({ access_token: "visitor-token" }),
      ok({ state: "SUCCESS", sessionToken: "member-session-token", identity: authIdentity }),
      ok({ redirectSession: { fullUrl: "https://wix.example.test/authorize-email" } }),
    );
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    await provider.loginWithEmail({ email: "player@example.com", password: "safe-password", returnTo: "/hub" });
    expect(bodyAt(wix.calls, 1)).toEqual({ login_id: { email: "player@example.com" }, password: "safe-password" });
  });

  it("rejects a Google-authenticated Wix member whose login email is explicitly unverified", async () => {
    const { provider, state, wix } = await startGoogleFlow();
    wix.responses.push(ok({ access_token: "member-token" }), ok({ member: { ...verifiedMember.member, loginEmailVerified: false } }));
    await expect(provider.completeAuthorization({ code: "code", state })).rejects.toMatchObject({ code: "WIX_MEMBER_IDENTITY_INVALID", statusCode: 502 });
    expect(wix.calls[3].url).toBe("https://wix.example.test/members/v1/members/my?fieldsets=FULL");
  });

  it("maps an incorrect password safely without returning provider data", async () => {
    const wix = mockWix(
      ok({ access_token: "visitor-token" }),
      failure(401, { details: { applicationError: { code: "INVALID_PASSWORD" } }, access_token: "must-not-leak", refresh_token: "must-not-leak" }),
    );
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    const error = await captureError(provider.loginWithEmail({ email: "player@example.com", password: "wrong-password", captchaToken: "still-current-token", captchaType: "RECAPTCHA", returnTo: "/hub" }));
    expect(error).toMatchObject({ code: "WIX_INCORRECT_PASSWORD", statusCode: 401 });
    expect(bodyAt(wix.calls, 1)).toMatchObject({ captcha_tokens: [{ Recaptcha: "still-current-token" }] });
    expect(JSON.stringify(error)).not.toContain("must-not-leak");
  });

  it("preserves Wix reset-password failures as a controlled category", async () => {
    const wix = mockWix(ok({ access_token: "visitor-token" }), ok({ state: "FAILURE", error_code: "resetPassword" }));
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    await expect(provider.loginWithEmail({ email: "player@example.com", password: "safe-password", returnTo: "/hub" })).rejects.toMatchObject({ code: "WIX_PASSWORD_RESET_REQUIRED", statusCode: 403 });
  });

  it("maps an unknown login email to the controlled account-not-found response", async () => {
    const wix = mockWix(ok({ access_token: "visitor-token" }), ok({ state: "FAILURE", error_code: "invalidEmail", error: "provider detail" }));
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    const error = await captureError(provider.loginWithEmail({ email: "missing@example.com", password: "safe-password", returnTo: "/hub" }));
    expect(error).toMatchObject({ code: "WIX_ACCOUNT_NOT_FOUND", statusCode: 404 });
    expect(JSON.stringify(error)).not.toContain("provider detail");
  });

  it("maps only Wix 404/-19999 to account not found", async () => {
    const missingMember = mockWix(
      ok({ access_token: "visitor-token" }),
      failure(404, { details: { applicationError: { code: "-19999", message: "provider detail" } } }),
    );
    const error = await captureError(new WixDirectAuthProvider(config, missingMember.fetch).loginWithEmail({ email: "missing@example.com", password: "safe-password", returnTo: "/hub" }));
    expect(error).toMatchObject({ code: "WIX_ACCOUNT_NOT_FOUND", statusCode: 404 });
    expect(JSON.stringify(error)).not.toContain("provider detail");

    const unrelatedNotFound = mockWix(
      ok({ access_token: "visitor-token" }),
      failure(404, { details: { applicationError: { code: "RESOURCE_NOT_FOUND" } } }),
    );
    await expect(new WixDirectAuthProvider(config, unrelatedNotFound.fetch).loginWithEmail({ email: "player@example.com", password: "safe-password", returnTo: "/hub" })).rejects.toMatchObject({ code: "WIX_LOGIN_FAILED" });
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

  it("maps Wix -19971 to CAPTCHA required only for the exact 403 provider condition", async () => {
    const missingCaptcha = mockWix(
      ok({ access_token: "visitor-token" }),
      failure(403, { details: { applicationError: { code: "-19971", message: "provider-secret-diagnostic" } } }),
    );
    const provider = new WixDirectAuthProvider(config, missingCaptcha.fetch);
    const error = await captureError(provider.loginWithEmail({ email: "player@example.com", password: "safe-password", returnTo: "/hub" }));
    expect(error).toMatchObject({ code: "WIX_CAPTCHA_REQUIRED", statusCode: 400, details: { captchaRequired: true } });
    expect(JSON.stringify(error)).not.toContain("provider-secret-diagnostic");

    const unrelatedForbidden = mockWix(
      ok({ access_token: "visitor-token" }),
      failure(403, { details: { applicationError: { code: "PERMISSION_DENIED" } } }),
    );
    await expect(new WixDirectAuthProvider(config, unrelatedForbidden.fetch).loginWithEmail({ email: "player@example.com", password: "safe-password", returnTo: "/hub" })).rejects.toMatchObject({ code: "WIX_LOGIN_FAILED" });
  });

  it("allows a -19971 login to retry with a real visible CAPTCHA token", async () => {
    const wix = mockWix(
      ok({ access_token: "first-visitor-token" }),
      failure(403, { details: { applicationError: { code: -19971 } } }),
      ok({ access_token: "second-visitor-token" }),
      ok({ state: "SUCCESS", session_token: "member-session-token", identity: authIdentity }),
      ok({ redirectSession: { fullUrl: "https://wix.example.test/authorize-retry" } }),
    );
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    await expect(provider.loginWithEmail({ email: "player@example.com", password: "safe-password", returnTo: "/hub" })).rejects.toMatchObject({ code: "WIX_CAPTCHA_REQUIRED" });

    await expect(provider.loginWithEmail({
      email: "player@example.com",
      password: "safe-password",
      captchaToken: "visible-captcha-token",
      captchaType: "RECAPTCHA",
      returnTo: "/hub",
    })).resolves.toEqual({ authorizationUrl: "https://wix.example.test/authorize-retry" });
    expect(bodyAt(wix.calls, 3)).toMatchObject({ captcha_tokens: [{ Recaptcha: "visible-captcha-token" }] });
  });

  it("distinguishes an invalid or expired CAPTCHA token from an initial challenge", async () => {
    const wix = mockWix(
      ok({ access_token: "visitor-token" }),
      ok({ state: "FAILURE", errorCode: "invalidCaptchaToken", error: "provider-secret-diagnostic" }),
    );
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    const error = await captureError(provider.loginWithEmail({ email: "player@example.com", password: "safe-password", captchaToken: "expired-token", captchaType: "RECAPTCHA", returnTo: "/hub" }));
    expect(error).toMatchObject({ code: "WIX_CAPTCHA_INVALID", statusCode: 400, details: { captchaInvalid: true } });
    expect(bodyAt(wix.calls, 1)).toMatchObject({ captcha_tokens: [{ Recaptcha: "expired-token" }] });
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
      ok({ state: "REQUIRE_EMAIL_VERIFICATION", state_token: "provider-state-token" }),
    );
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    const result = await provider.startEmailSignup({
      displayName: "Puzzle Player",
      email: "player@example.com",
      password: "safe-password",
      captchaToken: "captcha-token",
      captchaType: "INVISIBLE_RECAPTCHA",
    });
    if (!("challengeId" in result)) throw new Error("Expected an email verification challenge");
    expect(result.challengeId).not.toContain("provider-state-token");
    expect(result).toMatchObject({ state: "EMAIL_VERIFICATION_REQUIRED" });
    expect(result.challengeId.split(".")).toHaveLength(3);
    expect(bodyAt(wix.calls, 1)).toEqual({
      login_id: { email: "player@example.com" },
      password: "safe-password",
      profile: { nickname: "Puzzle Player" },
      captcha_tokens: [{ InvisibleRecaptcha: "captcha-token" }],
    });
  });

  it("continues a successful registration through the authorization redirect", async () => {
    const wix = mockWix(
      ok({ access_token: "visitor-token" }),
      ok({ state: "SUCCESS", session_token: "signup-session-token", identity: { id: "signup-identity-id" } }),
      ok({ redirectSession: { fullUrl: "https://wix.example.test/authorize-signup-success" } }),
    );
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    const result = await provider.startEmailSignup({
      displayName: " Puzzle Player ",
      email: "NEW@example.com",
      password: "safe-password",
      captchaToken: "visible-captcha-token",
      captchaType: "RECAPTCHA",
      returnTo: "/hub",
    });
    expect(result).toEqual({ authorizationUrl: "https://wix.example.test/authorize-signup-success" });
    expect(bodyAt(wix.calls, 1)).toEqual({
      login_id: { email: "new@example.com" },
      password: "safe-password",
      profile: { nickname: "Puzzle Player" },
      captcha_tokens: [{ Recaptcha: "visible-captcha-token" }],
    });
    expect(bodyAt(wix.calls, 2).auth.authRequest.sessionToken).toBe("signup-session-token");
    expect(bodyAt(wix.calls, 2).auth.authRequest.redirectUri).toBe(config.callbackUrl);
    expect(bodyAt(wix.calls, 2).auth.sessionToken).toBeUndefined();
  });

  it("preserves signup owner approval as a controlled pending state", async () => {
    const wix = mockWix(ok({ access_token: "visitor-token" }), ok({ state: "REQUIRE_OWNER_APPROVAL" }));
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    await expect(provider.startEmailSignup({ displayName: "Puzzle Player", email: "player@example.com", password: "safe-password", returnTo: "/hub" })).rejects.toMatchObject({ code: "WIX_MEMBER_APPROVAL_REQUIRED", statusCode: 403 });
  });

  it("fails closed when successful registration omits required identity artifacts", async () => {
    const missingToken = mockWix(ok({ access_token: "visitor-token" }), ok({ state: "SUCCESS", identity: authIdentity }));
    await expect(new WixDirectAuthProvider(config, missingToken.fetch).startEmailSignup({ displayName: "Puzzle Player", email: "player@example.com", password: "safe-password", returnTo: "/hub" })).rejects.toMatchObject({ code: "WIX_SIGNUP_SESSION_TOKEN_MISSING", statusCode: 502 });

    const missingIdentity = mockWix(ok({ access_token: "visitor-token" }), ok({ state: "SUCCESS", session_token: "signup-session-token" }));
    await expect(new WixDirectAuthProvider(config, missingIdentity.fetch).startEmailSignup({ displayName: "Puzzle Player", email: "player@example.com", password: "safe-password", returnTo: "/hub" })).rejects.toMatchObject({ code: "WIX_SIGNUP_IDENTITY_MISSING", statusCode: 502 });
  });

  it("preserves a login email-verification state and completes it with the sealed Wix state token", async () => {
    const wix = mockWix(
      ok({ access_token: "visitor-token" }),
      ok({ state: "EMAIL_VERIFICATION_REQUIRED", state_token: "login-verification-state" }),
    );
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    const challenge = await provider.loginWithEmail({ email: "player@example.com", password: "safe-password", returnTo: "/hub" });
    expect(challenge).toMatchObject({ state: "EMAIL_VERIFICATION_REQUIRED", challengeId: expect.any(String) });
    expect(JSON.stringify(challenge)).not.toContain("login-verification-state");

    if (!("challengeId" in challenge)) throw new Error("Expected an email verification challenge");
    wix.responses.push(
      ok({ state: "SUCCESS", session_token: "verified-session-token", identity: authIdentity }),
      ok({ redirectSession: { fullUrl: "https://wix.example.test/authorize-login-verification" } }),
    );
    const redirect = await provider.verifyEmailSignup({ challengeId: challenge.challengeId, code: "123456", returnTo: "/hub" });
    expect(redirect.authorizationUrl).toBe("https://wix.example.test/authorize-login-verification");
    expect(bodyAt(wix.calls, 2)).toEqual({ code: "123456", stateToken: "login-verification-state" });
    expect(bodyAt(wix.calls, 3).auth.authRequest.sessionToken).toBe("verified-session-token");
    expect(bodyAt(wix.calls, 3).auth.authRequest.redirectUri).toBe(config.callbackUrl);
    expect(bodyAt(wix.calls, 3).auth.sessionToken).toBeUndefined();
  });

  it("maps an existing signup email without exposing provider details", async () => {
    const wix = mockWix(
      ok({ access_token: "visitor-token" }),
      failure(409, { details: { applicationError: { code: "EMAIL_ALREADY_EXISTS", message: "provider detail" } } }),
    );
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    const error = await captureError(provider.startEmailSignup({ displayName: "Puzzle Player", email: "player@example.com", password: "safe-password" }));
    expect(error).toMatchObject({ code: "WIX_ACCOUNT_ALREADY_EXISTS", statusCode: 409 });
    expect(JSON.stringify(error)).not.toContain("provider detail");
  });

  it("maps a provider-rejected signup email to the controlled invalid-email response", async () => {
    const wix = mockWix(ok({ access_token: "visitor-token" }), ok({ state: "FAILURE", errorCode: "invalidEmail" }));
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    const error = await captureError(provider.startEmailSignup({ displayName: "Puzzle Player", email: "player@example.com", password: "safe-password" }));
    expect(error).toMatchObject({ code: "WIX_INVALID_EMAIL", statusCode: 400 });
  });

  it("verifies signup OTP with Wix and resolves the verified identity after callback", async () => {
    const wix = mockWix(
      ok({ access_token: "visitor-token" }),
      ok({ state: "EMAIL_VERIFICATION_REQUIRED", stateToken: "provider-state-token" }),
    );
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    const challenge = await provider.startEmailSignup({ displayName: "Puzzle Player", email: "player@example.com", password: "safe-password" });
    if (!("challengeId" in challenge)) throw new Error("Expected an email verification challenge");
    wix.responses.push(
      ok({ state: "SUCCESS", session_token: "verified-session-token", identity: authIdentity }),
      ok({ redirectSession: { fullUrl: "https://wix.example.test/authorize-signup" } }),
      ok({ access_token: "member-token", refresh_token: "ignored-refresh-token" }),
      ok(verifiedMember),
    );
    const redirect = await provider.verifyEmailSignup({ challengeId: challenge.challengeId, code: "123456", returnTo: "/hub" });
    expect(redirect.authorizationUrl).toBe("https://wix.example.test/authorize-signup");
    expect(bodyAt(wix.calls, 2)).toEqual({ code: "123456", stateToken: "provider-state-token" });
    expect(bodyAt(wix.calls, 3).auth.authRequest.sessionToken).toBe("verified-session-token");
    expect(bodyAt(wix.calls, 3).auth.sessionToken).toBeUndefined();
    const state = bodyAt(wix.calls, 3).auth.authRequest.state as string;
    const completed = await provider.completeAuthorization({ code: "code", state });
    expect(completed.identity).toMatchObject({ provider: "EMAIL", externalIdentityId: "wix-member-1", verifiedEmail: "player@example.com", emailVerified: true });
    expect(JSON.stringify({ challenge, redirect, completed })).not.toContain("visitor-token");
    expect(JSON.stringify({ challenge, redirect, completed })).not.toContain("member-token");
    expect(JSON.stringify({ challenge, redirect, completed })).not.toContain("ignored-refresh-token");
  });

  it("fails closed when Wix reports SUCCESS without an authenticated identity", async () => {
    const wix = mockWix(ok({ access_token: "visitor-token" }), ok({ state: "SUCCESS", session_token: "member-session-token" }));
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    await expect(provider.loginWithEmail({ email: "player@example.com", password: "safe-password", returnTo: "/hub" })).rejects.toMatchObject({ code: "WIX_LOGIN_IDENTITY_MISSING", statusCode: 502 });
    expect(wix.calls).toHaveLength(2);
  });

  it("fails closed when Wix reports SUCCESS without a session token", async () => {
    const wix = mockWix(ok({ access_token: "visitor-token" }), ok({ state: "SUCCESS", identity: authIdentity }));
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    await expect(provider.loginWithEmail({ email: "player@example.com", password: "safe-password", returnTo: "/hub" })).rejects.toMatchObject({ code: "WIX_LOGIN_SESSION_TOKEN_MISSING", statusCode: 502 });
    expect(wix.calls).toHaveLength(2);
  });

  it("preserves Wix owner-approval state as a controlled failure", async () => {
    const wix = mockWix(ok({ access_token: "visitor-token" }), ok({ state: "REQUIRE_OWNER_APPROVAL" }));
    const provider = new WixDirectAuthProvider(config, wix.fetch);
    await expect(provider.loginWithEmail({ email: "player@example.com", password: "safe-password", returnTo: "/hub" })).rejects.toMatchObject({ code: "WIX_MEMBER_APPROVAL_REQUIRED", statusCode: 403 });
  });

  it("extracts wrapped Wix error codes and emits only safe structured diagnostics", async () => {
    const diagnostics: unknown[] = [];
    const wix = mockWix(
      ok({ access_token: "visitor-token" }),
      failure(401, {
        state: "FAILURE",
        additionalData: { errorCode: { stringValue: "invalidPassword" } },
        password: "must-not-log",
        captchaToken: "must-not-log",
        session_token: "must-not-log",
      }),
    );
    const provider = new WixDirectAuthProvider({ ...config, onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) }, wix.fetch);
    await expect(provider.loginWithEmail({ email: "player@example.com", password: "wrong-password", returnTo: "/hub" })).rejects.toMatchObject({ code: "WIX_INCORRECT_PASSWORD" });
    expect(diagnostics).toEqual([{ operation: "LOGIN", state: "FAILURE", errorCode: "invalidPassword", status: 401 }]);
    expect(JSON.stringify(diagnostics)).not.toContain("must-not-log");
  });

  it("reports REGISTER state diagnostics without exposing request credentials", async () => {
    const diagnostics: unknown[] = [];
    const wix = mockWix(ok({ access_token: "visitor-token" }), ok({ state: "EMAIL_VERIFICATION_REQUIRED", state_token: "provider-state-token" }));
    const provider = new WixDirectAuthProvider({ ...config, onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) }, wix.fetch);
    await provider.startEmailSignup({ displayName: "Puzzle Player", email: "player@example.com", password: "safe-password", captchaToken: "captcha-secret" });
    expect(diagnostics).toEqual([{ operation: "REGISTER", state: "EMAIL_VERIFICATION_REQUIRED", errorCode: null, status: 200 }]);
    expect(JSON.stringify(diagnostics)).not.toContain("safe-password");
    expect(JSON.stringify(diagnostics)).not.toContain("captcha-secret");
  });

  it("maps unknown login and signup failure states to operation-specific safe errors", async () => {
    const loginWix = mockWix(ok({ access_token: "visitor-token" }), ok({ state: "FAILURE" }));
    const loginProvider = new WixDirectAuthProvider(config, loginWix.fetch);
    await expect(loginProvider.loginWithEmail({ email: "player@example.com", password: "safe-password", returnTo: "/hub" })).rejects.toMatchObject({ code: "WIX_LOGIN_FAILED", statusCode: 400 });

    const signupWix = mockWix(ok({ access_token: "visitor-token" }), ok({ state: "FAILURE" }));
    const signupProvider = new WixDirectAuthProvider(config, signupWix.fetch);
    await expect(signupProvider.startEmailSignup({ displayName: "Puzzle Player", email: "player@example.com", password: "safe-password" })).rejects.toMatchObject({ code: "WIX_SIGNUP_FAILED", statusCode: 400 });
  });

  it("rejects invalid provider verification and expired local signup challenges", async () => {
    let now = Date.parse("2026-09-24T00:00:00.000Z");
    const wix = mockWix(ok({ access_token: "visitor-token" }), ok({ state: "REQUIRE_EMAIL_VERIFICATION", stateToken: "provider-state-token" }));
    const provider = new WixDirectAuthProvider({ ...config, now: () => now }, wix.fetch);
    const challenge = await provider.startEmailSignup({ displayName: "Puzzle Player", email: "player@example.com", password: "safe-password" });
    if (!("challengeId" in challenge)) throw new Error("Expected an email verification challenge");
    now += 11 * 60 * 1000;
    await expect(provider.verifyEmailSignup({ challengeId: challenge.challengeId, code: "123456", returnTo: "/hub" })).rejects.toMatchObject({ code: "WIX_SIGNUP_CHALLENGE_INVALID" });

    const retryWix = mockWix(ok({ access_token: "visitor-token" }), ok({ state: "REQUIRE_EMAIL_VERIFICATION", stateToken: "state" }), failure(400, { code: "INVALID_CODE" }));
    const retryProvider = new WixDirectAuthProvider(config, retryWix.fetch);
    const retryChallenge = await retryProvider.startEmailSignup({ displayName: "Puzzle Player", email: "player@example.com", password: "safe-password" });
    if (!("challengeId" in retryChallenge)) throw new Error("Expected an email verification challenge");
    await expect(retryProvider.verifyEmailSignup({ challengeId: retryChallenge.challengeId, code: "000000", returnTo: "/hub" })).rejects.toMatchObject({ code: "WIX_SIGNUP_VERIFICATION_INVALID", statusCode: 400 });
  });

  it("requests the full Wix member projection and returns a verified Google identity", async () => {
    const { provider, state, wix } = await startGoogleFlow();
    expect(bodyAt(wix.calls, 1).auth.authRequest).toMatchObject({ idp: "0e6a50f5-b523-4e29-990d-f37fa2ffdd69", responseMode: "fragment" });
    expect(bodyAt(wix.calls, 1).auth.authRequest.redirectUri).toBe(config.callbackUrl);
    expect(bodyAt(wix.calls, 1).auth.authRequest.sessionToken).toBeUndefined();
    expect(bodyAt(wix.calls, 1).auth.sessionToken).toBeUndefined();
    await expect(provider.completeAuthorization({ code: "code", state: `${state}tampered` })).rejects.toMatchObject({ code: "WIX_AUTH_STATE_INVALID", statusCode: 400 });
    wix.responses.push(ok({ access_token: "google-member-token" }), ok(verifiedMember));
    const completed = await provider.completeAuthorization({ code: "code", state });
    expect(wix.calls[3].url).toBe("https://wix.example.test/members/v1/members/my?fieldsets=FULL");
    expect(completed.identity).toMatchObject({ sourceSite: "CIRCZLES_COM", provider: "GOOGLE", externalIdentityId: "wix-member-1", emailVerified: true });
  });

  it("validates Wix error callback state without exchanging a code or loading a member", async () => {
    const { provider, state, wix } = await startGoogleFlow();
    const error = await captureError(provider.completeAuthorization({
      error: "unknown_error",
      errorDescription: "provider detail must not escape",
      state,
    }));

    expect(error).toMatchObject({ code: "WIX_AUTHORIZATION_FAILED", statusCode: 502 });
    expect(JSON.stringify(error)).not.toContain("provider detail");
    expect(wix.calls).toHaveLength(2);
  });

  it("fails closed when a Wix error callback contains tampered state", async () => {
    const { provider, state, wix } = await startGoogleFlow();
    await expect(provider.completeAuthorization({ error: "unknown_error", state: `${state}tampered` }))
      .rejects.toMatchObject({ code: "WIX_AUTH_STATE_INVALID", statusCode: 400 });
    expect(wix.calls).toHaveLength(2);
  });

  it("fails closed when Google callback state has expired", async () => {
    let now = Date.parse("2026-09-30T00:00:00.000Z");
    const wix = mockWix(ok({ access_token: "visitor-token" }), ok({ redirectSession: { fullUrl: "https://wix.example.test/google" } }));
    const provider = new WixDirectAuthProvider({ ...config, now: () => now }, wix.fetch);
    await provider.getGoogleAuthorizationUrl({ returnTo: "/hub" });
    const state = bodyAt(wix.calls, 1).auth.authRequest.state as string;
    now += 11 * 60 * 1000;

    await expect(provider.completeAuthorization({ code: "code", state }))
      .rejects.toMatchObject({ code: "WIX_AUTH_STATE_INVALID", statusCode: 400 });
    expect(wix.calls).toHaveLength(2);
  });

  it("uses the exact public callback for redirect creation and code exchange", async () => {
    const wix = mockWix(
      ok({ access_token: "visitor-token" }),
      ok({ state: "SUCCESS", session_token: "member-session-token", identity: authIdentity }),
      ok({ redirectSession: { fullUrl: "https://wix.example.test/authorize-email" } }),
      ok({ access_token: "member-token", refresh_token: "ignored-refresh-token" }),
      ok(verifiedMember),
    );
    const provider = new WixDirectAuthProvider({ ...config, callbackUrl: productionCallbackUrl }, wix.fetch);
    await provider.loginWithEmail({ email: "player@example.com", password: "safe-password", returnTo: "/hub" });
    expect(bodyAt(wix.calls, 2).auth.authRequest.redirectUri).toBe(productionCallbackUrl);

    const state = bodyAt(wix.calls, 2).auth.authRequest.state as string;
    await provider.completeAuthorization({ code: "code", state });
    expect(bodyAt(wix.calls, 3).redirectUri).toBe(productionCallbackUrl);
  });

  it("rejects a member identity that does not match the email authenticated by Wix", async () => {
    const wix = mockWix(
      ok({ access_token: "visitor-token" }),
      ok({ state: "SUCCESS", sessionToken: "session-token", identity: authIdentity }),
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
