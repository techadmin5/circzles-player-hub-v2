import type { IdentityRepository, PlayerDto } from "../src/domain/identity.js";

interface StoredAccount {
  userId: string;
  wixMemberId: string;
  player: PlayerDto;
}

interface StoredSession {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export class FakeIdentityRepository implements IdentityRepository {
  public accounts: StoredAccount[] = [];
  public sessions: StoredSession[] = [];
  private next = 1;

  async findByWixMemberId(wixMemberId: string) {
    const account = this.accounts.find((item) => item.wixMemberId === wixMemberId);
    return account ? { userId: account.userId, player: account.player } : null;
  }

  async createUserPlayerAndWixLink(input: { wixMemberId: string; displayName: string; publicPlayerId?: string }) {
    const existing = await this.findByWixMemberId(input.wixMemberId);
    if (existing) return existing;
    const userId = `user-${this.next}`;
    const player: PlayerDto = {
      internalId: `player-${this.next}`,
      publicPlayerId: input.publicPlayerId ?? `CZ-TEST${this.next}`,
      displayName: input.displayName,
      avatar: "/brand/avatar.svg",
      country: "",
      state: "",
      progressionLevel: 1,
      rank: "Peasant",
      xp: 0,
      xpNeeded: 1200,
      synapsePoints: 0,
      streak: 0,
      equippedFrame: "Starter Frame",
      badgeShowcase: [],
    };
    this.next += 1;
    if (this.accounts.some((account) => account.player.publicPlayerId === player.publicPlayerId)) {
      throw new Error("duplicate public player id");
    }
    this.accounts.push({ userId, wixMemberId: input.wixMemberId, player });
    return { userId, player };
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date) {
    this.sessions.push({ userId, tokenHash, expiresAt });
  }

  async findPlayerBySession(tokenHash: string, now: Date) {
    const session = this.sessions.find((item) => item.tokenHash === tokenHash && item.expiresAt > now);
    if (!session) return null;
    return this.accounts.find((item) => item.userId === session.userId)?.player ?? null;
  }
}
