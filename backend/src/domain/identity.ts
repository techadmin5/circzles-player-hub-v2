import type { Database } from "../db/client.js";
import { authSessions, players, users, wixIdentityLinks } from "../db/schema.js";
import { and, eq, gt, isNull } from "drizzle-orm";
import { AppError } from "./errors.js";
import { generatePublicPlayerId } from "./playerId.js";
import { createSessionToken, hashSessionToken } from "./sessions.js";

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

export interface IdentityRepository {
  findByWixMemberId(wixMemberId: string): Promise<{ userId: string; player: PlayerDto } | null>;
  createUserPlayerAndWixLink(input: { wixMemberId: string; displayName: string; publicPlayerId?: string }): Promise<{ userId: string; player: PlayerDto }>;
  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findPlayerBySession(tokenHash: string, now: Date): Promise<PlayerDto | null>;
}

function toPlayerDto(row: typeof players.$inferSelect): PlayerDto {
  return {
    internalId: row.playerId,
    publicPlayerId: row.publicPlayerId,
    displayName: row.displayName,
    avatar: "/brand/avatar.svg",
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

  async findByWixMemberId(wixMemberId: string) {
    const rows = await this.db.select({ userId: users.userId, player: players })
      .from(wixIdentityLinks)
      .innerJoin(users, eq(wixIdentityLinks.userId, users.userId))
      .innerJoin(players, eq(players.userId, users.userId))
      .where(eq(wixIdentityLinks.wixMemberId, wixMemberId))
      .limit(1);
    const found = rows[0];
    return found ? { userId: found.userId, player: toPlayerDto(found.player) } : null;
  }

  async createUserPlayerAndWixLink(input: { wixMemberId: string; displayName: string; publicPlayerId?: string }) {
    return this.db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({}).returning();
      if (!user) throw new AppError("CREATE_USER_FAILED", "Could not create user.", 500);

      let playerRow: typeof players.$inferSelect | undefined;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const publicPlayerId = input.publicPlayerId ?? generatePublicPlayerId();
        try {
          [playerRow] = await tx.insert(players).values({
            userId: user.userId,
            publicPlayerId,
            displayName: input.displayName,
          }).returning();
          break;
        } catch (error) {
          if (input.publicPlayerId || attempt === 4) throw error;
        }
      }

      if (!playerRow) throw new AppError("CREATE_PLAYER_FAILED", "Could not create player.", 500);
      await tx.insert(wixIdentityLinks).values({ userId: user.userId, wixMemberId: input.wixMemberId });
      return { userId: user.userId, player: toPlayerDto(playerRow) };
    });
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date) {
    await this.db.insert(authSessions).values({ userId, tokenHash, expiresAt });
  }

  async findPlayerBySession(tokenHash: string, now: Date) {
    const rows = await this.db.select({ player: players })
      .from(authSessions)
      .innerJoin(players, eq(players.userId, authSessions.userId))
      .where(and(eq(authSessions.tokenHash, tokenHash), eq(authSessions.status, "ACTIVE"), gt(authSessions.expiresAt, now), isNull(authSessions.revokedAt)))
      .limit(1);
    return rows[0] ? toPlayerDto(rows[0].player) : null;
  }
}

export class IdentityService {
  constructor(private repo: IdentityRepository, private sessionSecret: string) {}

  async findOrCreateWixIdentity(input: { wixMemberId: string; displayName?: string; publicPlayerId?: string }) {
    const existing = await this.repo.findByWixMemberId(input.wixMemberId);
    if (existing) return existing;
    return this.repo.createUserPlayerAndWixLink({
      wixMemberId: input.wixMemberId,
      displayName: input.displayName ?? "CircZles Player",
      publicPlayerId: input.publicPlayerId,
    });
  }

  async createSession(userId: string, now = new Date()) {
    const token = createSessionToken();
    const tokenHash = hashSessionToken(token, this.sessionSecret);
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7);
    await this.repo.createSession(userId, tokenHash, expiresAt);
    return { token, expiresAt };
  }

  async getPlayerForToken(token: string | undefined, now = new Date()) {
    if (!token) return null;
    return this.repo.findPlayerBySession(hashSessionToken(token, this.sessionSecret), now);
  }
}
