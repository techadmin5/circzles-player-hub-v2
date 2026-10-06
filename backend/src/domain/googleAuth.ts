import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { AppError } from "./errors.js";
import { authToken, normalizeEmail, safeReturnTo, tokenDigest } from "./authSecurity.js";
import type { NativeAuthRepository } from "./nativeAuthRepository.js";

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
export function createGoogleTokenVerifier(keys: CryptoKey | JWTVerifyGetKey = googleKeys) {
  return async (token: string, audience: string) => (await jwtVerify(token, keys, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience, algorithms: ["RS256"], requiredClaims: ["sub", "exp", "iat", "nonce", "email", "email_verified"], maxTokenAge: "10 minutes" })).payload;
}
export type GoogleConfig = { clientId: string; clientSecret: string; callbackUrl: string };
export class GoogleAuthService {
  constructor(private repo: NativeAuthRepository, private config: GoogleConfig | null, private transport: typeof fetch = fetch,
    private verifyIdToken: (token: string, audience: string) => Promise<JWTPayload> = createGoogleTokenVerifier()) {}
  async start(returnTo: string, now = new Date()) {
    if (!this.config) throw new AppError("GOOGLE_AUTH_NOT_CONFIGURED", "Google login is not configured.", 503);
    const state = authToken(), binding = authToken(), codeVerifier = authToken(), nonce = authToken();
    await this.repo.saveGoogleState({ stateHash: tokenDigest(state), bindingHash: tokenDigest(binding), codeVerifier, nonce, returnTo: safeReturnTo(returnTo), expiresAt: new Date(now.getTime() + 10 * 60_000) });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.callbackUrl, response_type: "code", scope: "openid email profile", state, nonce, code_challenge_method: "S256", code_challenge: createHash("sha256").update(codeVerifier).digest("base64url"), prompt: "select_account" }).toString();
    return { authorizationUrl: url.toString(), binding };
  }
  async complete(input: { state: string; code?: string; error?: string }, binding: string | undefined, now = new Date()) {
    if (!this.config || !binding) throw new AppError("GOOGLE_STATE_INVALID", "Restart Google login.", 400);
    const state = await this.repo.consumeGoogleState(tokenDigest(input.state), tokenDigest(binding), now);
    if (!state) throw new AppError("GOOGLE_STATE_INVALID", "Restart Google login.", 400);
    if (input.error || !input.code) throw new AppError("GOOGLE_AUTH_FAILED", "Google login did not complete.", 400);
    let claims: JWTPayload;
    try {
      const response = await this.transport("https://oauth2.googleapis.com/token", { method: "POST", signal: AbortSignal.timeout(10_000), headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: input.code, client_id: this.config.clientId, client_secret: this.config.clientSecret, redirect_uri: this.config.callbackUrl, grant_type: "authorization_code", code_verifier: state.codeVerifier }) });
      if (!response.ok) throw new Error("Exchange failed");
      const tokens = await response.json() as { id_token?: string };
      if (!tokens.id_token) throw new Error("Missing ID token");
      claims = await this.verifyIdToken(tokens.id_token, this.config.clientId);
    } catch { throw new AppError("GOOGLE_AUTH_FAILED", "Google login is temporarily unavailable. Try again.", 502); }
    if (claims.nonce !== state.nonce || claims.email_verified !== true || typeof claims.email !== "string" || !claims.email.includes("@") || typeof claims.sub !== "string" || !claims.sub || (claims.azp !== undefined && claims.azp !== this.config.clientId)) {
      throw new AppError("GOOGLE_IDENTITY_INVALID", "Google must return a verified email and valid identity.", 502);
    }
    const account = await this.repo.googleAccount(claims.sub, normalizeEmail(claims.email), typeof claims.name === "string" ? claims.name.slice(0, 80) : undefined, now);
    return { account, returnTo: safeReturnTo(state.returnTo) };
  }
}
