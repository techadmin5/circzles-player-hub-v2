import { describe, expect, it } from "vitest";
import { AppError } from "../src/domain/errors.js";
import { formatLeaderboardTime, LeaderboardService, type LeaderboardCatalogDto, type LeaderboardDto, type LeaderboardRepository } from "../src/domain/leaderboards.js";

interface PuzzleFixture { puzzleId: string; puzzleName: string; runCode?: string; levelId: number; category: "MAIN_LEVEL" | "SIDE_QUEST"; displayOrder: number; settingActive: boolean; leaderboardEnabled: boolean; puzzleActive: boolean; deleted: boolean }
interface EntryFixture { playerId: string; publicPlayerId: string; displayName: string; time: number; approvedAt: string; submittedAt: string; submissionId: string }

class InMemoryLeaderboardRepository implements LeaderboardRepository {
  puzzles: PuzzleFixture[] = [];
  entries = new Map<string, EntryFixture[]>();

  async getCatalog(): Promise<LeaderboardCatalogDto> {
    const visible = this.puzzles.filter(isVisible).sort((a, b) => (a.category === b.category ? a.displayOrder - b.displayOrder || a.puzzleId.localeCompare(b.puzzleId) : a.category === "MAIN_LEVEL" ? -1 : 1));
    const map = (item: PuzzleFixture) => ({ puzzleId: item.puzzleId, puzzleName: item.puzzleName, runCode: item.runCode, levelId: item.levelId, category: item.category, displayOrder: item.displayOrder });
    return { mainLevels: visible.filter((item) => item.category === "MAIN_LEVEL").map(map), sideQuests: visible.filter((item) => item.category === "SIDE_QUEST").map(map) };
  }

  async getLeaderboard(puzzleId: string, currentPlayerId: string): Promise<LeaderboardDto> {
    const puzzle = this.puzzles.find((item) => item.puzzleId === puzzleId && isVisible(item));
    if (!puzzle) throw new AppError("LEADERBOARD_NOT_FOUND", "Leaderboard was not found.", 404);
    const ranked = [...(this.entries.get(puzzleId) ?? [])].sort(compareEntries).map((entry, index) => ({ rank: index + 1, publicPlayerId: entry.publicPlayerId, displayName: entry.displayName, bestTimeMs: entry.time, bestTime: formatLeaderboardTime(entry.time), isCurrentPlayer: entry.playerId === currentPlayerId, playerId: entry.playerId }));
    const top = ranked.slice(0, 10);
    const current = ranked.find((entry) => entry.playerId === currentPlayerId);
    const safe = (entry: typeof ranked[number]) => ({ rank: entry.rank, publicPlayerId: entry.publicPlayerId, displayName: entry.displayName, bestTimeMs: entry.bestTimeMs, bestTime: entry.bestTime, isCurrentPlayer: entry.isCurrentPlayer });
    return { puzzle: { puzzleId, puzzleName: puzzle.puzzleName, runCode: puzzle.runCode, levelId: puzzle.levelId, category: puzzle.category }, entries: top.map(safe), currentPlayerEntry: current && current.rank > 10 ? safe(current) : null };
  }
}

function isVisible(puzzle: PuzzleFixture) { return puzzle.settingActive && puzzle.leaderboardEnabled && puzzle.puzzleActive && !puzzle.deleted; }
function compareEntries(a: EntryFixture, b: EntryFixture) { return a.time - b.time || a.approvedAt.localeCompare(b.approvedAt) || a.submittedAt.localeCompare(b.submittedAt) || a.submissionId.localeCompare(b.submissionId); }
function puzzle(overrides: Partial<PuzzleFixture> = {}): PuzzleFixture { return { puzzleId: "puzzle-1", puzzleName: "Metamorphosis", runCode: "R1", levelId: 1, category: "MAIN_LEVEL", displayOrder: 1, settingActive: true, leaderboardEnabled: true, puzzleActive: true, deleted: false, ...overrides }; }
function entry(index: number, overrides: Partial<EntryFixture> = {}): EntryFixture { return { playerId: `player-${index}`, publicPlayerId: `CZ-${index}`, displayName: `Player ${index}`, time: 60_000 + index, approvedAt: `2026-09-08T00:00:${String(index).padStart(2, "0")}.000Z`, submittedAt: "2026-09-07T00:00:00.000Z", submissionId: `submission-${String(index).padStart(2, "0")}`, ...overrides }; }

describe("leaderboard ranking and catalog", () => {
  it("formats exact milliseconds deterministically", () => expect(formatLeaderboardTime(78_420)).toBe("01:18.420"));

  it("returns only top 10 with server ranks and exact deterministic ordering", async () => {
    const repo = new InMemoryLeaderboardRepository(); repo.puzzles.push(puzzle()); repo.entries.set("puzzle-1", Array.from({ length: 15 }, (_, i) => entry(15 - i)));
    const board = await new LeaderboardService(repo).getLeaderboard("puzzle-1", "unsolved");
    expect(board.entries).toHaveLength(10); expect(board.entries.map((item) => item.rank)).toEqual([1,2,3,4,5,6,7,8,9,10]); expect(board.entries[0].publicPlayerId).toBe("CZ-1");
  });

  it("uses approved, submitted, then submission identity to break exact-time ties", async () => {
    const repo = new InMemoryLeaderboardRepository(); repo.puzzles.push(puzzle());
    repo.entries.set("puzzle-1", [entry(1, { time: 78_420, approvedAt: "2026-01-02T00:00:00Z" }), entry(2, { time: 78_420, approvedAt: "2026-01-01T00:00:00Z", submittedAt: "2026-01-02T00:00:00Z" }), entry(3, { time: 78_420, approvedAt: "2026-01-01T00:00:00Z", submittedAt: "2026-01-01T00:00:00Z", submissionId: "submission-b" }), entry(4, { time: 78_420, approvedAt: "2026-01-01T00:00:00Z", submittedAt: "2026-01-01T00:00:00Z", submissionId: "submission-a" })]);
    const board = await repo.getLeaderboard("puzzle-1", "none");
    expect(board.entries.map((item) => item.publicPlayerId)).toEqual(["CZ-4", "CZ-3", "CZ-2", "CZ-1"]);
  });

  it("flags a top-10 current player without duplicating the personal row", async () => {
    const repo = new InMemoryLeaderboardRepository(); repo.puzzles.push(puzzle()); repo.entries.set("puzzle-1", [entry(1), entry(2)]);
    const board = await repo.getLeaderboard("puzzle-1", "player-2");
    expect(board.entries[1].isCurrentPlayer).toBe(true); expect(board.currentPlayerEntry).toBeNull();
  });

  it("returns the real rank for a current player outside top 10", async () => {
    const repo = new InMemoryLeaderboardRepository(); repo.puzzles.push(puzzle()); repo.entries.set("puzzle-1", Array.from({ length: 15 }, (_, i) => entry(i + 1)));
    const board = await repo.getLeaderboard("puzzle-1", "player-15");
    expect(board.currentPlayerEntry).toMatchObject({ rank: 15, publicPlayerId: "CZ-15", isCurrentPlayer: true });
  });

  it("returns null for unsolved players and handles an empty board", async () => {
    const repo = new InMemoryLeaderboardRepository(); repo.puzzles.push(puzzle());
    expect(await repo.getLeaderboard("puzzle-1", "unsolved")).toMatchObject({ entries: [], currentPlayerEntry: null });
  });

  it("separates and orders visible main levels and fractional side quests", async () => {
    const repo = new InMemoryLeaderboardRepository(); repo.puzzles.push(puzzle({ puzzleId: "main-2", displayOrder: 2 }), puzzle({ puzzleId: "main-1", displayOrder: 1 }), puzzle({ puzzleId: "side", category: "SIDE_QUEST", levelId: 3.5, displayOrder: 1 }));
    const catalog = await repo.getCatalog();
    expect(catalog.mainLevels.map((item) => item.puzzleId)).toEqual(["main-1", "main-2"]); expect(catalog.sideQuests[0]).toMatchObject({ puzzleId: "side", levelId: 3.5 });
  });

  it.each([{ settingActive: false }, { leaderboardEnabled: false }, { puzzleActive: false }, { deleted: true }])("hides unavailable catalog and leaderboard puzzles: %o", async (state) => {
    const repo = new InMemoryLeaderboardRepository(); repo.puzzles.push(puzzle(state));
    expect(await repo.getCatalog()).toEqual({ mainLevels: [], sideQuests: [] });
    await expect(repo.getLeaderboard("puzzle-1", "player-1")).rejects.toMatchObject({ code: "LEADERBOARD_NOT_FOUND" });
  });
});
