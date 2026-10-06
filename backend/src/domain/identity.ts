import type { Database } from "../db/client.js";
import { authHandoffExchanges, authSessions, players, users, wixIdentityLinks, passwordCredentials } from "../db/schema.js";
import { and, eq, gt, isNull } from "drizzle-orm";
import { AppError } from "./errors.js";
import { generatePublicPlayerId } from "./playerId.js";
import { createSessionToken, hashSessionToken } from "./sessions.js";

export const identitySourceSites = ["CIRCZLES_COM", "CIRCZLES_IN"] as const;
export const identityProviders = ["WIX", "EMAIL", "GOOGLE", "FACEBOOK"] as const;
export type IdentitySourceSite = typeof identitySourceSites[number];
export type IdentityProvider = typeof identityProviders[number];

export interface PlayerDto {
  internalId: string;
  publicPlayerId: string;
  displayName: string;
  avatar: string;
  country: string;
  state: string;
  progressionLevel: number;
  rank: string;
  xp: number;
  xpNeeded: number;
  synapsePoints: number;
  streak: number;
  equippedFrame: string;
  badgeShowcase: string[];
}

export type SessionPlayerDto = Pick<PlayerDto, "internalId" | "publicPlayerId" | "displayName" | "avatar" | "country" | "state">;

export function toSessionPlayerDto(player: PlayerDto): SessionPlayerDto {
  return {
    internalId: player.internalId,
    publicPlayerId: player.publicPlayerId,
    displayName: player.displayName,
    avatar: player.avatar || "/brand/avatar.svg",
    country: player.country,
    state: player.state,
  };
}

export interface VerifiedExternalIdentity {
  sourceSite: IdentitySourceSite;
  provider: IdentityProvider;
  externalIdentityId: string;
  verifiedEmail: string;
  emailVerified: true;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  publicPlayerId?: string;
  handoff?: { tokenIdHash: string; expiresAt: Date };
}

export interface IdentityAccount { userId: string; player: PlayerDto; passwordCredentialHash?: string }
export interface SessionRecord extends IdentityAccount { expiresAt: Date; lastSeenAt: Date }

export interface IdentityRepository {
  resolveVerifiedIdentity(input: VerifiedExternalIdentity, now: Date): Promise<IdentityAccount>;
  createSession(userId: string, tokenHash: string, expiresAt: Date, now: Date, expectedPasswordHash?: string): Promise<void>;
  findSession(tokenHash: string, now: Date): Promise<SessionRecord | null>;
  refreshSession(tokenHash: string, now: Date, expiresAt: Date): Promise<boolean>;
  revokeSession(tokenHash: string, now: Date): Promise<boolean>;
}

function normalizeVerifiedEmail(value: string) {
  return value.trim().toLowerCase();
}

export function toPlayerDto(row: typeof players.$inferSelect, avatarUrl?: string | null): PlayerDto {
  return {
    internalId: row.playerId,
    publicPlayerId: row.publicPlayerId,
    displayName: row.displayName,
    avatar: avatarUrl || "/brand/avatar.svg",
    country: row.country ?? "",
    state: row.state ?? "",
    progressionLevel: 1,
    rank: "Peasant",
    xp: 0,
    xpNeeded: 1200,
    synapsePoints: 0,
    streak: 0,
    equippedFrame: "Starter Frame",
    badgeShowcase: [],
  };
}

export class DrizzleIdentityRepository implements IdentityRepository {
  constructor(private db: Database) {}

  async resolveVerifiedIdentity(input: VerifiedExternalIdentity, now: Date) {
    const verifiedEmail = normalizeVerifiedEmail(input.verifiedEmail);
    return this.db.transaction(async (tx) => {
      let handoffExchangeId: string | undefined;
      if (input.handoff) {
        const [exchange] = await tx.insert(authHandoffExchanges).values({
          tokenIdHash: input.handoff.tokenIdHash,
          sourceSite: input.sourceSite,
          expiresAt: input.handoff.expiresAt,
          consumedAt: now,
        }).onConflictDoNothing().returning({ authHandoffExchangeId: authHandoffExchanges.authHandoffExchangeId });
        if (!exchange) throw new AppError("AUTH_HANDOFF_ALREADY_USED", "This authentication handoff has already been used.", 409);
        handoffExchangeId = exchange.authHandoffExchangeId;
      }

      const [existing] = await tx.select({ user: users, player: players })
        .from(wixIdentityLinks)
        .innerJoin(users, eq(users.userId, wixIdentityLinks.userId))
        .innerJoin(players, eq(players.userId, users.userId))
        .where(and(eq(wixIdentityLinks.sourceSite, input.sourceSite), eq(wixIdentityLinks.wixMemberId, input.externalIdentityId)))
        .limit(1);

      if (existing) {
        if (existing.user.status !== "ACTIVE") throw new AppError("ACCOUNT_UNAVAILABLE", "This account is not available.", 403);
        if (existing.user.verifiedEmail && existing.user.verifiedEmail !== verifiedEmail) {
          throw new AppError("IDENTITY_LINK_CONFLICT", "The verified identity does not match the existing account.", 409);
        }
        const [emailOwner] = await tx.select({ userId: users.userId }).from(users).where(eq(users.verifiedEmail, verifiedEmail)).limit(1);
        if (emailOwner && emailOwner.userId !== existing.user.userId) {
          throw new AppError("IDENTITY_LINK_CONFLICT", "The verified identity is already owned by another account.", 409);
        }
        await tx.update(users).set({
          verifiedEmail,
          emailVerifiedAt: existing.user.emailVerifiedAt ?? now,
          firstName: input.firstName ?? existing.user.firstName,
          lastName: input.lastName ?? existing.user.lastName,
          avatarUrl: input.avatarUrl ?? existing.user.avatarUrl,
          lastLoginAt: now,
          updatedAt: now,
        }).where(eq(users.userId, existing.user.userId));
        await tx.update(wixIdentityLinks).set(identityLinkUpdates(input, verifiedEmail, now))
          .where(and(eq(wixIdentityLinks.sourceSite, input.sourceSite), eq(wixIdentityLinks.wixMemberId, input.externalIdentityId)));
        if (handoffExchangeId) await tx.update(authHandoffExchanges).set({ userId: existing.user.userId }).where(eq(authHandoffExchanges.authHandoffExchangeId, handoffExchangeId));
        return { userId: existing.user.userId, player: toPlayerDto(existing.player, input.avatarUrl ?? existing.user.avatarUrl) };
      }

      let [user] = await tx.select().from(users).where(eq(users.verifiedEmail, verifiedEmail)).limit(1);
      if (user && user.status !== "ACTIVE") throw new AppError("ACCOUNT_UNAVAILABLE", "This account is not available.", 403);
      if (!user) {
        [user] = await tx.insert(users).values({
          verifiedEmail,
          emailVerifiedAt: now,
          firstName: input.firstName,
          lastName: input.lastName,
          avatarUrl: input.avatarUrl,
          lastLoginAt: now,
          updatedAt: now,
        }).onConflictDoNothing().returning();
        if (!user) [user] = await tx.select().from(users).where(eq(users.verifiedEmail, verifiedEmail)).limit(1);
      }
      if (!user || user.status !== "ACTIVE") throw new AppError("IDENTITY_RESOLUTION_FAILED", "The verified identity could not be resolved.", 409);

      let [player] = await tx.select().from(players).where(eq(players.userId, user.userId)).limit(1);
      if (!player) player = await createPlayer(tx, user.userId, input.displayName, input.publicPlayerId);

      const [createdLink] = await tx.insert(wixIdentityLinks).values({
        userId: user.userId,
        sourceSite: input.sourceSite,
        identityProvider: input.provider,
        wixMemberId: input.externalIdentityId,
        verifiedEmail,
        displayName: input.displayName,
        firstName: input.firstName,
        lastName: input.lastName,
        avatarUrl: input.avatarUrl,
        emailVerified: true,
        lastLoginAt: now,
        updatedAt: now,
      }).onConflictDoNothing().returning({ userId: wixIdentityLinks.userId });
      if (!createdLink) {
        const [owner] = await tx.select({ userId: wixIdentityLinks.userId }).from(wixIdentityLinks)
          .where(and(eq(wixIdentityLinks.sourceSite, input.sourceSite), eq(wixIdentityLinks.wixMemberId, input.externalIdentityId))).limit(1);
        if (!owner || owner.userId !== user.userId) throw new AppError("IDENTITY_LINK_CONFLICT", "The external identity is already owned by another account.", 409);
      }

      await tx.update(users).set({ lastLoginAt: now, updatedAt: now }).where(eq(users.userId, user.userId));
      if (handoffExchangeId) await tx.update(authHandoffExchanges).set({ userId: user.userId }).where(eq(authHandoffExchanges.authHandoffExchangeId, handoffExchangeId));
      return { userId: user.userId, player: toPlayerDto(player, input.avatarUrl ?? user.avatarUrl) };
    });
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date, now: Date, expectedPasswordHash?: string) {
    await this.db.transaction(async (tx) => {
      // Serialize session issuance with password reset so a stale password check cannot create a new session after reset.
      const [user] = await tx.select().from(users).where(eq(users.userId, userId)).for("update");
      if (!user || user.status !== "ACTIVE") throw new AppError("ACCOUNT_UNAVAILABLE", "This account is not available.", 403);
      if (expectedPasswordHash) {
        const [credential] = await tx.select().from(passwordCredentials).where(eq(passwordCredentials.userId, userId));
        if (credential?.passwordHash !== expectedPasswordHash) throw new AppError("AUTH_LOGIN_FAILED", "Email or password is incorrect, or email verification is incomplete.", 401);
      }
      await tx.insert(authSessions).values({ userId, tokenHash, expiresAt, lastSeenAt: now, updatedAt: now });
    });
  }

  async findSession(tokenHash: string, now: Date) {
    const [found] = await this.db.select({ session: authSessions, user: users, player: players })
      .from(authSessions)
      .innerJoin(users, eq(users.userId, authSessions.userId))
      .innerJoin(players, eq(players.userId, users.userId))
      .where(and(eq(authSessions.tokenHash, tokenHash), eq(authSessions.status, "ACTIVE"), eq(users.status, "ACTIVE"), gt(authSessions.expiresAt, now), isNull(authSessions.revokedAt)))
      .limit(1);
    return found ? {
      userId: found.user.userId,
      player: toPlayerDto(found.player, found.user.avatarUrl),
      expiresAt: found.session.expiresAt,
      lastSeenAt: found.session.lastSeenAt,
    } : null;
  }

  async refreshSession(tokenHash: string, now: Date, expiresAt: Date) {
    const rows = await this.db.update(authSessions).set({ expiresAt, lastSeenAt: now, updatedAt: now })
      .where(and(eq(authSessions.tokenHash, tokenHash), eq(authSessions.status, "ACTIVE"), gt(authSessions.expiresAt, now), isNull(authSessions.revokedAt)))
      .returning({ sessionId: authSessions.sessionId });
    return rows.length === 1;
  }

  async revokeSession(tokenHash: string, now: Date) {
    const rows = await this.db.update(authSessions).set({ status: "REVOKED", revokedAt: now, updatedAt: now })
      .where(and(eq(authSessions.tokenHash, tokenHash), eq(authSessions.status, "ACTIVE"), isNull(authSessions.revokedAt)))
      .returning({ sessionId: authSessions.sessionId });
    return rows.length === 1;
  }
}

type IdentityTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function createPlayer(tx: IdentityTransaction, userId: string, displayName?: string, requestedPublicPlayerId?: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [player] = await tx.insert(players).values({
      userId,
      publicPlayerId: requestedPublicPlayerId ?? generatePublicPlayerId(),
      displayName: displayName?.trim() || "CircZles Player",
    }).onConflictDoNothing().returning();
    if (player) return player;
    if (requestedPublicPlayerId) break;
    const [existing] = await tx.select().from(players).where(eq(players.userId, userId)).limit(1);
    if (existing) return existing;
  }
  throw new AppError("CREATE_PLAYER_FAILED", "Could not create player.", 500);
}

function identityLinkUpdates(input: VerifiedExternalIdentity, verifiedEmail: string, now: Date) {
  return {
    identityProvider: input.provider,
    verifiedEmail,
    displayName: input.displayName,
    firstName: input.firstName,
    lastName: input.lastName,
    avatarUrl: input.avatarUrl,
    emailVerified: true,
    lastLoginAt: now,
    updatedAt: now,
  };
}

const SESSION_DURATION_MS = 20 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export class IdentityService {
  constructor(private repo: IdentityRepository, private sessionSecret: string) {}

  async resolveVerifiedIdentity(input: VerifiedExternalIdentity, now = new Date()) {
    if (!input.emailVerified) throw new AppError("VERIFIED_EMAIL_REQUIRED", "A server-verified email is required.", 403);
    const verifiedEmail = normalizeVerifiedEmail(input.verifiedEmail);
    if (!verifiedEmail || !verifiedEmail.includes("@")) throw new AppError("VERIFIED_EMAIL_REQUIRED", "A valid server-verified email is required.", 403);
    return this.repo.resolveVerifiedIdentity({ ...input, verifiedEmail }, now);
  }

  async findOrCreateWixIdentity(input: { wixMemberId: string; displayName?: string; publicPlayerId?: string }) {
    return this.resolveVerifiedIdentity({
      sourceSite: "CIRCZLES_COM",
      provider: "WIX",
      externalIdentityId: input.wixMemberId,
      verifiedEmail: `${input.wixMemberId.toLowerCase()}@development.invalid`,
      emailVerified: true,
      displayName: input.displayName,
      publicPlayerId: input.publicPlayerId,
    });
  }

  async createSession(userId: string, now = new Date(), expectedPasswordHash?: string) {
    const token = createSessionToken();
    const tokenHash = hashSessionToken(token, this.sessionSecret);
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
    await this.repo.createSession(userId, tokenHash, expiresAt, now, expectedPasswordHash);
    return { token, expiresAt };
  }

  async getSessionForToken(token: string | undefined, now = new Date()) {
    if (!token) return null;
    return this.repo.findSession(hashSessionToken(token, this.sessionSecret), now);
  }

  async getPlayerForToken(token: string | undefined, now = new Date()) {
    if (!token) return null;
    return (await this.repo.findSession(hashSessionToken(token, this.sessionSecret), now))?.player ?? null;
  }

  async refreshSession(token: string | undefined, now = new Date()) {
    if (!token) return null;
    const tokenHash = hashSessionToken(token, this.sessionSecret);
    const current = await this.repo.findSession(tokenHash, now);
    if (!current) return null;
    if (now.getTime() - current.lastSeenAt.getTime() < SESSION_REFRESH_INTERVAL_MS) {
      return { player: current.player, expiresAt: current.expiresAt, renewed: false };
    }
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
    if (!await this.repo.refreshSession(tokenHash, now, expiresAt)) return null;
    return { player: current.player, expiresAt, renewed: true };
  }

  async logout(token: string | undefined, now = new Date()) {
    if (!token) return false;
    return this.repo.revokeSession(hashSessionToken(token, this.sessionSecret), now);
  }

  hashHandoffTokenId(tokenId: string) {
    return hashSessionToken(`handoff:${tokenId}`, this.sessionSecret);
  }
}
