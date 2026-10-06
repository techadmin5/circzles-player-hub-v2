import { AppError } from "./errors.js";
import type { AuthMailer } from "./authEmail.js";
import type { NativeAuthRepository } from "./nativeAuthRepository.js";
import { authToken, hashPassword, normalizeEmail, tokenDigest, verifyPassword } from "./authSecurity.js";

export class NativeAuthService {
  private dummyHash = hashPassword(authToken());
  constructor(readonly repo: NativeAuthRepository, private mailer: AuthMailer) {}
  async limit(scope: string, value: string, limit: number, now = new Date()) { await this.repo.rateLimit(tokenDigest(`${scope}:${value}`), limit, now); }
  async signup(input: { email: string; password: string; displayName: string }, now = new Date()) {
    const email = normalizeEmail(input.email);
    await this.limit("signup-email", email, 5, now);
    const passwordHash = await hashPassword(input.password);
    const credential = await this.repo.credential(email);
    // Do not replace an existing credential, even after email ownership is proved.
    if (!credential?.passwordHash && !credential?.hasGoogleIdentity) await this.challenge(email, "VERIFY_EMAIL", { passwordHash, displayName: input.displayName }, now);
    return { state: "EMAIL_VERIFICATION_REQUIRED", message: "If eligible, a verification link has been sent. Existing players can verify to claim their account; otherwise log in or reset your password." };
  }
  async verify(token: string, now = new Date()) { return this.repo.consumeChallenge(tokenDigest(token), "VERIFY_EMAIL", now); }
  async login(emailInput: string, password: string) {
    const email = normalizeEmail(emailInput);
    await this.limit("login-email", email, 15);
    const credential = await this.repo.credential(email);
    const valid = await verifyPassword(credential?.passwordHash ?? await this.dummyHash, password);
    if (!credential?.passwordHash || !valid) throw new AppError("AUTH_LOGIN_FAILED", "Email or password is incorrect, or email verification is incomplete.", 401);
    return { ...await this.repo.account(credential.userId), passwordCredentialHash: credential.passwordHash };
  }
  async forgot(emailInput: string, now = new Date()) {
    const email = normalizeEmail(emailInput);
    // Generic response even when the per-email delivery limit is reached.
    try { await this.limit("reset-email", email, 5, now); } catch (error) { if (error instanceof AppError && error.statusCode === 429) return { ok: true }; throw error; }
    const credential = await this.repo.credential(email);
    if (credential?.passwordHash) {
      try { await this.challenge(email, "RESET_PASSWORD", { userId: credential.userId }, now); }
      catch (error) { if (!(error instanceof AppError && error.code === "AUTH_EMAIL_UNAVAILABLE")) throw error; }
    }
    return { ok: true };
  }
  async reset(token: string, password: string, now = new Date()) { return this.repo.consumeChallenge(tokenDigest(token), "RESET_PASSWORD", now, await hashPassword(password)); }
  async requestPassword(userId: string, sessionToken: string, now = new Date()) {
    const security = await this.repo.security(userId);
    if (security.hasPassword) throw new AppError("PASSWORD_ALREADY_SET", "Use forgot password to change your password.", 409);
    await this.limit("set-password", userId, 5, now);
    await this.challenge(security.email, "SET_PASSWORD", { userId, bindingHash: tokenDigest(sessionToken) }, now);
    return { ok: true };
  }
  async setPassword(token: string, password: string, userId: string, sessionToken: string, now = new Date()) {
    return this.repo.consumeChallenge(tokenDigest(token), "SET_PASSWORD", now, await hashPassword(password), userId, tokenDigest(sessionToken));
  }
  private async challenge(email: string, purpose: string, fields: { passwordHash?: string; displayName?: string; userId?: string; bindingHash?: string }, now: Date) {
    const token = authToken(); const expiresAt = new Date(now.getTime() + (purpose === "VERIFY_EMAIL" ? 60 : 15) * 60_000);
    await this.repo.addChallenge({ email, purpose, tokenHash: tokenDigest(token), expiresAt, ...fields });
    await this.mailer.send({ email, purpose, token, issuedAt: now, expiresAt });
  }
}
