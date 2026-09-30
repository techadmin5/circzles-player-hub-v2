import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { CaptchaType, CompletedDirectAuthorization, DirectAuthorizationCallback, DirectAuthProvider, DirectAuthRedirect, DirectEmailLoginResult, DirectEmailSignupResult } from "../../domain/directAuth.js";
import { AppError } from "../../domain/errors.js";
import type { IdentityProvider, VerifiedExternalIdentity } from "../../domain/identity.js";

const WIX_API_BASE_URL = "https://www.wixapis.com";
const GOOGLE_CONNECTION_ID = "0e6a50f5-b523-4e29-990d-f37fa2ffdd69";
const FLOW_TTL_MS = 10 * 60 * 1000;

const wixAuthResponseSchema = z.object({
  state: z.string().optional(),
  loginState: z.string().optional(),
  login_state: z.string().optional(),
  errorCode: z.string().optional(),
  error_code: z.string().optional(),
  sessionToken: z.string().min(1).optional(),
  session_token: z.string().min(1).optional(),
  stateToken: z.string().min(1).optional(),
  state_token: z.string().min(1).optional(),
  identity: z.object({ id: z.string().min(1).optional(), _id: z.string().min(1).optional() }).passthrough().optional(),
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
  onDiagnostic?: (diagnostic: WixAuthDiagnostic) => void;
}

export interface WixAuthDiagnostic {
  operation: "LOGIN" | "REGISTER" | "VERIFY";
  state: string | null;
  errorCode: string | null;
  status: number;
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

  async loginWithEmail(input: { email: string; password: string; captchaToken?: string; captchaType?: CaptchaType; returnTo: string }): Promise<DirectEmailLoginResult> {
    const visitorAccessToken = await this.createVisitorToken();
    const response = await this.postWixAuth("/_api/iam/authentication/v2/login", {
      login_id: { email: normalizeEmail(input.email) },
      password: input.password,
      ...captchaBody(input.captchaToken, input.captchaType),
    }, visitorAccessToken, "login");
    const state = authState(response);
    if (isEmailVerificationRequired(state)) {
      return this.createEmailVerificationChallenge(response, visitorAccessToken, normalizeEmail(input.email));
    }
    if (isOwnerApprovalRequired(state)) {
      throw new AppError("WIX_MEMBER_APPROVAL_REQUIRED", "This Wix membership is awaiting approval.", 403);
    }
    const sessionToken = authSessionToken(response);
    if (state !== "SUCCESS") throw new AppError("WIX_LOGIN_STATE_UNSUPPORTED", "Wix returned an unsupported login state.", 400);
    if (!sessionToken) throw new AppError("WIX_LOGIN_SESSION_TOKEN_MISSING", "Wix login did not return a session token.", 502);
    if (!authIdentityId(response)) throw new AppError("WIX_LOGIN_IDENTITY_MISSING", "Wix login did not return a member identity.", 502);
    return this.createAuthorizationRedirect({
      visitorAccessToken,
      sessionToken,
      flow: "EMAIL",
      expectedEmail: normalizeEmail(input.email),
      returnTo: safeLocalReturnTo(input.returnTo),
    });
  }

  async startEmailSignup(input: { displayName: string; email: string; password: string; captchaToken?: string; captchaType?: CaptchaType; returnTo?: string }): Promise<DirectEmailSignupResult> {
    const visitorAccessToken = await this.createVisitorToken();
    const expectedEmail = normalizeEmail(input.email);
    const response = await this.postWixAuth("/_api/iam/authentication/v2/register", {
      login_id: { email: expectedEmail },
      password: input.password,
      profile: { nickname: input.displayName.trim() },
      ...captchaBody(input.captchaToken, input.captchaType),
    }, visitorAccessToken, "signup");
    const state = authState(response);
    if (isOwnerApprovalRequired(state)) {
      throw new AppError("WIX_MEMBER_APPROVAL_REQUIRED", "This Wix membership is awaiting approval.", 403);
    }
    if (isEmailVerificationRequired(state)) {
      return this.createEmailVerificationChallenge(response, visitorAccessToken, expectedEmail);
    }
    if (state !== "SUCCESS") throw new AppError("WIX_SIGNUP_STATE_UNSUPPORTED", "Wix returned an unsupported signup state.", 400);
    const sessionToken = authSessionToken(response);
    if (!sessionToken) throw new AppError("WIX_SIGNUP_SESSION_TOKEN_MISSING", "Wix signup did not return a session token.", 502);
    if (!authIdentityId(response)) throw new AppError("WIX_SIGNUP_IDENTITY_MISSING", "Wix signup did not return a member identity.", 502);
    return this.createAuthorizationRedirect({
      visitorAccessToken,
      sessionToken,
      flow: "EMAIL",
      expectedEmail,
      returnTo: safeLocalReturnTo(input.returnTo ?? "/hub"),
    });
  }

  async verifyEmailSignup(input: { challengeId: string; code: string; returnTo: string }): Promise<DirectAuthRedirect> {
    const challenge = this.open(input.challengeId, signupChallengeSchema, "WIX_SIGNUP_CHALLENGE_INVALID");
    const response = await this.postWixAuth("/_api/iam/verification/v1/auth/verify", {
      code: input.code.trim(),
      stateToken: challenge.stateToken,
    }, challenge.visitorAccessToken, "verification");
    const sessionToken = authSessionToken(response);
    if (authState(response) !== "SUCCESS") throw new AppError("WIX_SIGNUP_VERIFICATION_INVALID", "The signup verification code is invalid or expired.", 400);
    if (!sessionToken) throw new AppError("WIX_VERIFICATION_SESSION_TOKEN_MISSING", "Wix verification did not return a session token.", 502);
    if (!authIdentityId(response)) throw new AppError("WIX_VERIFICATION_IDENTITY_MISSING", "Wix verification did not return a member identity.", 502);
    return this.createAuthorizationRedirect({
      visitorAccessToken: challenge.visitorAccessToken,
      sessionToken,
      flow: "EMAIL",
      expectedEmail: challenge.expectedEmail,
      returnTo: safeLocalReturnTo(input.returnTo),
    });
  }

  async getGoogleAuthorizationUrl(input: { returnTo: string }): Promise<DirectAuthRedirect> {
    const visitorAccessToken = await this.createVisitorToken();
    return this.createAuthorizationRedirect({ visitorAccessToken, flow: "GOOGLE", returnTo: input.returnTo });
  }

  async completeAuthorization(input: DirectAuthorizationCallback): Promise<CompletedDirectAuthorization> {
    const flow = this.open(input.state, authorizationStateSchema, "WIX_AUTH_STATE_INVALID");
    if ("error" in input) {
      if (input.error === "access_denied") {
        throw new AppError("WIX_AUTHORIZATION_DECLINED", "Wix authentication was cancelled or declined.", 401);
      }
      throw new AppError("WIX_AUTHORIZATION_FAILED", "Wix authentication could not be completed.", 502);
    }
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
      responseMode: input.flow === "GOOGLE" ? "fragment" : "query",
      responseType: "code",
      scope: "offline_access",
      state,
    };
    if (input.sessionToken) authRequest.sessionToken = input.sessionToken;
    if (input.flow === "GOOGLE") authRequest.idp = GOOGLE_CONNECTION_ID;
    const response = await this.requestJson("/_api/redirects-api/v1/redirect-session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: input.visitorAccessToken },
      body: JSON.stringify({ auth: { authRequest } }),
    }, "authorization redirect");
    const parsed = redirectResponseSchema.safeParse(response);
    if (!parsed.success) throw providerMalformed("authorization redirect");
    return { authorizationUrl: parsed.data.redirectSession.fullUrl };
  }

  private createEmailVerificationChallenge(
    response: z.infer<typeof wixAuthResponseSchema>,
    visitorAccessToken: string,
    expectedEmail: string,
  ) {
    const stateToken = authStateToken(response);
    if (!stateToken) throw providerMalformed("email verification");
    const expiresAt = this.now() + FLOW_TTL_MS;
    return {
      state: "EMAIL_VERIFICATION_REQUIRED" as const,
      challengeId: this.seal({ type: "SIGNUP_CHALLENGE", stateToken, visitorAccessToken, expectedEmail, expiresAt }),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  private async postWixAuth(path: string, body: unknown, accessToken: string, operation: string) {
    const response = await this.requestJson(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: accessToken },
      body: JSON.stringify(body),
    }, operation, (value, status) => this.reportAuthDiagnostic(operation, value, status));
    const parsed = wixAuthResponseSchema.safeParse(response);
    if (!parsed.success) throw providerMalformed(operation);
    if (authState(parsed.data) === "FAILURE" || parsed.data.errorCode || parsed.data.error_code) {
      throw wixAuthFailure(parsed.data, operation, 400);
    }
    return parsed.data;
  }

  private async requestJson(path: string, init: RequestInit, operation: string, onResponse?: (value: unknown, status: number) => void): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, init);
    } catch {
      onResponse?.({ errorCode: "NETWORK_ERROR" }, 0);
      throw new AppError("WIX_AUTH_UNAVAILABLE", "Wix authentication is temporarily unavailable.", 503);
    }
    if (!response.ok) {
      const providerError = await response.json().catch(() => undefined);
      onResponse?.(providerError, response.status);
      const mapped = wixAuthFailure(providerError, operation, response.status);
      if (mapped.code !== "WIX_AUTH_REQUEST_FAILED") throw mapped;
      if (operation === "verification" && (response.status === 400 || response.status === 401 || response.status === 403)) {
        throw new AppError("WIX_SIGNUP_VERIFICATION_INVALID", "The signup verification code is invalid or expired.", 400);
      }
      throw mapped;
    }
    try {
      const body: unknown = await response.json();
      onResponse?.(body, response.status);
      return body;
    } catch {
      onResponse?.({ errorCode: "MALFORMED_RESPONSE" }, response.status);
      throw providerMalformed(operation);
    }
  }

  private reportAuthDiagnostic(operation: string, value: unknown, status: number) {
    const diagnosticOperation = diagnosticOperationFor(operation);
    if (!diagnosticOperation) return;
    this.config.onDiagnostic?.({
      operation: diagnosticOperation,
      state: providerState(value),
      errorCode: providerErrorCodes(value).join("|").slice(0, 160) || null,
      status,
    });
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
  return { captcha_tokens: [{ [type === "INVISIBLE_RECAPTCHA" ? "InvisibleRecaptcha" : "Recaptcha"]: token }] };
}

function authState(response: z.infer<typeof wixAuthResponseSchema>) {
  return response.state ?? response.loginState ?? response.login_state ?? "";
}

function authSessionToken(response: z.infer<typeof wixAuthResponseSchema>) {
  return response.sessionToken ?? response.session_token;
}

function authStateToken(response: z.infer<typeof wixAuthResponseSchema>) {
  return response.stateToken ?? response.state_token;
}

function authIdentityId(response: z.infer<typeof wixAuthResponseSchema>) {
  return response.identity?.id ?? response.identity?._id;
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

function providerErrorCodes(value: unknown) {
  const markers: string[] = [];
  collectProviderErrorCodes(value, markers, 0);
  return markers;
}

function collectProviderErrorCodes(value: unknown, markers: string[], depth: number) {
  if (depth > 4 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) collectProviderErrorCodes(item, markers, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (["code", "errorCode", "error_code"].includes(key)) collectScalarValues(item, markers, depth + 1);
      else if (typeof item === "object") collectProviderErrorCodes(item, markers, depth + 1);
    }
  }
}

function collectScalarValues(value: unknown, markers: string[], depth: number) {
  if (depth > 6 || value === null || value === undefined) return;
  if (typeof value === "string" || typeof value === "number") {
    markers.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectScalarValues(item, markers, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) collectScalarValues(item, markers, depth + 1);
  }
}

function providerState(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const state = record.state ?? record.loginState ?? record.login_state;
  return typeof state === "string" ? state.slice(0, 80) : null;
}

function diagnosticOperationFor(operation: string): WixAuthDiagnostic["operation"] | undefined {
  if (operation === "login") return "LOGIN";
  if (operation === "signup") return "REGISTER";
  if (operation === "verification") return "VERIFY";
  return undefined;
}

function wixAuthFailure(value: unknown, operation: string, status: number) {
  const errorCodes = providerErrorCodes(value);
  const marker = errorCodes.join(" ").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (status === 403 && errorCodes.some((code) => code.trim() === "-19971")) {
    return new AppError("WIX_CAPTCHA_REQUIRED", "Wix requires a CAPTCHA response.", 400, { captchaRequired: true });
  }
  if (marker.includes("INVALIDCAPTCHATOKEN")) {
    return new AppError("WIX_CAPTCHA_INVALID", "The Wix CAPTCHA response is invalid or expired.", 400, { captchaInvalid: true });
  }
  if (marker.includes("MISSINGCAPTCHATOKEN") || marker.includes("CAPTCHAREQUIRED") || marker.includes("RECAPTCHAREQUIRED")) {
    return new AppError("WIX_CAPTCHA_REQUIRED", "Wix requires a CAPTCHA response.", 400, { captchaRequired: true });
  }
  if (operation === "login" && status === 404 && errorCodes.some((code) => code.trim() === "-19999")) {
    return new AppError("WIX_ACCOUNT_NOT_FOUND", "No Wix member account exists for this email.", 404);
  }
  if (operation === "login" && marker.includes("INVALIDEMAIL")) {
    return new AppError("WIX_ACCOUNT_NOT_FOUND", "No Wix member account exists for this email.", 404);
  }
  if (operation === "login" && marker.includes("INVALIDPASSWORD")) {
    return new AppError("WIX_INCORRECT_PASSWORD", "The Wix member password was not accepted.", 401);
  }
  if (operation === "login" && marker.includes("RESETPASSWORD")) {
    return new AppError("WIX_PASSWORD_RESET_REQUIRED", "Wix requires this member to reset their password.", 403);
  }
  if (operation === "signup" && (marker.includes("EMAILALREADYEXISTS") || marker.includes("ALREADYEXISTS"))) {
    return new AppError("WIX_ACCOUNT_ALREADY_EXISTS", "A Wix member account already exists for this email.", 409);
  }
  if (marker.includes("INVALIDEMAIL")) {
    return new AppError("WIX_INVALID_EMAIL", "Wix rejected the email address.", 400);
  }
  if (operation === "login") {
    return new AppError("WIX_LOGIN_FAILED", "Unable to complete login. Please try again.", status >= 500 ? 503 : 400);
  }
  if (operation === "signup") {
    return new AppError("WIX_SIGNUP_FAILED", "Unable to create account. Please try again.", status >= 500 ? 503 : 400);
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
