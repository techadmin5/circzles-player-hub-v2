import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema.js";
import { puzzleCompetitionSettings, puzzles } from "../db/schema.js";
import { AppError, validationFailed } from "./errors.js";

type Db = NodePgDatabase<typeof schema>;
export type CompetitionCategory = "MAIN_LEVEL" | "SIDE_QUEST";

export interface CompetitionSettingDto {
  id: string;
  puzzleId: string;
  puzzleName: string;
  levelId: number;
  category: CompetitionCategory;
  leaderboardEnabled: boolean;
  displayOrder: number;
  rewardEnabled: boolean;
  synapseReward: number;
  xpReward: number;
  active: boolean;
}

export interface CompetitionSettingInput {
  puzzleId: string;
  category: CompetitionCategory;
  displayOrder: number;
  leaderboardEnabled?: boolean;
  rewardEnabled?: boolean;
  synapseReward?: number;
  xpReward?: number;
  active?: boolean;
}

export interface CompetitionSettingsRepository {
  getByPuzzleId(puzzleId: string): Promise<CompetitionSettingDto | null>;
  listLeaderboardEnabled(): Promise<CompetitionSettingDto[]>;
  upsert(input: Required<CompetitionSettingInput>): Promise<CompetitionSettingDto>;
}

export const mainLevelRewardPreset = [
  { levelId: 1, synapseReward: 300, xpReward: 350 },
  { levelId: 2, synapseReward: 450, xpReward: 500 },
  { levelId: 3, synapseReward: 650, xpReward: 750 },
  { levelId: 4, synapseReward: 900, xpReward: 1050 },
  { levelId: 5, synapseReward: 1250, xpReward: 1500 },
  { levelId: 6, synapseReward: 1700, xpReward: 2100 },
  { levelId: 7, synapseReward: 2250, xpReward: 2850 },
  { levelId: 8, synapseReward: 3000, xpReward: 3800 },
  { levelId: 9, synapseReward: 3900, xpReward: 5200 },
  { levelId: 10, synapseReward: 5000, xpReward: 7000 },
] as const;

export class CompetitionSettingsService {
  constructor(private repo: CompetitionSettingsRepository) {}

  getByPuzzleId(puzzleId: string) { return this.repo.getByPuzzleId(puzzleId); }
  listLeaderboardEnabled() { return this.repo.listLeaderboardEnabled(); }

  upsert(input: CompetitionSettingInput) {
    if (input.category !== "MAIN_LEVEL" && input.category !== "SIDE_QUEST") throw validationFailed("Competition category must be MAIN_LEVEL or SIDE_QUEST.");
    if (!Number.isInteger(input.displayOrder) || input.displayOrder < 0) throw validationFailed("Display order must be a non-negative integer.");
    const synapseReward = input.synapseReward ?? 0;
    const xpReward = input.xpReward ?? 0;
    if (!Number.isInteger(synapseReward) || synapseReward < 0) throw validationFailed("Synapse reward must be a non-negative integer.");
    if (!Number.isInteger(xpReward) || xpReward < 0) throw validationFailed("XP reward must be a non-negative integer.");
    return this.repo.upsert({
      ...input,
      leaderboardEnabled: input.leaderboardEnabled ?? false,
      rewardEnabled: input.rewardEnabled ?? false,
      synapseReward,
      xpReward,
      active: input.active ?? true,
    });
  }
}

export class DrizzleCompetitionSettingsRepository implements CompetitionSettingsRepository {
  constructor(private db: Db) {}

  async getByPuzzleId(puzzleId: string) {
    const [row] = await selectSettings(this.db).where(eq(puzzleCompetitionSettings.puzzleId, puzzleId)).limit(1);
    return row ? toDto(row) : null;
  }

  async listLeaderboardEnabled() {
    const rows = await selectSettings(this.db).where(and(
      eq(puzzleCompetitionSettings.active, true),
      eq(puzzleCompetitionSettings.leaderboardEnabled, true),
      eq(puzzles.status, "ACTIVE"),
      isNull(puzzles.deletedAt),
    )).orderBy(
      sql`case ${puzzleCompetitionSettings.category} when 'MAIN_LEVEL' then 0 else 1 end`,
      asc(puzzleCompetitionSettings.displayOrder),
      asc(puzzleCompetitionSettings.puzzleId),
    );
    return rows.map(toDto);
  }

  async upsert(input: Required<CompetitionSettingInput>) {
    return this.db.transaction(async (tx) => {
      const [puzzle] = await tx.select().from(puzzles).where(eq(puzzles.puzzleId, input.puzzleId)).limit(1).for("key share");
      if (!puzzle) throw new AppError("PUZZLE_NOT_FOUND", "CircZles was not found.", 404);

      const [setting] = await tx.insert(puzzleCompetitionSettings).values(input).onConflictDoUpdate({
        target: puzzleCompetitionSettings.puzzleId,
        set: { category: input.category, leaderboardEnabled: input.leaderboardEnabled, displayOrder: input.displayOrder, rewardEnabled: input.rewardEnabled, synapseReward: input.synapseReward, xpReward: input.xpReward, active: input.active, updatedAt: new Date() },
      }).returning();
      return toDto({ setting, puzzle });
    });
  }
}

export function assertValidLevelId(levelId: number) {
  const scaled = levelId * 10;
  if (!Number.isFinite(levelId) || levelId <= 0 || levelId > 999.9 || Math.abs(scaled - Math.round(scaled)) > Number.EPSILON * 10) {
    throw validationFailed("levelId must be greater than zero with at most one decimal place.");
  }
  return levelId;
}

function selectSettings(db: Pick<Db, "select">) {
  return db.select({ setting: puzzleCompetitionSettings, puzzle: puzzles }).from(puzzleCompetitionSettings).innerJoin(puzzles, eq(puzzleCompetitionSettings.puzzleId, puzzles.puzzleId));
}

function toDto(row: { setting: typeof puzzleCompetitionSettings.$inferSelect; puzzle: typeof puzzles.$inferSelect }): CompetitionSettingDto {
  return {
    id: row.setting.puzzleCompetitionSettingId,
    puzzleId: row.setting.puzzleId,
    puzzleName: row.puzzle.name,
    levelId: Number(row.puzzle.levelId),
    category: row.setting.category,
    leaderboardEnabled: row.setting.leaderboardEnabled,
    displayOrder: row.setting.displayOrder,
    rewardEnabled: row.setting.rewardEnabled,
    synapseReward: row.setting.synapseReward,
    xpReward: row.setting.xpReward,
    active: row.setting.active,
  };
}
