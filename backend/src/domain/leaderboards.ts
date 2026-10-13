import { and, asc, eq, isNull, inArray, gt, lte, or, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { leaderboardEntries, players, puzzleCompetitionSettings, puzzles, submissions } from "../db/schema.js";
import { AppError } from "./errors.js";
import type { GameStateTransaction } from "./gameState.js";

export type LeaderboardCategory = "MAIN_LEVEL" | "SIDE_QUEST";

export interface LeaderboardPuzzleDto {
  puzzleId: string;
  puzzleName: string;
  runCode?: string;
  levelId: number;
  category: LeaderboardCategory;
}

export interface LeaderboardCatalogDto {
  mainLevels: Array<LeaderboardPuzzleDto & { displayOrder: number }>;
  sideQuests: Array<LeaderboardPuzzleDto & { displayOrder: number }>;
}

export interface LeaderboardRowDto {
  rank: number;
  publicPlayerId: string;
  displayName: string;
  bestTimeMs: number;
  bestTime: string;
  isCurrentPlayer: boolean;
}

export interface LeaderboardDto {
  puzzle: LeaderboardPuzzleDto;
  entries: LeaderboardRowDto[];
  currentPlayerEntry: LeaderboardRowDto | null;
}

export interface LeaderboardRepository {
  getCatalog(): Promise<LeaderboardCatalogDto>;
  getLeaderboard(puzzleId: string, currentPlayerId: string): Promise<LeaderboardDto>;
}

export class LeaderboardService {
  constructor(private repo: LeaderboardRepository) {}
  getCatalog() { return this.repo.getCatalog(); }
  getLeaderboard(puzzleId: string, currentPlayerId: string) { return this.repo.getLeaderboard(puzzleId, currentPlayerId); }
}

export class DrizzleLeaderboardRepository implements LeaderboardRepository {
  constructor(private db: Database) {}

  async getCatalog() {
    const rows = await visiblePuzzleQuery(this.db).where(visiblePuzzleConditions()).orderBy(
      sql`case ${puzzleCompetitionSettings.category} when 'MAIN_LEVEL' then 0 else 1 end`,
      asc(puzzleCompetitionSettings.displayOrder),
      asc(puzzles.puzzleId),
    );
    const items = rows.map((row) => ({ ...puzzleDto(row), displayOrder: row.setting.displayOrder! }));
    return {
      mainLevels: items.filter((item) => item.category === "MAIN_LEVEL"),
      sideQuests: items.filter((item) => item.category === "SIDE_QUEST"),
    };
  }

  async getLeaderboard(puzzleId: string, currentPlayerId: string) {
    const [visible] = await visiblePuzzleQuery(this.db).where(and(
      visiblePuzzleConditions(),
      eq(puzzles.puzzleId, puzzleId),
    )).limit(1);
    if (!visible) throw new AppError("LEADERBOARD_NOT_FOUND", "Leaderboard was not found.", 404);

    const ranked = rankedLeaderboardQuery(this.db, [puzzleId]);
    const rows = await this.db.select().from(ranked).where(or(lte(ranked.rank, 10), eq(ranked.playerId, currentPlayerId))).orderBy(asc(ranked.rank));
    const entries = rows.filter(row => row.rank <= 10).map(row => rankedRowDto(row, currentPlayerId));
    const current = rows.find(row => row.playerId === currentPlayerId && row.rank > 10);
    return { puzzle: puzzleDto(visible), entries, currentPlayerEntry: current ? rankedRowDto(current, currentPlayerId) : null };
  }
}

export async function processPersonalBestInTransaction(tx: GameStateTransaction, input: {
  playerId: string;
  puzzleId: string;
  submissionId: string;
  completionTimeMs: number;
  approvedAt: Date;
  submittedAt: Date;
}) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.playerId}:${input.puzzleId}`}, 0))`);
  const [previous] = await tx.select().from(leaderboardEntries).where(and(eq(leaderboardEntries.playerId, input.playerId), eq(leaderboardEntries.puzzleId, input.puzzleId))).limit(1).for("update");
  const changed = await tx.insert(leaderboardEntries).values({
    playerId: input.playerId,
    puzzleId: input.puzzleId,
    bestSubmissionId: input.submissionId,
    bestCompletionTimeMs: input.completionTimeMs,
    bestApprovedAt: input.approvedAt,
    bestSubmittedAt: input.submittedAt,
  }).onConflictDoUpdate({
    target: [leaderboardEntries.playerId, leaderboardEntries.puzzleId],
    set: {
      bestSubmissionId: input.submissionId,
      bestCompletionTimeMs: input.completionTimeMs,
      bestApprovedAt: input.approvedAt,
      bestSubmittedAt: input.submittedAt,
      updatedAt: new Date(),
    },
    setWhere: sql`(excluded.best_completion_time_ms, excluded.best_approved_at, excluded.best_submitted_at, excluded.best_submission_id) < (${leaderboardEntries.bestCompletionTimeMs}, ${leaderboardEntries.bestApprovedAt}, ${leaderboardEntries.bestSubmittedAt}, ${leaderboardEntries.bestSubmissionId})`,
  }).returning({ bestCompletionTimeMs: leaderboardEntries.bestCompletionTimeMs });
  return { improved: changed.length > 0, previousBestTimeMs: previous?.bestCompletionTimeMs ?? null, newBestTimeMs: input.completionTimeMs };
}

export function formatLeaderboardTime(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

// Shared by the board page and batched ownership rankings. Filter puzzle IDs
// before the window, and current player AFTER it so rank includes every player.
export function rankedLeaderboardQuery(db: Pick<Database, "select">, puzzleIds: string[]) {
  return db.select({ puzzleId: leaderboardEntries.puzzleId, playerId: leaderboardEntries.playerId,
    publicPlayerId: players.publicPlayerId, displayName: players.displayName, bestTimeMs: leaderboardEntries.bestCompletionTimeMs,
    rank: sql<number>`row_number() over (partition by ${leaderboardEntries.puzzleId} order by ${leaderboardEntries.bestCompletionTimeMs}, ${leaderboardEntries.bestApprovedAt}, ${leaderboardEntries.bestSubmittedAt}, ${leaderboardEntries.bestSubmissionId})`.mapWith(Number).as("rank"),
  }).from(leaderboardEntries).innerJoin(players, eq(players.playerId, leaderboardEntries.playerId))
    .innerJoin(submissions, and(eq(submissions.submissionId, leaderboardEntries.bestSubmissionId), eq(submissions.playerId, leaderboardEntries.playerId), eq(submissions.puzzleId, leaderboardEntries.puzzleId)))
    .where(and(inArray(leaderboardEntries.puzzleId, puzzleIds), eq(submissions.status, "APPROVED"))).as("ranked_leaderboard");
}
function rankedRowDto(row: { rank: number; publicPlayerId: string; displayName: string; bestTimeMs: number; playerId: string }, currentPlayerId: string): LeaderboardRowDto {
  return { rank: row.rank, publicPlayerId: row.publicPlayerId, displayName: row.displayName, bestTimeMs: row.bestTimeMs, bestTime: formatLeaderboardTime(row.bestTimeMs), isCurrentPlayer: row.playerId === currentPlayerId };
}
export function visiblePuzzleConditions() {
  return and(eq(puzzleCompetitionSettings.active, true), eq(puzzleCompetitionSettings.leaderboardEnabled, true), inArray(puzzleCompetitionSettings.category, ["MAIN_LEVEL", "SIDE_QUEST"]), gt(puzzleCompetitionSettings.maxLeaderboardTimeMs, 0), gt(puzzles.levelId, 0), eq(puzzles.status, "ACTIVE"), isNull(puzzles.deletedAt));
}
function visiblePuzzleQuery(db: Pick<Database, "select">) {
  return db.select({ setting: puzzleCompetitionSettings, puzzle: puzzles }).from(puzzleCompetitionSettings).innerJoin(puzzles, eq(puzzles.puzzleId, puzzleCompetitionSettings.puzzleId));
}
function puzzleDto(row: { setting: typeof puzzleCompetitionSettings.$inferSelect; puzzle: typeof puzzles.$inferSelect }): LeaderboardPuzzleDto {
  return { puzzleId: row.puzzle.puzzleId, puzzleName: row.puzzle.name, runCode: row.puzzle.runCode ?? undefined, levelId: Number(row.puzzle.levelId), category: row.setting.category! };
}
