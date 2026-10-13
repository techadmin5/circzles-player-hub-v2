import { and, asc, eq, isNull, isNotNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema.js";
import { puzzleCompetitionSettings, puzzles } from "../db/schema.js";
import { AppError, validationFailed } from "./errors.js";
import { managementLock } from "./catalog.js";
import { z } from "zod";

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
  maxLeaderboardTimeMs?: number | null;
}

export interface CompetitionSettingInput {
  puzzleId: string;
  category?: CompetitionCategory;
  displayOrder?: number;
  leaderboardEnabled?: boolean;
  rewardEnabled?: boolean;
  synapseReward?: number;
  xpReward?: number;
  active?: boolean;
  maxLeaderboardTimeMs?: number | null;
}

export const competitionSettingsPatch = z.object({
  category: z.enum(["MAIN_LEVEL", "SIDE_QUEST"]).optional(),
  displayOrder: z.number().int().min(0).max(2147483647).optional(),
  leaderboardEnabled: z.boolean().optional(), rewardEnabled: z.boolean().optional(), active: z.boolean().optional(),
  synapseReward: z.number().int().min(0).max(2147483647).optional(), xpReward: z.number().int().min(0).max(2147483647).optional(),
  maxLeaderboardTimeMs: z.number().int().positive().max(2147483647).nullable().optional(),
}).strict().refine(value => Object.values(value).some(entry => entry !== undefined), "At least one setting is required.");

export interface CompetitionSettingsRepository {
  getByPuzzleId(puzzleId: string): Promise<CompetitionSettingDto | null>;
  listLeaderboardEnabled(): Promise<CompetitionSettingDto[]>;
  upsert(input: CompetitionSettingInput): Promise<CompetitionSettingDto>;
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
    if (input.category !== undefined && input.category !== "MAIN_LEVEL" && input.category !== "SIDE_QUEST") throw validationFailed("Competition category must be MAIN_LEVEL or SIDE_QUEST.");
    if (input.displayOrder !== undefined && (!Number.isInteger(input.displayOrder) || input.displayOrder < 0)) throw validationFailed("Display order must be a non-negative integer.");
    const synapseReward = input.synapseReward ?? 0;
    const xpReward = input.xpReward ?? 0;
    if (!Number.isInteger(synapseReward) || synapseReward < 0) throw validationFailed("Synapse reward must be a non-negative integer.");
    if (!Number.isInteger(xpReward) || xpReward < 0) throw validationFailed("XP reward must be a non-negative integer.");
    const { puzzleId, ...patch } = input;
    const parsed = competitionSettingsPatch.safeParse(patch);
    if (!parsed.success) throw validationFailed("Invalid competition or reward settings.", parsed.error.flatten());
    return this.repo.upsert({ puzzleId, ...Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined)) });
  }
}

export class DrizzleCompetitionSettingsRepository implements CompetitionSettingsRepository {
  constructor(private db: Db) {}

  async getByPuzzleId(puzzleId: string) {
    // Timing-only rows also contain saved flags/rewards; the admin editor must
    // load those values instead of treating an unset category as no settings.
    const [row] = await selectSettings(this.db).where(eq(puzzleCompetitionSettings.puzzleId, puzzleId)).limit(1);
    return row ? toDto(row) : null;
  }

  async listLeaderboardEnabled() {
    const rows = await selectSettings(this.db).where(and(
      eq(puzzleCompetitionSettings.active, true),
      eq(puzzleCompetitionSettings.leaderboardEnabled, true),
      isNotNull(puzzleCompetitionSettings.category),
      eq(puzzles.status, "ACTIVE"),
      isNull(puzzles.deletedAt),
    )).orderBy(
      sql`case ${puzzleCompetitionSettings.category} when 'MAIN_LEVEL' then 0 else 1 end`,
      asc(puzzleCompetitionSettings.displayOrder),
      asc(puzzleCompetitionSettings.puzzleId),
    );
    return rows.map(toDto);
  }

  async upsert(input: CompetitionSettingInput) {
    return this.db.transaction(async (tx) => {
      await managementLock(tx);
      const [puzzle] = await tx.select().from(puzzles).where(eq(puzzles.puzzleId, input.puzzleId)).limit(1).for("key share");
      if (!puzzle) throw new AppError("PUZZLE_NOT_FOUND", "CircZles was not found.", 404);
      if (puzzle.status !== "ACTIVE" || puzzle.deletedAt || Number(puzzle.levelId) <= 0) throw validationFailed("Competition settings require an active playable CircZles.");
      const [previous] = await tx.select().from(puzzleCompetitionSettings).where(eq(puzzleCompetitionSettings.puzzleId, input.puzzleId));
      // Merge inside the shared catalog/review lock: omission never disables settings.
      const merged = { category: previous?.category ?? "MAIN_LEVEL" as CompetitionCategory, displayOrder: previous?.displayOrder ?? 0,
        leaderboardEnabled: previous?.leaderboardEnabled ?? false, rewardEnabled: previous?.rewardEnabled ?? false,
        synapseReward: previous?.synapseReward ?? 0, xpReward: previous?.xpReward ?? 0, active: previous?.active ?? true,
        maxLeaderboardTimeMs: previous?.maxLeaderboardTimeMs ?? null, ...input };
      if (merged.active && (merged.leaderboardEnabled || merged.rewardEnabled) && !merged.maxLeaderboardTimeMs) throw validationFailed("Configure a positive maximum completion time before enabling competition or rewards.");
      const [setting] = await tx.insert(puzzleCompetitionSettings).values(merged).onConflictDoUpdate({
        target: puzzleCompetitionSettings.puzzleId,
        set: { ...merged, updatedAt: new Date() },
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
    category: row.setting.category ?? "MAIN_LEVEL",
    leaderboardEnabled: row.setting.leaderboardEnabled,
    displayOrder: row.setting.displayOrder ?? 0,
    rewardEnabled: row.setting.rewardEnabled,
    synapseReward: row.setting.synapseReward,
    xpReward: row.setting.xpReward,
    active: row.setting.active,
    maxLeaderboardTimeMs: row.setting.maxLeaderboardTimeMs,
  };
}
