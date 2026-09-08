import { describe, expect, it } from "vitest";
import { assertValidLevelId, CompetitionSettingsService, mainLevelRewardPreset, type CompetitionSettingDto, type CompetitionSettingInput, type CompetitionSettingsRepository } from "../src/domain/competitionSettings.js";
import { AppError } from "../src/domain/errors.js";

class FakeCompetitionSettingsRepository implements CompetitionSettingsRepository {
  rows = new Map<string, CompetitionSettingDto>();

  async getByPuzzleId(puzzleId: string) { return this.rows.get(puzzleId) ?? null; }
  async listLeaderboardEnabled() {
    return [...this.rows.values()].filter((row) => row.active && row.leaderboardEnabled).sort((a, b) => {
      const categoryOrder = { MAIN_LEVEL: 0, SIDE_QUEST: 1 } as const;
      return categoryOrder[a.category] - categoryOrder[b.category] || a.displayOrder - b.displayOrder || a.puzzleId.localeCompare(b.puzzleId);
    });
  }
  async upsert(input: Required<CompetitionSettingInput>) {
    if (input.puzzleId === "missing") throw new AppError("PUZZLE_NOT_FOUND", "Puzzle was not found.", 404);
    const existing = this.rows.get(input.puzzleId);
    const row: CompetitionSettingDto = { id: existing?.id ?? `setting-${this.rows.size + 1}`, puzzleId: input.puzzleId, puzzleName: `Puzzle ${input.puzzleId}`, levelId: input.puzzleId === "side" ? 3.5 : 1, category: input.category, leaderboardEnabled: input.leaderboardEnabled, displayOrder: input.displayOrder, rewardEnabled: input.rewardEnabled, synapseReward: input.synapseReward, xpReward: input.xpReward, active: input.active };
    this.rows.set(input.puzzleId, row);
    return row;
  }
}

describe("competition settings", () => {
  it.each([0.5, 3.5, 1, 10, 18, 22])("accepts levelId %s as a JavaScript number", (levelId) => {
    expect(assertValidLevelId(levelId)).toBe(levelId);
    expect(typeof assertValidLevelId(levelId)).toBe("number");
  });

  it.each([0, -0.5, -1])("rejects non-positive levelId %s", (levelId) => {
    expect(() => assertValidLevelId(levelId)).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });

  it.each(["MAIN_LEVEL", "SIDE_QUEST"] as const)("stores explicit %s category", async (category) => {
    const service = new CompetitionSettingsService(new FakeCompetitionSettingsRepository());
    await expect(service.upsert({ puzzleId: category, category, displayOrder: 0 })).resolves.toMatchObject({ category });
  });

  it("keeps one configuration per canonical puzzle and updates it", async () => {
    const repo = new FakeCompetitionSettingsRepository();
    const service = new CompetitionSettingsService(repo);
    const first = await service.upsert({ puzzleId: "puzzle-1", category: "MAIN_LEVEL", displayOrder: 1 });
    const updated = await service.upsert({ puzzleId: "puzzle-1", category: "SIDE_QUEST", displayOrder: 2 });
    expect(repo.rows.size).toBe(1);
    expect(updated.id).toBe(first.id);
    expect(updated.category).toBe("SIDE_QUEST");
  });

  it("rejects a nonexistent canonical puzzle with controlled PUZZLE_NOT_FOUND", async () => {
    const repo = new FakeCompetitionSettingsRepository();
    const service = new CompetitionSettingsService(repo);
    await expect(service.upsert({ puzzleId: "missing", category: "MAIN_LEVEL", displayOrder: 0 })).rejects.toMatchObject({ code: "PUZZLE_NOT_FOUND", statusCode: 404 });
    expect(repo.rows.size).toBe(0);
  });

  it.each([
    [{ puzzleId: "p", category: "MAIN_LEVEL", displayOrder: -1 }, "Display order"],
    [{ puzzleId: "p", category: "MAIN_LEVEL", displayOrder: 0, synapseReward: -1 }, "Synapse reward"],
    [{ puzzleId: "p", category: "MAIN_LEVEL", displayOrder: 0, xpReward: -1 }, "XP reward"],
  ] as const)("rejects invalid non-negative configuration %#", (input, message) => {
    const service = new CompetitionSettingsService(new FakeCompetitionSettingsRepository());
    expect(() => service.upsert(input)).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED", message: expect.stringContaining(message) }));
  });

  it("uses disabled leaderboard and reward defaults", async () => {
    const service = new CompetitionSettingsService(new FakeCompetitionSettingsRepository());
    await expect(service.upsert({ puzzleId: "p", category: "MAIN_LEVEL", displayOrder: 0 })).resolves.toMatchObject({ leaderboardEnabled: false, rewardEnabled: false, synapseReward: 0, xpReward: 0, active: true });
  });

  it("orders enabled settings by explicit category and display order", async () => {
    const service = new CompetitionSettingsService(new FakeCompetitionSettingsRepository());
    await service.upsert({ puzzleId: "side", category: "SIDE_QUEST", displayOrder: 0, leaderboardEnabled: true });
    await service.upsert({ puzzleId: "main-2", category: "MAIN_LEVEL", displayOrder: 2, leaderboardEnabled: true });
    await service.upsert({ puzzleId: "main-1", category: "MAIN_LEVEL", displayOrder: 1, leaderboardEnabled: true });
    await service.upsert({ puzzleId: "hidden", category: "MAIN_LEVEL", displayOrder: 0 });
    expect((await service.listLeaderboardEnabled()).map((row) => row.puzzleId)).toEqual(["main-1", "main-2", "side"]);
  });

  it("exposes the editable main-level bootstrap preset without side-quest guesses", () => {
    expect(mainLevelRewardPreset).toHaveLength(10);
    expect(mainLevelRewardPreset[0]).toEqual({ levelId: 1, synapseReward: 300, xpReward: 350 });
    expect(mainLevelRewardPreset[9]).toEqual({ levelId: 10, synapseReward: 5000, xpReward: 7000 });
    expect(mainLevelRewardPreset.some((item) => Number(item.levelId) === 3.5)).toBe(false);
  });
});
