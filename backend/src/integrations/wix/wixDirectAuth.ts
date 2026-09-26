import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { CaptchaType, CompletedDirectAuthorization, DirectAuthProvider, DirectAuthRedirect, DirectSignupChallenge } from "../../domain/directAuth.js";
import { AppError } from "../../domain/errors.js";
import type { IdentityProvider, VerifiedExternalIdentity } from "../../domain/identity.js";

const WIX_API_BASE_URL = "https://www.wixapis.com";
const GOOGLE_CONNECTION_ID = "0e6a50f5-b523-4e29-990d-f37fa2ffdd69";
const FLOW_TTL_MS = 10 * 60 * 1000;

const wixAuthResponseSchema = z.object({
  state: z.string().optional(),
  loginState: z.string().optional(),
  errorCode: z.string().optional(),
  sessionToken: z.string().min(1).optional(),
  stateToken: z.string().min(1).optional(),
}).passthrough();

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive().optional(),
}).passthrough();

const redirectResponseSchema = z.object({
  redirectSession: z.object({ fullUrl: z.string().url() }).passthrough(),
}).passthrough();

const memberResponseSchema = z.object({
  member: z.object({
    id: z.string().min(1).optional(),
    _id: z.string().min(1).optional(),
    loginEmail: z.string().email(),
    loginEmailVerified: z.literal(true),
    status: z.string().optional(),
    contact: z.object({ firstName: z.string().optional(), lastName: z.string().optional() }).optional(),
    profile: z.object({
      nickname: z.string().optional(),
      picture: z.string().optional(),
      photo: z.object({ url: z.string().optional() }).optional(),
    }).optional(),
  }).passthrough(),
}).passthrough();

const signupChallengeSchema = z.object({
  type: z.literal("SIGNUP_CHALLENGE"),
  stateToken: z.string().min(1),
  visitorAccessToken: z.string().min(1),
  expectedEmail: z.string().email(),
  expiresAt: z.number().int().positive(),
});

const authorizationStateSchema = z.object({
  type: z.literal("AUTHORIZATION_STATE"),
  flow: z.enum(["EMAIL", "GOOGLE"]),
  codeVerifier: z.string().min(43).max(128),
  expectedEmail: z.string().email().optional(),
  returnTo: z.string().min(1).max(512),
  expiresAt: z.number().int().positive(),
  nonce: z.string().min(16),
});

interface WixDirectAuthConfig {
  clientId: string;
  callbackUrl: string;
  stateSecret: string;
  apiBaseUrl?: string;
  now?: () => number;
}

type Fetch = typeof fetch;

export class WixDirectAuthProvider implements DirectAuthProvider {
  private readonly apiBaseUrl: string;
  private readonly stateKey: Buffer;
  private readonly now: () => number;

  constructor(private readonly config: WixDirectAuthConfig, private readonly fetchImpl: Fetch = fetch) {
    if (!config.clientId.trim() || !config.callbackUrl.trim() || config.stateSecret.length < 32) {
      throw new AppError("DIRECT_AUTH_PROVIDER_NOT_CONFIGURED", "Direct Player Hub authentication is not configured.", 503);
    }
    try {
      new URL(config.callbackUrl);
    } catch {
      throw new AppError("DIRECT_AUTH_PROVIDER_NOT_CONFIGURED", "Direct Player Hub authentication is not configured.", 503);
    }
    this.apiBaseUrl = (config.apiBaseUrl ?? WIX_API_BASE_URL).replace(/\/$/, "");
    this.stateKey = createHash("sha256").update(config.stateSecret).digest();
    this.now = config.now ?? Date.now;
  }

  async loginWithEmail(input: { email: string; password: string; captchaToken?: string; captchaType?: CaptchaType; returnTo: string }): Promise<DirectAuthRedirect> {
    const visitorAccessToken = await this.createVisitorToken();
    const response = await this.postWixAuth("/_api/iam/authentication/v2/login", {
      loginId: { email: normalizeEmail(input.email) },
      password: input.password,
      ...captchaBody(input.captchaToken, input.captchaType),
    }, visitorAccessToken, "login");
    const state = authState(response);
    if (isEmailVerificationRequired(state)) {
      throw new AppError("WIX_EMAIL_NOT_VERIFIED", "Verify this email through signup before logging in.", 403);
    }
    if (isOwnerApprovalRequired(state)) {
      throw new AppError("WIX_MEMBER_APPROVAL_REQUIRED", "This Wix membership is awaiting approval.", 403);
    }
    if (state !== "SUCCESS" || !response.sessionToken) {
      throw new AppError("WIX_LOGIN_FAILED", "Wix could not complete email login.", 401);
    }
    return this.createAuthorizationRedirect({
      visitorAccessToken,
      sessionToken: response.sessionToken,
      flow: "EMAIL",
      expectedEmail: normalizeEmail(input.email),
      returnTo: safeLocalReturnTo(input.returnTo),
    });
  }

  async startEmailSignup(input: { displayName: string; email: string; password: string; captchaToken?: string; captchaType?: CaptchaType }): Promise<DirectSignupChallenge> {
    const visitorAccessToken = await this.createVisitorToken();
    const expectedEmail = normalizeEmail(input.email);
    const response = await this.postWixAuth("/_api/iam/authentication/v2/register", {
      loginId: { email: expectedEmail },
      password: input.password,
      profile: { nickname: input.displayName.trim() },
      ...captchaBody(input.captchaToken, input.captchaType),
    }, visitorAccessToken, "signup");
    const state = authState(response);
    if (isOwnerApprovalRequired(state)) {
      throw new AppError("WIX_MEMBER_APPROVAL_REQUIRED", "This Wix membership is awaiting approval.", 403);
    }
    if (!isEmailVerificationRequired(state) || !response.stateToken) {
      if (state === "SUCCESS") {
        throw new AppError("WIX_SIGNUP_VERIFICATION_NOT_REQUIRED", "Wix must require email verification for Player Hub signup.", 503);
      }
      throw new AppError("WIX_SIGNUP_FAILED", "Wix could not start email signup.", 400);
    }
    const expiresAt = this.now() + FLOW_TTL_MS;
    return {
      challengeId: this.seal({ type: "SIGNUP_CHALLENGE", stateToken: response.stateToken, visitorAccessToken, expectedEmail, expiresAt }),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async verifyEmailSignup(input: { challengeId: string; code: string; returnTo: string }): Promise<DirectAuthRedirect> {
    const challenge = this.open(input.challengeId, signupChallengeSchema, "WIX_SIGNUP_CHALLENGE_INVALID");
    const response = await this.postWixAuth("/_api/iam/verification/v1/auth/verify", {
      code: input.code.trim(),
      stateToken: challenge.stateToken,
    }, challenge.visitorAccessToken, "verification");
    if (authState(response) !== "SUCCESS" || !response.sessionToken) {
      throw new AppError("WIX_SIGNUP_VERIFICATION_INVALID", "The signup verification code is invalid or expired.", 400);
    }
    return this.createAuthorizationRedirect({
      visitorAccessToken: challenge.visitorAccessToken,
      sessionToken: response.sessionToken,
      flow: "EMAIL",
      expectedEmail: challenge.expectedEmail,
      returnTo: safeLocalReturnTo(input.returnTo),
    });
  }

  async getGoogleAuthorizationUrl(input: { returnTo: string }): Promise<DirectAuthRedirect> {
    const visitorAccessToken = await this.createVisitorToken();
    return this.createAuthorizationRedirect({ visitorAccessToken, flow: "GOOGLE", returnTo: input.returnTo });
  }

  async completeAuthorization(input: { code: string; state: string }): Promise<CompletedDirectAuthorization> {
    const flow = this.open(input.state, authorizationStateSchema, "WIX_AUTH_STATE_INVALID");
    const tokens = await this.requestJson("/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: this.config.clientId,
        grantType: "authorization_code",
        code: input.code,
        codeVerifier: flow.codeVerifier,
        redirectUri: this.config.callbackUrl,
      }),
    }, "token exchange");
    const parsedTokens = tokenResponseSchema.safeParse(tokens);
    if (!parsedTokens.success) throw providerMalformed("token exchange");
    const memberResult = await this.requestJson("/members/v1/members/my?fieldsets=FULL", {
      method: "GET",
      headers: { Authorization: parsedTokens.data.access_token },
    }, "member identity");
    const parsedMember = memberResponseSchema.safeParse(memberResult);
    if (!parsedMember.success) {
      throw new AppError("WIX_MEMBER_IDENTITY_INVALID", "Wix did not return a verified canonical member identity.", 502);
    }
    const member = parsedMember.data.member;
    const memberId = member.id ?? member._id;
    const verifiedEmail = normalizeEmail(member.loginEmail);
    if (!memberId || member.status === "BLOCKED" || (flow.expectedEmail && verifiedEmail !== flow.expectedEmail)) {
      throw new AppError("WIX_MEMBER_IDENTITY_INVALID", "Wix did not return the expected canonical member identity.", 502);
    }
    return {
      identity: toVerifiedIdentity(memberId, verifiedEmail, flow.flow, member),
      returnTo: flow.returnTo,
    };
  }

  private async createVisitorToken() {
    const response = await this.requestJson("/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: this.config.clientId, grantType: "anonymous" }),
    }, "visitor token");
    const parsed = tokenResponseSchema.safeParse(response);
    if (!parsed.success) throw providerMalformed("visitor token");
    return parsed.data.access_token;
  }

  private async createAuthorizationRedirect(input: { visitorAccessToken: string; sessionToken?: string; flow: IdentityProvider; expectedEmail?: string; returnTo: string }) {
    if (input.flow !== "EMAIL" && input.flow !== "GOOGLE") throw providerMalformed("authorization flow");
    const codeVerifier = randomBytes(48).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const state = this.seal({
      type: "AUTHORIZATION_STATE",
      flow: input.flow,
      codeVerifier,
      expectedEmail: input.expectedEmail,
      returnTo: safeLocalReturnTo(input.returnTo),
      expiresAt: this.now() + FLOW_TTL_MS,
      nonce: randomBytes(18).toString("base64url"),
    });
    const authRequest: Record<string, string> = {
      redirectUri: this.config.callbackUrl,
      clientId: this.config.clientId,
      codeChallenge,
      codeChallengeMethod: "S256",
      responseMode: "query",
      responseType: "code",
      scope: "offline_access",
      state,
    };
    if (input.flow === "GOOGLE") authRequest.idp = GOOGLE_CONNECTION_ID;
    const response = await this.requestJson("/_api/redirects-api/v1/redirect-session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: input.visitorAccessToken },
      body: JSON.stringify({ auth: { authRequest, ...(input.sessionToken ? { sessionToken: input.sessionToken } : {}) } }),
    }, "authorization redirect");
    const parsed = redirectResponseSchema.safeParse(response);
    if (!parsed.success) throw providerMalformed("authorization redirect");
    return { authorizationUrl: parsed.data.redirectSession.fullUrl };
  }

  private async postWixAuth(path: string, body: unknown, accessToken: string, operation: string) {
    const response = await this.requestJson(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: accessToken },
      body: JSON.stringify(body),
    }, operation);
    const parsed = wixAuthResponseSchema.safeParse(response);
    if (!parsed.success) throw providerMalformed(operation);
    if (authState(parsed.data) === "FAILURE" || parsed.data.errorCode) {
      throw wixAuthFailure(parsed.data, operation, 400);
    }
    return parsed.data;
  }

  private async requestJson(path: string, init: RequestInit, operation: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, init);
    } catch {
      throw new AppError("WIX_AUTH_UNAVAILABLE", "Wix authentication is temporarily unavailable.", 503);
    }
    if (!response.ok) {
      const providerError = await response.json().catch(() => undefined);
      const mapped = wixAuthFailure(providerError, operation, response.status);
      if (mapped.code !== "WIX_AUTH_REQUEST_FAILED") throw mapped;
      if (operation === "verification" && (response.status === 400 || response.status === 401 || response.status === 403)) {
        throw new AppError("WIX_SIGNUP_VERIFICATION_INVALID", "The signup verification code is invalid or expired.", 400);
      }
      throw mapped;
    }
    try {
      return await response.json();
    } catch {
      throw providerMalformed(operation);
    }
  }

  private seal(payload: object) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.stateKey, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    return `${iv.toString("base64url")}.${encrypted.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
  }

  private open<T>(value: string, schema: z.ZodType<T>, errorCode: string): T {
    try {
      const parts = value.split(".");
      if (parts.length !== 3) throw new Error("invalid state");
      const decipher = createDecipheriv("aes-256-gcm", this.stateKey, Buffer.from(parts[0], "base64url"));
      decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
      const decrypted = Buffer.concat([decipher.update(Buffer.from(parts[1], "base64url")), decipher.final()]);
      const parsed = schema.parse(JSON.parse(decrypted.toString("utf8")));
      if (!isUnexpired(parsed, this.now())) throw new Error("expired state");
      return parsed;
    } catch {
      throw new AppError(errorCode, "The Wix authentication flow is invalid or expired.", 400);
    }
  }
}

function captchaBody(token?: string, type: CaptchaType = "RECAPTCHA") {
  if (!token) return {};
  return { captchaTokens: [{ [type === "INVISIBLE_RECAPTCHA" ? "InvisibleRecaptcha" : "Recaptcha"]: token }] };
}

function authState(response: z.infer<typeof wixAuthResponseSchema>) {
  return response.state ?? response.loginState ?? "";
}

function isEmailVerificationRequired(state: string) {
  return state === "REQUIRE_EMAIL_VERIFICATION" || state === "EMAIL_VERIFICATION_REQUIRED";
}

function isOwnerApprovalRequired(state: string) {
  return state === "REQUIRE_OWNER_APPROVAL" || state === "OWNER_APPROVAL_REQUIRED";
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function safeLocalReturnTo(value: string) {
  return value.startsWith("/") && !value.startsWith("//") ? value.slice(0, 512) : "/hub";
}

function isUnexpired(value: unknown, now: number): value is { expiresAt: number } {
  return typeof value === "object" && value !== null && "expiresAt" in value && typeof value.expiresAt === "number" && value.expiresAt > now;
}

function providerMalformed(operation: string) {
  return new AppError("WIX_AUTH_RESPONSE_INVALID", `Wix returned an invalid ${operation} response.`, 502);
}

function providerErrorMarker(value: unknown) {
  const markers: string[] = [];
  collectProviderMarkers(value, markers, 0);
  return markers.join(" ").toUpperCase();
}

function collectProviderMarkers(value: unknown, markers: string[], depth: number) {
  if (depth > 4 || value === null || value === undefined) return;
  if (typeof value === "string") {
    markers.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectProviderMarkers(item, markers, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (["code", "errorCode", "error"].includes(key) && typeof item === "string") markers.push(item);
      else if (typeof item === "object") collectProviderMarkers(item, markers, depth + 1);
    }
  }
}

function wixAuthFailure(value: unknown, operation: string, status: number) {
  const marker = providerErrorMarker(value).replace(/[^A-Z0-9]/g, "");
  if (marker.includes("INVALIDCAPTCHATOKEN")) {
    return new AppError("WIX_CAPTCHA_INVALID", "The Wix CAPTCHA response is invalid or expired.", 400, { captchaInvalid: true });
  }
  if (marker.includes("MISSINGCAPTCHATOKEN") || marker.includes("CAPTCHAREQUIRED") || marker.includes("RECAPTCHAREQUIRED")) {
    return new AppError("WIX_CAPTCHA_REQUIRED", "Wix requires a CAPTCHA response.", 400, { captchaRequired: true });
  }
  if (operation === "login" && marker.includes("INVALIDEMAIL")) {
    return new AppError("WIX_ACCOUNT_NOT_FOUND", "No Wix member account exists for this email.", 404);
  }
  if (operation === "login" && marker.includes("INVALIDPASSWORD")) {
    return new AppError("WIX_INCORRECT_PASSWORD", "The Wix member password was not accepted.", 401);
  }
  if (operation === "signup" && (marker.includes("EMAILALREADYEXISTS") || marker.includes("ALREADYEXISTS"))) {
    return new AppError("WIX_ACCOUNT_ALREADY_EXISTS", "A Wix member account already exists for this email.", 409);
  }
  if (marker.includes("INVALIDEMAIL")) {
    return new AppError("WIX_INVALID_EMAIL", "Wix rejected the email address.", 400);
  }
  if (operation === "login" && (status === 400 || status === 401 || status === 403)) {
    return new AppError("WIX_INVALID_CREDENTIALS", "Email or password was not accepted.", 401);
  }
  return new AppError("WIX_AUTH_REQUEST_FAILED", "Wix could not complete authentication.", status >= 500 ? 503 : 400);
}

function toVerifiedIdentity(
  memberId: string,
  verifiedEmail: string,
  provider: "EMAIL" | "GOOGLE",
  member: z.infer<typeof memberResponseSchema>["member"],
): VerifiedExternalIdentity {
  const photo = member.profile?.photo?.url ?? member.profile?.picture;
  return {
    sourceSite: "CIRCZLES_COM",
    provider,
    externalIdentityId: memberId,
    verifiedEmail,
    emailVerified: true,
    displayName: member.profile?.nickname,
    firstName: member.contact?.firstName,
    lastName: member.contact?.lastName,
    avatarUrl: photo?.startsWith("//") ? `https:${photo}` : photo,
  };
}
