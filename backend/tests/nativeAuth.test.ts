import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile, readdir } from "node:fs/promises";
import { generateKeyPair, SignJWT } from "jose";
import { DrizzleNativeAuthRepository } from "../src/domain/nativeAuthRepository.js";
import { NativeAuthService } from "../src/domain/nativeAuth.js";
import { DevelopmentAuthMailer, ResendAuthMailer } from "../src/domain/authEmail.js";
import { GoogleAuthService, createGoogleTokenVerifier } from "../src/domain/googleAuth.js";
import { DrizzleIdentityRepository, IdentityService } from "../src/domain/identity.js";
import { tokenDigest, safeReturnTo } from "../src/domain/authSecurity.js";
import type { Database } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { eq } from "drizzle-orm";

const password = "a very strong test password";
const newPassword = "a different strong password";
const email = "player@example.test";
const config = { clientId: "google-client", clientSecret: "google-secret", callbackUrl: "https://hub.example.test/api/auth/google/callback" };
let pg: PGlite, db: Database, repo: DrizzleNativeAuthRepository, service: NativeAuthService, mailer: DevelopmentAuthMailer, identity: IdentityService;
const lastToken = () => mailer.messages.at(-1)!.token;
async function verifiedAccount() {
  await service.signup({ email, password, displayName: "Player" });
  return service.verify(lastToken());
}
async function google(claims: Record<string, unknown> = {}, transport?: typeof fetch) {
  const verify = vi.fn(async () => ({ sub: "google-sub", email, email_verified: true, nonce: "", ...claims }));
  const fetcher = transport ?? vi.fn(async () => Response.json({ id_token: "signed-token" })) as unknown as typeof fetch;
  const provider = new GoogleAuthService(repo, config, fetcher, verify);
  const start = await provider.start("/hub");
  const url = new URL(start.authorizationUrl);
  verify.mockImplementation(async () => ({ sub: "google-sub", email, email_verified: true, nonce: url.searchParams.get("nonce")!, ...claims }));
  return { provider, start, url, verify, fetcher, state: url.searchParams.get("state")! };
}

beforeAll(async () => {
  pg = new PGlite();
  // Apply the actual historical migrations, then the native migration, to a fresh PostgreSQL database.
  const files = (await readdir(new URL("../drizzle/", import.meta.url))).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = (await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", "");
    if (file.startsWith("0020_")) {
      await pg.exec("INSERT INTO users(user_id) VALUES ('10000000-0000-4000-8000-000000000001')");
      await expect(pg.exec(sql)).rejects.toThrow(/active legacy users lack verified email/);
      await pg.exec("UPDATE users SET verified_email='legacy-migration@example.test', email_verified_at=now(); INSERT INTO players(user_id, public_player_id, display_name) VALUES ('10000000-0000-4000-8000-000000000001', 'CZ-AAAAAA', 'Migration Player')");
      const usersBefore = (await pg.query("SELECT * FROM users")).rows;
      const playersBefore = (await pg.query("SELECT * FROM players")).rows;
      await pg.exec(sql);
      expect((await pg.query("SELECT * FROM users")).rows).toEqual(usersBefore);
      expect((await pg.query("SELECT * FROM players")).rows).toEqual(playersBefore);
    } else await pg.exec(sql);
  }
  db = drizzle(pg, { schema }) as unknown as Database;
  repo = new DrizzleNativeAuthRepository(db);
  identity = new IdentityService(new DrizzleIdentityRepository(db), "test-secret-of-at-least-32-characters");
}, 60_000);
beforeEach(async () => {
  await pg.exec("TRUNCATE users, auth_challenges, auth_rate_limits, google_auth_states CASCADE");
  mailer = new DevelopmentAuthMailer(); service = new NativeAuthService(repo, mailer);
});
afterAll(async () => { await pg?.close(); });

describe("native email credentials on PostgreSQL", () => {
  it("passes the unchanged challenge lifetimes to email presentation", async () => {
    const now = new Date();
    await service.signup({ email, password, displayName: "Player" }, now);
    expect(mailer.messages.at(-1)).toMatchObject({ purpose: "VERIFY_EMAIL", issuedAt: now, expiresAt: new Date(now.getTime() + 60 * 60_000) });
    await service.verify(lastToken(), now);
    await service.forgot(email, now);
    expect(mailer.messages.at(-1)).toMatchObject({ purpose: "RESET_PASSWORD", issuedAt: now, expiresAt: new Date(now.getTime() + 15 * 60_000) });
    const account = await repo.googleAccount("email-presentation-google", "google@example.test", undefined, now);
    await service.requestPassword(account.userId, "session-binding", now);
    expect(mailer.messages.at(-1)).toMatchObject({ purpose: "SET_PASSWORD", issuedAt: now, expiresAt: new Date(now.getTime() + 15 * 60_000) });
  });
  it("keeps signup pending, normalizes email, hashes credentials and tokens, verifies once, and logs in", async () => {
    await service.signup({ email: " Player@Example.Test ", password, displayName: "Player" });
    expect(await db.select().from(schema.users)).toHaveLength(0);
    const [challenge] = await db.select().from(schema.authChallenges);
    expect(challenge.email).toBe(email); expect(challenge.passwordHash).toMatch(/^\$argon2id\$/);
    expect(challenge.tokenHash).toBe(tokenDigest(lastToken())); expect(challenge.tokenHash).not.toBe(lastToken());
    await expect(service.login(email, password)).rejects.toMatchObject({ code: "AUTH_LOGIN_FAILED" });
    const account = await service.verify(lastToken());
    expect((await service.login(" PLAYER@EXAMPLE.TEST ", password)).player.publicPlayerId).toBe(account.player.publicPlayerId);
    await expect(service.verify(lastToken())).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
    expect((await db.select().from(schema.authChallenges))[0].passwordHash).toBeNull();
  });
  it("duplicate signup supersedes pending tokens and cannot overwrite a verified credential", async () => {
    await service.signup({ email, password, displayName: "First" }); const oldToken = lastToken();
    await service.signup({ email, password: newPassword, displayName: "Second" });
    await expect(service.verify(oldToken)).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
    const account = await service.verify(lastToken()); const messages = mailer.messages.length;
    await service.signup({ email, password, displayName: "Overwrite" });
    expect(mailer.messages).toHaveLength(messages);
    expect((await service.login(email, newPassword)).userId).toBe(account.userId);
    await expect(service.login(email, password)).rejects.toMatchObject({ code: "AUTH_LOGIN_FAILED" });
    expect(await db.select().from(schema.users)).toHaveLength(1);
  });
  it.each(["invalid", "expired"])("rejects %s email verification", async (kind) => {
    await service.signup({ email, password, displayName: "Player" });
    await expect(service.verify(kind === "invalid" ? "tampered" : lastToken(), new Date(Date.now() + (kind === "expired" ? 61 * 60_000 : 0)))).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
    expect(await db.select().from(schema.users)).toHaveLength(0);
  });
  it("wrong password and unverified email have generic errors", async () => {
    await verifiedAccount();
    await expect(service.login(email, "wrong")).rejects.toMatchObject({ code: "AUTH_LOGIN_FAILED" });
    await expect(service.login("missing@example.test", password)).rejects.toMatchObject({ code: "AUTH_LOGIN_FAILED" });
  });
  it("forgot password is generic for known/unknown/Google-only email and delivery failure", async () => {
    await verifiedAccount();
    expect(await service.forgot(email)).toEqual(await service.forgot("missing@example.test"));
    const account = await repo.googleAccount("only-google", "google@example.test", undefined, new Date());
    expect(await service.forgot("google@example.test")).toEqual({ ok: true });
    expect((await repo.security(account.userId)).hasPassword).toBe(false);
    const failed = new NativeAuthService(repo, new ResendAuthMailer("test", "test", "https://hub.example.test", async () => { throw new Error("provider secret"); }));
    expect(await failed.forgot(email)).toEqual({ ok: true });
  });
  it("resets password once, revokes old sessions, preserves Player ID", async () => {
    const account = await verifiedAccount(); const session = await identity.createSession(account.userId);
    await service.forgot(email); const token = lastToken();
    const reset = await service.reset(token, newPassword);
    expect(reset.player.publicPlayerId).toBe(account.player.publicPlayerId);
    expect(await identity.getPlayerForToken(session.token)).toBeNull();
    expect((await service.login(email, newPassword)).userId).toBe(account.userId);
    await expect(service.login(email, password)).rejects.toMatchObject({ code: "AUTH_LOGIN_FAILED" });
    await expect(service.reset(token, password)).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
  });
  it.each(["invalid", "expired"])("rejects %s reset token", async (kind) => {
    await verifiedAccount(); await service.forgot(email);
    await expect(service.reset(kind === "invalid" ? "invalid" : lastToken(), newPassword, new Date(Date.now() + (kind === "expired" ? 16 * 60_000 : 0)))).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
    expect((await service.login(email, password)).player.displayName).toBe("Player");
  });
  it("claims a legacy Wix player only after email proof and preserves gameplay rows", async () => {
    const legacy = await identity.resolveVerifiedIdentity({ sourceSite: "CIRCZLES_IN", provider: "WIX", externalIdentityId: "legacy-wix", verifiedEmail: email, emailVerified: true, displayName: "Legacy Player" });
    const [level] = await db.insert(schema.progressionLevels).values({ progressionLevel: 1, rankName: "Peasant", xpRequired: 0 }).returning();
    await db.insert(schema.playerProgression).values({ playerId: legacy.player.internalId, totalXp: 999, progressionLevel: level.progressionLevel, rankName: "Peasant" });
    await service.signup({ email, password, displayName: "Do not rename" });
    expect((await repo.security(legacy.userId)).hasPassword).toBe(false);
    const account = await service.verify(lastToken());
    expect(account.player).toMatchObject({ internalId: legacy.player.internalId, publicPlayerId: legacy.player.publicPlayerId, displayName: "Legacy Player" });
    expect((await db.select().from(schema.playerProgression))[0].totalXp).toBe(999);
    expect(await db.select().from(schema.players)).toHaveLength(1);
    expect(await db.select().from(schema.wixIdentityLinks)).toHaveLength(1);
  });
  it("first password requires the matching live session plus email proof, and Google/password retain one Player ID", async () => {
    const account = await repo.googleAccount("google-sub", email, "Google Player", new Date());
    const session = await identity.createSession(account.userId);
    await service.requestPassword(account.userId, session.token); const token = lastToken();
    await expect(service.setPassword(token, password, account.userId, "another-session")).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
    const result = await service.setPassword(token, password, account.userId, session.token);
    expect(result.player.publicPlayerId).toBe(account.player.publicPlayerId);
    expect((await service.login(email, password)).player.publicPlayerId).toBe(account.player.publicPlayerId);
    expect((await repo.googleAccount("google-sub", email, undefined, new Date())).player.publicPlayerId).toBe(account.player.publicPlayerId);
    await expect(service.requestPassword(account.userId, session.token)).rejects.toMatchObject({ code: "PASSWORD_ALREADY_SET" });
  });
  it("a reset prevents session issuance from a stale successful password check", async () => {
    const account = await verifiedAccount();
    const checked = await service.login(email, password);
    await service.forgot(email); await service.reset(lastToken(), newPassword);
    await expect(identity.createSession(account.userId, new Date(), checked.passwordCredentialHash)).rejects.toMatchObject({ code: "AUTH_LOGIN_FAILED" });
    const fresh = await service.login(email, newPassword);
    const session = await identity.createSession(account.userId, new Date(), fresh.passwordCredentialHash);
    expect((await identity.getPlayerForToken(session.token))?.publicPlayerId).toBe(account.player.publicPlayerId);
  });
  it("signup cannot bypass the authenticated first-password flow on a Google-only account", async () => {
    // A pending signup that predates Google creation cannot turn into an unauthenticated password claim.
    await service.signup({ email, password, displayName: "Pending" }); const token = lastToken();
    const google = await repo.googleAccount("sub-google", email, "Google Player", new Date());
    await expect(service.verify(token)).rejects.toMatchObject({ code: "PASSWORD_SETUP_REQUIRES_SESSION" });
    const messages = mailer.messages.length;
    await service.signup({ email, password, displayName: "Claim" });
    expect(mailer.messages).toHaveLength(messages);
    expect((await repo.security(google.userId)).hasPassword).toBe(false);
    expect(await db.select().from(schema.players)).toHaveLength(1);
  });
  it("simultaneous consumption permits only one verification and one player", async () => {
    await service.signup({ email, password, displayName: "Player" });
    const results = await Promise.allSettled([service.verify(lastToken()), service.verify(lastToken())]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(schema.players)).toHaveLength(1);
  });
  it("normalizes legacy emails for linking and rejects case-only duplicate users", async () => {
    const [legacy] = await db.insert(schema.users).values({ verifiedEmail: " Player@Example.Test ", emailVerifiedAt: new Date() }).returning();
    await expect(db.insert(schema.users).values({ verifiedEmail: email, emailVerifiedAt: new Date() })).rejects.toBeDefined();
    const account = await repo.googleAccount("sub-case", email, undefined, new Date());
    expect(account.userId).toBe(legacy.userId);
  });
  it("enforces rate limits in PostgreSQL and resets a bucket after expiry", async () => {
    const now = new Date(); await repo.rateLimit("test", 1, now);
    await expect(repo.rateLimit("test", 1, now)).rejects.toMatchObject({ statusCode: 429 });
    await expect(repo.rateLimit("test", 1, new Date(now.getTime() + 16 * 60_000))).resolves.toBeUndefined();
  });
});

describe("direct Google authorization", () => {
  it("starts with PKCE, nonce, hashed server state and exact callback, exchanges code server-side", async () => {
    const flow = await google();
    expect(flow.url.origin).toBe("https://accounts.google.com");
    expect(flow.url.searchParams.get("redirect_uri")).toBe(config.callbackUrl);
    expect(flow.url.searchParams.get("code_challenge_method")).toBe("S256");
    const [stored] = await db.select().from(schema.googleAuthStates);
    expect(stored.stateHash).toBe(tokenDigest(flow.state)); expect(stored.bindingHash).toBe(tokenDigest(flow.start.binding));
    const result = await flow.provider.complete({ state: flow.state, code: "one-use-code" }, flow.start.binding);
    expect(result.account.player.publicPlayerId).toMatch(/^CZ-/);
    const init = vi.mocked(flow.fetcher).mock.calls[0][1]!;
    expect(String(init.body)).toContain("client_secret=google-secret"); expect(String(init.body)).toContain("code_verifier=");
    await expect(flow.provider.complete({ state: flow.state, code: "code" }, flow.start.binding)).rejects.toMatchObject({ code: "GOOGLE_STATE_INVALID" });
  });
  it.each(["tampered", "wrong-browser", "missing-browser", "expired"])("rejects %s state before contacting Google", async (kind) => {
    const flow = await google();
    await expect(flow.provider.complete({ state: kind === "tampered" ? flow.state + "x" : flow.state, code: "code" }, kind === "missing-browser" ? undefined : kind === "wrong-browser" ? "wrong" : flow.start.binding, new Date(Date.now() + (kind === "expired" ? 11 * 60_000 : 0)))).rejects.toMatchObject({ code: "GOOGLE_STATE_INVALID" });
    expect(flow.fetcher).not.toHaveBeenCalled();
  });
  it.each([{ email_verified: false }, { nonce: "wrong" }, { sub: "" }, { azp: "another-client" }])("rejects invalid Google claims %j", async (claims) => {
    const flow = await google(claims);
    await expect(flow.provider.complete({ state: flow.state, code: "code" }, flow.start.binding)).rejects.toMatchObject({ code: "GOOGLE_IDENTITY_INVALID" });
    expect(await db.select().from(schema.users)).toHaveLength(0);
  });
  it("links Google to verified legacy email; subsequent subject login retains identity even when provider email changes", async () => {
    const legacy = await identity.resolveVerifiedIdentity({ sourceSite: "CIRCZLES_COM", provider: "WIX", externalIdentityId: "legacy", verifiedEmail: email, emailVerified: true });
    const flow = await google(); const result = await flow.provider.complete({ state: flow.state, code: "code" }, flow.start.binding);
    expect(result.account.userId).toBe(legacy.userId);
    expect((await repo.googleAccount("google-sub", "changed@example.test", undefined, new Date())).userId).toBe(legacy.userId);
    expect(await db.select().from(schema.users)).toHaveLength(1);
    expect((await db.select().from(schema.authIdentities))[0]).toMatchObject({ provider: "GOOGLE", providerSubject: "google-sub" });
  });
  it("does not link to an unverified email and rejects suspended accounts", async () => {
    const [user] = await db.insert(schema.users).values({ verifiedEmail: email }).returning();
    await expect(repo.googleAccount("google-sub", email, undefined, new Date())).rejects.toMatchObject({ code: "ACCOUNT_UNAVAILABLE" });
    await db.update(schema.users).set({ emailVerifiedAt: new Date(), status: "SUSPENDED" }).where(eq(schema.users.userId, user.userId));
    await expect(repo.googleAccount("google-sub", email, undefined, new Date())).rejects.toMatchObject({ code: "ACCOUNT_UNAVAILABLE" });
    expect(await db.select().from(schema.users)).toHaveLength(1);
  });
  it("prevents duplicate identities during overlapping provider/email resolution", async () => {
    const accounts = await Promise.all([repo.googleAccount("sub1", email, undefined, new Date()), repo.googleAccount("sub1", email, undefined, new Date()), repo.googleAccount("sub2", email, undefined, new Date())]);
    expect(new Set(accounts.map((a) => a.userId)).size).toBe(1);
    expect(await db.select().from(schema.players)).toHaveLength(1);
  });
  it.each(["exchange", "network", "verification", "denied"])("handles %s failure without creating a user", async (kind) => {
    const fetcher = vi.fn(async () => { if (kind === "network") throw new Error("secret"); return new Response("{}", { status: kind === "exchange" ? 400 : 200 }); }) as unknown as typeof fetch;
    const flow = await google({}, fetcher);
    flow.verify.mockRejectedValue(new Error("invalid signature"));
    await expect(flow.provider.complete({ state: flow.state, ...(kind === "denied" ? { error: "access_denied" } : { code: "code" }) }, flow.start.binding)).rejects.toMatchObject({ code: "GOOGLE_AUTH_FAILED" });
    expect(await db.select().from(schema.users)).toHaveLength(0);
  });
  it("verifies signature, audience, issuer and expiry of signed Google ID tokens", async () => {
    const keys = await generateKeyPair("RS256");
    const verifier = createGoogleTokenVerifier(keys.publicKey);
    for (const invalid of ["valid", "signature", "audience", "issuer", "expiry"]) {
      const signing = invalid === "signature" ? await generateKeyPair("RS256") : keys;
      const signed = await new SignJWT({ email, email_verified: true, nonce: "nonce" }).setProtectedHeader({ alg: "RS256" }).setIssuedAt().setSubject("sub").setIssuer(invalid === "issuer" ? "https://evil.test" : "https://accounts.google.com").setAudience(invalid === "audience" ? "evil" : config.clientId).setExpirationTime(invalid === "expiry" ? "0s" : "10m").sign(signing.privateKey);
      if (invalid === "valid") expect((await verifier(signed, config.clientId)).sub).toBe("sub");
      else await expect(verifier(signed, config.clientId)).rejects.toBeDefined();
    }
  });
});

describe("session and redirect safety", () => {
  it("uses hashed, revocable 20-day sessions with daily sliding renewal", async () => {
    const account = await verifiedAccount(); const now = new Date();
    const session = await identity.createSession(account.userId, now);
    expect(session.expiresAt.getTime() - now.getTime()).toBe(20 * 86400_000);
    expect((await db.select().from(schema.authSessions))[0].tokenHash).not.toBe(session.token);
    const renewed = await identity.refreshSession(session.token, new Date(now.getTime() + 86400_000));
    expect(renewed?.renewed).toBe(true); expect(renewed?.expiresAt.getTime()).toBe(now.getTime() + 21 * 86400_000);
    await identity.logout(session.token); expect(await identity.getSessionForToken(session.token)).toBeNull();
  });
  it.each(["//evil.test", "/\\evil.test", "https://evil.test", "/\nevil.test", "/%2f%2fevil.test"])("returnTo stays local for %s", (value) => {
    expect(new URL(safeReturnTo(value), "https://hub.invalid").origin).toBe("https://hub.invalid");
  });
});
