import { asc, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { playerProgression, pointTransactions, progressionLevels, wallets, xpTransactions } from "../db/schema.js";
import { AppError, insufficientPoints, validationFailed } from "./errors.js";

export interface ProgressionLevelConfig {
  progressionLevel: number;
  rankName: string;
  xpRequired: number;
  rewards: unknown[];
}

export interface PlayerGameState {
  progressionLevel: number;
  rankName: string;
  totalXp: number;
  xpNeeded: number;
  synapsePoints: number;
}

export interface LedgerResult {
  transactionId: string;
  idempotent: boolean;
}

export interface XpGrantResult extends LedgerResult {
  state: PlayerGameState;
  totalXpAfter: number;
}

export interface PointChangeResult extends LedgerResult {
  balanceAfter: number;
}

export interface XpGrantInput {
  playerId: string;
  amount: number;
  reason: string;
  sourceType: string;
  sourceId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface PointChangeInput {
  playerId: string;
  amount: number;
  reason: string;
  sourceType: string;
  sourceId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface GameStateRepository {
  seedProgressionLevels(levels: ProgressionLevelConfig[]): Promise<void>;
  ensurePlayerGameState(playerId: string): Promise<void>;
  getPlayerGameState(playerId: string): Promise<PlayerGameState>;
  grantXp(input: XpGrantInput): Promise<XpGrantResult>;
  creditPoints(input: PointChangeInput): Promise<PointChangeResult>;
  debitPoints(input: PointChangeInput): Promise<PointChangeResult>;
}

export const temporaryDevelopmentProgressionLevels: ProgressionLevelConfig[] = [
  { progressionLevel: 1, rankName: "Peasant", xpRequired: 0, rewards: [] },
  { progressionLevel: 5, rankName: "Farmer", xpRequired: 1200, rewards: [] },
  { progressionLevel: 10, rankName: "Squire", xpRequired: 3600, rewards: [] },
  { progressionLevel: 15, rankName: "Knight", xpRequired: 7600, rewards: [] },
  { progressionLevel: 20, rankName: "Apprentice", xpRequired: 12800, rewards: [] },
  { progressionLevel: 30, rankName: "Nobleman", xpRequired: 24000, rewards: [] },
  { progressionLevel: 40, rankName: "Master", xpRequired: 42000, rewards: [] },
  { progressionLevel: 55, rankName: "Hero", xpRequired: 72000, rewards: [] },
  { progressionLevel: 75, rankName: "Conqueror", xpRequired: 120000, rewards: [] },
];

export class GameStateService {
  constructor(private repo: GameStateRepository) {}

  seedProgressionLevels(levels = temporaryDevelopmentProgressionLevels) {
    return this.repo.seedProgressionLevels(levels);
  }

  ensurePlayerGameState(playerId: string) {
    return this.repo.ensurePlayerGameState(playerId);
  }

  async getPlayerGameState(playerId: string) {
    await this.repo.ensurePlayerGameState(playerId);
    return this.repo.getPlayerGameState(playerId);
  }

  grantXp(input: XpGrantInput) {
    validatePositiveAmount(input.amount, "XP amount must be greater than zero.");
    validateReason(input.reason);
    return this.repo.grantXp(input);
  }

  creditPoints(input: PointChangeInput) {
    validatePositiveAmount(input.amount, "Synapse Point amount must be greater than zero.");
    validateReason(input.reason);
    return this.repo.creditPoints(input);
  }

  debitPoints(input: PointChangeInput) {
    validatePositiveAmount(input.amount, "Synapse Point amount must be greater than zero.");
    validateReason(input.reason);
    return this.repo.debitPoints(input);
  }
}

export class DrizzleGameStateRepository implements GameStateRepository {
  constructor(private db: Database) {}

  async seedProgressionLevels(levels: ProgressionLevelConfig[]) {
    await this.db.transaction(async (tx) => {
      for (const level of levels) {
        await tx.insert(progressionLevels).values({
          progressionLevel: level.progressionLevel,
          rankName: level.rankName,
          xpRequired: level.xpRequired,
          rewards: level.rewards,
        }).onConflictDoUpdate({
          target: progressionLevels.progressionLevel,
          set: {
            rankName: level.rankName,
            xpRequired: level.xpRequired,
            rewards: level.rewards,
            active: true,
            updatedAt: new Date(),
          },
        });
      }
    });
  }

  async ensurePlayerGameState(playerId: string) {
    await this.db.transaction(async (tx) => {
      const initial = await firstActiveLevel(tx);
      await tx.insert(wallets).values({ playerId }).onConflictDoNothing({ target: wallets.playerId });
      await tx.insert(playerProgression).values({
        playerId,
        totalXp: 0,
        progressionLevel: initial.progressionLevel,
        rankName: initial.rankName,
      }).onConflictDoNothing({ target: playerProgression.playerId });
    });
  }

  async getPlayerGameState(playerId: string) {
    await this.ensurePlayerGameState(playerId);
    return this.db.transaction(async (tx) => readGameState(tx, playerId));
  }

  async grantXp(input: XpGrantInput) {
    return this.db.transaction(async (tx) => {
      await ensurePlayerGameStateInTransaction(tx, input.playerId);
      if (input.idempotencyKey) {
        const existing = await tx.select().from(xpTransactions).where(eq(xpTransactions.idempotencyKey, input.idempotencyKey)).limit(1);
        if (existing[0]) return { transactionId: existing[0].xpTransactionId, idempotent: true, totalXpAfter: existing[0].totalXpAfter, state: await readGameState(tx, input.playerId, existing[0].totalXpAfter) };
      }

      await lockPlayerProgression(tx, input.playerId);
      const current = await readProgressionCache(tx, input.playerId);
      const totalXpAfter = current.totalXp + input.amount;
      const rank = await levelForXp(tx, totalXpAfter);
      const [transaction] = await tx.insert(xpTransactions).values({
        playerId: input.playerId,
        amount: input.amount,
        reason: input.reason,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        totalXpAfter,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
      }).returning();
      if (!transaction) throw new AppError("XP_TRANSACTION_FAILED", "Could not record XP transaction.", 500);

      await tx.update(playerProgression).set({
        totalXp: totalXpAfter,
        progressionLevel: rank.progressionLevel,
        rankName: rank.rankName,
        updatedAt: new Date(),
      }).where(eq(playerProgression.playerId, input.playerId));

      return { transactionId: transaction.xpTransactionId, idempotent: false, totalXpAfter, state: await readGameState(tx, input.playerId, totalXpAfter) };
    });
  }

  async creditPoints(input: PointChangeInput) {
    return this.changePoints(input, "CREDIT");
  }

  async debitPoints(input: PointChangeInput) {
    return this.changePoints(input, "DEBIT");
  }

  private async changePoints(input: PointChangeInput, direction: "CREDIT" | "DEBIT") {
    return this.db.transaction(async (tx) => {
      await ensurePlayerGameStateInTransaction(tx, input.playerId);
      if (input.idempotencyKey) {
        const existing = await tx.select().from(pointTransactions).where(eq(pointTransactions.idempotencyKey, input.idempotencyKey)).limit(1);
        if (existing[0]) return { transactionId: existing[0].transactionId, idempotent: true, balanceAfter: existing[0].balanceAfter };
      }

      await lockWallet(tx, input.playerId);
      const wallet = await readWallet(tx, input.playerId);
      const balanceAfter = direction === "CREDIT" ? wallet.balance + input.amount : wallet.balance - input.amount;
      if (balanceAfter < 0) throw insufficientPoints();
      const [transaction] = await tx.insert(pointTransactions).values({
        playerId: input.playerId,
        amount: input.amount,
        direction,
        reason: input.reason,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        balanceAfter,
        metadata: input.metadata ?? {},
        idempotencyKey: input.idempotencyKey,
      }).returning();
      if (!transaction) throw new AppError("POINT_TRANSACTION_FAILED", "Could not record point transaction.", 500);
      await tx.update(wallets).set({ balance: balanceAfter, updatedAt: new Date() }).where(eq(wallets.playerId, input.playerId));
      return { transactionId: transaction.transactionId, idempotent: false, balanceAfter };
    });
  }
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function ensurePlayerGameStateInTransaction(tx: Transaction, playerId: string) {
  const initial = await firstActiveLevel(tx);
  await tx.insert(wallets).values({ playerId }).onConflictDoNothing({ target: wallets.playerId });
  await tx.insert(playerProgression).values({
    playerId,
    totalXp: 0,
    progressionLevel: initial.progressionLevel,
    rankName: initial.rankName,
  }).onConflictDoNothing({ target: playerProgression.playerId });
}

async function firstActiveLevel(tx: Transaction) {
  const rows = await tx.select().from(progressionLevels).where(eq(progressionLevels.active, true)).orderBy(asc(progressionLevels.xpRequired)).limit(1);
  const level = rows[0];
  if (!level) throw new AppError("PROGRESSION_NOT_CONFIGURED", "Progression levels are not configured.", 500);
  return level;
}

async function levelForXp(tx: Transaction, totalXp: number) {
  const rows = await tx.select().from(progressionLevels)
    .where(sql`${progressionLevels.active} = true and ${progressionLevels.xpRequired} <= ${totalXp}`)
    .orderBy(desc(progressionLevels.xpRequired))
    .limit(1);
  return rows[0] ?? firstActiveLevel(tx);
}

async function nextXpThreshold(tx: Transaction, totalXp: number) {
  const rows = await tx.select().from(progressionLevels)
    .where(sql`${progressionLevels.active} = true and ${progressionLevels.xpRequired} > ${totalXp}`)
    .orderBy(asc(progressionLevels.xpRequired))
    .limit(1);
  return rows[0]?.xpRequired ?? totalXp;
}

async function readGameState(tx: Transaction, playerId: string, totalXpOverride?: number): Promise<PlayerGameState> {
  const progression = await readProgressionCache(tx, playerId);
  const wallet = await readWallet(tx, playerId);
  const totalXp = totalXpOverride ?? progression.totalXp;
  return {
    progressionLevel: progression.progressionLevel,
    rankName: progression.rankName,
    totalXp,
    xpNeeded: await nextXpThreshold(tx, totalXp),
    synapsePoints: wallet.balance,
  };
}

async function readProgressionCache(tx: Transaction, playerId: string) {
  const rows = await tx.select().from(playerProgression).where(eq(playerProgression.playerId, playerId)).limit(1);
  const row = rows[0];
  if (!row) throw new AppError("PLAYER_PROGRESSION_NOT_FOUND", "Player progression state was not initialized.", 500);
  return row;
}

async function readWallet(tx: Transaction, playerId: string) {
  const rows = await tx.select().from(wallets).where(eq(wallets.playerId, playerId)).limit(1);
  const row = rows[0];
  if (!row) throw new AppError("WALLET_NOT_FOUND", "Player wallet was not initialized.", 500);
  return row;
}

async function lockPlayerProgression(tx: Transaction, playerId: string) {
  await tx.execute(sql`select player_progression_id from ${playerProgression} where ${playerProgression.playerId} = ${playerId} for update`);
}

async function lockWallet(tx: Transaction, playerId: string) {
  await tx.execute(sql`select wallet_id from ${wallets} where ${wallets.playerId} = ${playerId} for update`);
}

function validatePositiveAmount(amount: number, message: string) {
  if (!Number.isInteger(amount) || amount <= 0) throw validationFailed(message, { amount });
}

function validateReason(reason: string) {
  if (!reason.trim()) throw validationFailed("Reason is required.");
}
