import type { IdentityRepository, PlayerDto } from "../src/domain/identity.js";
import { AppError, insufficientPoints } from "../src/domain/errors.js";
import type { GameStateRepository, PlayerGameState, PointChangeInput, ProgressionLevelConfig, XpGrantInput } from "../src/domain/gameState.js";

interface StoredAccount {
  userId: string;
  wixMemberId: string;
  player: PlayerDto;
}

export class FakeGameStateRepository implements GameStateRepository {
  public progressionLevels: ProgressionLevelConfig[] = [];
  public states = new Map<string, { progressionLevel: number; rankName: string; totalXp: number }>();
  public wallets = new Map<string, number>();
  public xpTransactions: Array<{ xpTransactionId: string; playerId: string; amount: number; sourceType: string; totalXpAfter: number; idempotencyKey?: string }> = [];
  public pointTransactions: Array<{ transactionId: string; playerId: string; amount: number; direction: "CREDIT" | "DEBIT"; sourceType: string; balanceAfter: number; idempotencyKey?: string }> = [];

  async seedProgressionLevels(levels: ProgressionLevelConfig[]) {
    for (const level of levels) {
      const existingIndex = this.progressionLevels.findIndex((item) => item.progressionLevel === level.progressionLevel);
      if (existingIndex >= 0) this.progressionLevels[existingIndex] = level;
      else this.progressionLevels.push(level);
    }
    this.progressionLevels.sort((a, b) => a.xpRequired - b.xpRequired);
  }

  async ensurePlayerGameState(playerId: string) {
    const initial = this.firstLevel();
    if (!this.states.has(playerId)) this.states.set(playerId, { progressionLevel: initial.progressionLevel, rankName: initial.rankName, totalXp: 0 });
    if (!this.wallets.has(playerId)) this.wallets.set(playerId, 0);
  }

  async getPlayerGameState(playerId: string) {
    await this.ensurePlayerGameState(playerId);
    return this.state(playerId);
  }

  async grantXp(input: XpGrantInput) {
    await this.ensurePlayerGameState(input.playerId);
    const existing = input.idempotencyKey ? this.xpTransactions.find((transaction) => transaction.playerId === input.playerId && transaction.idempotencyKey === input.idempotencyKey) : undefined;
    if (existing) {
      if (existing.amount !== input.amount || existing.sourceType !== input.sourceType) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different XP operation.", 409);
      return { transactionId: existing.xpTransactionId, idempotent: true, totalXpAfter: existing.totalXpAfter, state: await this.getPlayerGameState(input.playerId) };
    }
    const current = this.states.get(input.playerId);
    if (!current) throw new Error("missing state");
    const totalXpAfter = current.totalXp + input.amount;
    const rank = this.levelForXp(totalXpAfter);
    this.states.set(input.playerId, { progressionLevel: rank.progressionLevel, rankName: rank.rankName, totalXp: totalXpAfter });
    const transaction = { xpTransactionId: `xp-${this.xpTransactions.length + 1}`, playerId: input.playerId, amount: input.amount, sourceType: input.sourceType, totalXpAfter, idempotencyKey: input.idempotencyKey };
    this.xpTransactions.push(transaction);
    return { transactionId: transaction.xpTransactionId, idempotent: false, totalXpAfter, state: await this.getPlayerGameState(input.playerId) };
  }

  async creditPoints(input: PointChangeInput) {
    return this.changePoints(input, "CREDIT");
  }

  async debitPoints(input: PointChangeInput) {
    return this.changePoints(input, "DEBIT");
  }

  private async changePoints(input: PointChangeInput, direction: "CREDIT" | "DEBIT") {
    await this.ensurePlayerGameState(input.playerId);
    const existing = input.idempotencyKey ? this.pointTransactions.find((transaction) => transaction.playerId === input.playerId && transaction.idempotencyKey === input.idempotencyKey) : undefined;
    if (existing) {
      if (existing.direction !== direction || existing.amount !== input.amount || existing.sourceType !== input.sourceType) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different Synapse Point operation.", 409);
      return { transactionId: existing.transactionId, idempotent: true, balanceAfter: existing.balanceAfter };
    }
    const current = this.wallets.get(input.playerId) ?? 0;
    const balanceAfter = direction === "CREDIT" ? current + input.amount : current - input.amount;
    if (balanceAfter < 0) throw insufficientPoints();
    this.wallets.set(input.playerId, balanceAfter);
    const transaction = { transactionId: `pt-${this.pointTransactions.length + 1}`, playerId: input.playerId, amount: input.amount, direction, sourceType: input.sourceType, balanceAfter, idempotencyKey: input.idempotencyKey };
    this.pointTransactions.push(transaction);
    return { transactionId: transaction.transactionId, idempotent: false, balanceAfter };
  }

  private async state(playerId: string): Promise<PlayerGameState> {
    const state = this.states.get(playerId);
    if (!state) throw new Error("missing state");
    const next = this.progressionLevels.find((level) => level.xpRequired > state.totalXp);
    return {
      progressionLevel: state.progressionLevel,
      rankName: state.rankName,
      totalXp: state.totalXp,
      xpNeeded: next?.xpRequired ?? state.totalXp,
      synapsePoints: this.wallets.get(playerId) ?? 0,
    };
  }

  private firstLevel() {
    const level = this.progressionLevels[0];
    if (!level) throw new Error("progression levels not seeded");
    return level;
  }

  private levelForXp(totalXp: number) {
    return this.progressionLevels.reduce((current, level) => (level.xpRequired <= totalXp ? level : current), this.firstLevel());
  }
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
