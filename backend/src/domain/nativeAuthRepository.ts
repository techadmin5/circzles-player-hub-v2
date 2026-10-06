import { and, eq, gt, isNull, lte, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { authChallenges, authIdentities, authRateLimits, authSessions, googleAuthStates, passwordCredentials, players, users } from "../db/schema.js";
import { normalizeEmail } from "./authSecurity.js";
import { AppError } from "./errors.js";
import { createPlayer, toPlayerDto, type IdentityAccount } from "./identity.js";

export type Challenge = typeof authChallenges.$inferInsert;
export type GoogleState = typeof googleAuthStates.$inferInsert;
export type Credential = { userId: string; email: string; passwordHash: string | null; hasGoogleIdentity?: boolean };
export interface NativeAuthRepository {
  credential(email: string): Promise<Credential | null>;
  account(userId: string): Promise<IdentityAccount>;
  addChallenge(challenge: Challenge): Promise<void>;
  consumeChallenge(tokenHash: string, purpose: string, now: Date, passwordHash?: string, userId?: string, bindingHash?: string): Promise<IdentityAccount>;
  googleAccount(subject: string, email: string, name: string | undefined, now: Date): Promise<IdentityAccount>;
  saveGoogleState(state: GoogleState): Promise<void>;
  consumeGoogleState(stateHash: string, bindingHash: string, now: Date): Promise<GoogleState | null>;
  rateLimit(key: string, limit: number, now: Date): Promise<void>;
  security(userId: string): Promise<{ email: string; hasPassword: boolean }>;
}
const invalidToken = () => new AppError("AUTH_TOKEN_INVALID", "This link is invalid, expired, or already used.", 400);
const unavailable = () => new AppError("ACCOUNT_UNAVAILABLE", "This account is not available.", 403);

export class DrizzleNativeAuthRepository implements NativeAuthRepository {
  constructor(private db: Database) {}
  async pruneExpired(now = new Date()) {
    await this.db.delete(authChallenges).where(lte(authChallenges.expiresAt, now));
    await this.db.delete(googleAuthStates).where(lte(googleAuthStates.expiresAt, now));
    await this.db.delete(authRateLimits).where(lte(authRateLimits.expiresAt, now));
  }
  async credential(email: string) {
    const [row] = await this.db.select({ userId: users.userId, email: users.verifiedEmail, passwordHash: passwordCredentials.passwordHash })
      .from(users).leftJoin(passwordCredentials, eq(users.userId, passwordCredentials.userId))
      .where(and(sql`lower(btrim(${users.verifiedEmail})) = ${email}`, eq(users.status, "ACTIVE"), sql`${users.emailVerifiedAt} is not null`)).limit(1);
    if (!row?.email) return null;
    const [google] = await this.db.select({ id: authIdentities.id }).from(authIdentities).where(and(eq(authIdentities.userId, row.userId), eq(authIdentities.provider, "GOOGLE"))).limit(1);
    return { ...row, email: normalizeEmail(row.email), hasGoogleIdentity: Boolean(google) };
  }
  async account(userId: string) {
    const [row] = await this.db.select({ user: users, player: players }).from(users).innerJoin(players, eq(users.userId, players.userId))
      .where(and(eq(users.userId, userId), eq(users.status, "ACTIVE"))).limit(1);
    if (!row) throw unavailable();
    return { userId, player: toPlayerDto(row.player, row.user.avatarUrl) };
  }
  async security(userId: string) {
    const [row] = await this.db.select({ email: users.verifiedEmail, passwordHash: passwordCredentials.passwordHash }).from(users)
      .leftJoin(passwordCredentials, eq(users.userId, passwordCredentials.userId)).where(and(eq(users.userId, userId), eq(users.status, "ACTIVE"))).limit(1);
    if (!row?.email) throw unavailable();
    return { email: normalizeEmail(row.email), hasPassword: Boolean(row.passwordHash) };
  }
  async addChallenge(challenge: Challenge) {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${challenge.email}, 0))`);
      await tx.update(authChallenges).set({ consumedAt: new Date() }).where(and(eq(authChallenges.email, challenge.email), eq(authChallenges.purpose, challenge.purpose), isNull(authChallenges.consumedAt)));
      await tx.insert(authChallenges).values(challenge);
    });
  }
  async consumeChallenge(tokenHash: string, purpose: string, now: Date, passwordHash?: string, userId?: string, bindingHash?: string) {
    return this.db.transaction(async (tx) => {
      const [candidate] = await tx.select({ email: authChallenges.email }).from(authChallenges).where(eq(authChallenges.tokenHash, tokenHash)).limit(1);
      if (!candidate) throw invalidToken();
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${candidate.email}, 0))`);
      // Lock after the email, consistently with issuance. Failed transactions leave the token unconsumed.
      const [challenge] = await tx.select().from(authChallenges).where(and(eq(authChallenges.tokenHash, tokenHash), eq(authChallenges.purpose, purpose), gt(authChallenges.expiresAt, now), isNull(authChallenges.consumedAt))).for("update");
      if (!challenge || (purpose === "SET_PASSWORD" && (challenge.userId !== userId || challenge.bindingHash !== bindingHash))) throw invalidToken();
      let user;
      if (purpose === "VERIFY_EMAIL") {
        [user] = await tx.select().from(users).where(sql`lower(btrim(${users.verifiedEmail})) = ${challenge.email}`).for("update");
        if (user && (user.status !== "ACTIVE" || !user.emailVerifiedAt)) throw unavailable();
        if (!user) {
          [user] = await tx.insert(users).values({ verifiedEmail: challenge.email, emailVerifiedAt: now, lastLoginAt: now }).onConflictDoNothing().returning();
          if (!user) [user] = await tx.select().from(users).where(sql`lower(btrim(${users.verifiedEmail})) = ${challenge.email}`).for("update");
        }
      } else if (challenge.userId) {
        [user] = await tx.select().from(users).where(eq(users.userId, challenge.userId)).for("update");
      }
      if (!user || user.status !== "ACTIVE" || normalizeEmail(user.verifiedEmail ?? "") !== challenge.email || !user.emailVerifiedAt) throw unavailable();
      const nextHash = purpose === "VERIFY_EMAIL" ? challenge.passwordHash : passwordHash;
      if (!nextHash) throw invalidToken();
      const [credential] = await tx.select().from(passwordCredentials).where(eq(passwordCredentials.userId, user.userId));
      if (purpose === "VERIFY_EMAIL") {
        const [google] = await tx.select({ id: authIdentities.id }).from(authIdentities).where(and(eq(authIdentities.userId, user.userId), eq(authIdentities.provider, "GOOGLE"))).limit(1);
        if (google) throw new AppError("PASSWORD_SETUP_REQUIRES_SESSION", "Sign in with Google, then set a password in Account security.", 403);
      }
      if (purpose !== "RESET_PASSWORD" && credential) throw new AppError("PASSWORD_ALREADY_SET", "A password is already set. Log in or reset it.", 409);
      if (purpose === "RESET_PASSWORD" && !credential) throw invalidToken();
      await tx.insert(passwordCredentials).values({ userId: user.userId, passwordHash: nextHash, passwordChangedAt: now })
        .onConflictDoUpdate({ target: passwordCredentials.userId, set: { passwordHash: nextHash, passwordChangedAt: now } });
      await tx.update(authChallenges).set({ consumedAt: now, passwordHash: null }).where(eq(authChallenges.id, challenge.id));
      // Changing credentials invalidates every outstanding reset/claim and every old session.
      await tx.update(authChallenges).set({ consumedAt: now, passwordHash: null }).where(and(eq(authChallenges.email, challenge.email), isNull(authChallenges.consumedAt)));
      await tx.update(authSessions).set({ status: "REVOKED", revokedAt: now, updatedAt: now }).where(eq(authSessions.userId, user.userId));
      let [player] = await tx.select().from(players).where(eq(players.userId, user.userId));
      if (!player) player = await createPlayer(tx, user.userId, challenge.displayName ?? undefined);
      return { userId: user.userId, player: toPlayerDto(player, user.avatarUrl) };
    });
  }
  async googleAccount(subject: string, email: string, name: string | undefined, now: Date) {
    return this.db.transaction(async (tx) => {
      // Serialize both email claims and provider subjects across backend instances.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'google:' + subject}, 0))`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${email}, 0))`);
      const [link] = await tx.select().from(authIdentities).where(and(eq(authIdentities.provider, "GOOGLE"), eq(authIdentities.providerSubject, subject)));
      let [user] = await tx.select().from(users).where(link ? eq(users.userId, link.userId) : sql`lower(btrim(${users.verifiedEmail})) = ${email}`).for("update");
      if (user && (user.status !== "ACTIVE" || !user.emailVerifiedAt)) throw unavailable();
      if (!user) {
        [user] = await tx.insert(users).values({ verifiedEmail: email, emailVerifiedAt: now, lastLoginAt: now }).onConflictDoNothing().returning();
        if (!user) [user] = await tx.select().from(users).where(sql`lower(btrim(${users.verifiedEmail})) = ${email}`).for("update");
      }
      if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) throw unavailable();
      if (!link) await tx.insert(authIdentities).values({ userId: user.userId, provider: "GOOGLE", providerSubject: subject, providerEmail: email });
      else await tx.update(authIdentities).set({ providerEmail: email, updatedAt: now }).where(eq(authIdentities.id, link.id));
      await tx.update(users).set({ lastLoginAt: now, updatedAt: now }).where(eq(users.userId, user.userId));
      let [player] = await tx.select().from(players).where(eq(players.userId, user.userId));
      if (!player) player = await createPlayer(tx, user.userId, name);
      return { userId: user.userId, player: toPlayerDto(player, user.avatarUrl) };
    });
  }
  async saveGoogleState(state: GoogleState) { await this.db.insert(googleAuthStates).values(state); }
  async consumeGoogleState(stateHash: string, bindingHash: string, now: Date) {
    const [state] = await this.db.delete(googleAuthStates).where(and(eq(googleAuthStates.stateHash, stateHash), eq(googleAuthStates.bindingHash, bindingHash), gt(googleAuthStates.expiresAt, now))).returning();
    return state ?? null;
  }
  async rateLimit(key: string, limit: number, now: Date) {
    const expiresAt = new Date(now.getTime() + 15 * 60_000);
    const [row] = await this.db.insert(authRateLimits).values({ key, attempts: 1, expiresAt }).onConflictDoUpdate({ target: authRateLimits.key, set: {
      attempts: sql`case when ${authRateLimits.expiresAt} <= ${now} then 1 else ${authRateLimits.attempts} + 1 end`,
      expiresAt: sql`case when ${authRateLimits.expiresAt} <= ${now} then ${expiresAt} else ${authRateLimits.expiresAt} end`,
    } }).returning();
    if (row.attempts > limit) throw new AppError("AUTH_RATE_LIMITED", "Too many attempts. Try again later.", 429);
  }
}
