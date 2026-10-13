import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/db/schema.js";
import type { Database } from "../src/db/client.js";
import { CatalogService } from "../src/domain/catalog.js";
import { DrizzleLeaderboardRepository } from "../src/domain/leaderboards.js";
import { DrizzlePuzzleRepository } from "../src/domain/puzzles.js";
import { leaderboardCoverageSql } from "../src/operations/leaderboardCoverage.js";
let pg: PGlite, db: Database;
const queries: string[] = [];
beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(f => f.endsWith(".sql")).sort()) await pg.exec((await readFile(new URL("../drizzle/" + file, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  db = drizzle(pg, { schema: s, logger: { logQuery: query => queries.push(query) } }) as unknown as Database;
}, 60000);
afterAll(async () => { await pg.close(); });
async function player() {
  const [u] = await db.insert(s.users).values({ verifiedEmail: crypto.randomUUID() + "@test.invalid" }).returning();
  const [p] = await db.insert(s.players).values({ userId: u.userId, publicPlayerId: crypto.randomUUID(), displayName: "Player" }).returning(); return p;
}
async function puzzle(level = 1) {
  const v = await new CatalogService(db).create({ displayName: "Design " + crypto.randomUUID(), brand: "CircZles", productType: "CIRCZLES", sizeLabel: "12", levelId: level, pieceCount: 121, status: "ACTIVE" });
  await new CatalogService(db).saveCompetitionSettings(v.catalogVariantId, { category: "MAIN_LEVEL", active: true, leaderboardEnabled: true, maxLeaderboardTimeMs: 300000 }); return v;
}
async function attempt(playerId: string, puzzleId: string, time: number, status: "APPROVED" | "PENDING_REVIEW" | "REJECTED" = "APPROVED", date = new Date("2026-10-01T00:00:00Z")) {
  let [owned] = await db.select().from(s.playerPuzzles).where(eq(s.playerPuzzles.playerId, playerId));
  if (!owned || owned.puzzleId !== puzzleId) [owned] = await db.insert(s.playerPuzzles).values({ playerId, puzzleId, source: "TEST" }).returning();
  const [video] = await db.insert(s.videoUploads).values({ playerId, publicId: crypto.randomUUID(), storageProvider: "CLOUDINARY", mimeType: "video/mp4", declaredSizeBytes: 100, verifiedSizeBytes: 100, durationMs: 20000, status: "COMPLETE", expiresAt: new Date(Date.now() + 60000) }).returning();
  const [submission] = await db.insert(s.submissions).values({ playerId, playerPuzzleId: owned.playerPuzzleId, puzzleId, levelId: 1, completionTimeMs: time, videoUploadId: video.videoUploadId, status, submittedAt: date }).returning();
  if (status === "APPROVED") await db.insert(s.leaderboardEntries).values({ playerId, puzzleId, bestSubmissionId: submission.submissionId, bestCompletionTimeMs: time, bestApprovedAt: date, bestSubmittedAt: date });
  return submission;
}
describe("canonical leaderboard and batched owned ranking queries", () => {
  it.each([1, 6])("lists multiple distinct designs at Level %i without loading entries", async level => {
    const a = await puzzle(level), b = await puzzle(level); queries.length = 0;
    const result = await new DrizzleLeaderboardRepository(db).getCatalog();
    expect(result.mainLevels.filter(item => item.levelId === level).map(item => item.puzzleId)).toEqual(expect.arrayContaining([a.puzzleId, b.puzzleId]));
    expect(queries).toHaveLength(1); expect(queries[0]).not.toContain("leaderboard_entries");
  });
  it("newly enabled settings appear, while disabled/inactive/archived/missing maximum boards stay excluded", async () => {
    const v = await puzzle(), catalog = new CatalogService(db), repo = new DrizzleLeaderboardRepository(db);
    for (const patch of [{ leaderboardEnabled: false }, { leaderboardEnabled: true, active: false }]) {
      await catalog.saveCompetitionSettings(v.catalogVariantId, patch);
      expect((await repo.getCatalog()).mainLevels.some(item => item.puzzleId === v.puzzleId)).toBe(false);
      await expect(repo.getLeaderboard(v.puzzleId!, "nobody")).rejects.toMatchObject({ code: "LEADERBOARD_NOT_FOUND" });
    }
    await catalog.saveCompetitionSettings(v.catalogVariantId, { active: true });
    expect((await repo.getCatalog()).mainLevels.some(item => item.puzzleId === v.puzzleId)).toBe(true);
    await db.update(s.puzzleCompetitionSettings).set({ maxLeaderboardTimeMs: null }).where(eq(s.puzzleCompetitionSettings.puzzleId, v.puzzleId!));
    expect((await repo.getCatalog()).mainLevels.some(item => item.puzzleId === v.puzzleId)).toBe(false);
    await catalog.saveCompetitionSettings(v.catalogVariantId, { maxLeaderboardTimeMs: 300000 });
    await catalog.update(v.catalogVariantId, { status: "ARCHIVED" });
    expect((await repo.getCatalog()).mainLevels.some(item => item.puzzleId === v.puzzleId)).toBe(false);
  });
  it("uses the same deterministic full ranking for board and owned puzzles, including rank 15 and ties", async () => {
    const a = await puzzle(), b = await puzzle(6), people = await Promise.all(Array.from({ length: 15 }, () => player()));
    for (let i = 0; i < 15; i++) await attempt(people[i].playerId, a.puzzleId!, 195000, "APPROVED", new Date(Date.UTC(2026, 9, 1, 0, 0, i)));
    await attempt(people[14].playerId, b.puzzleId!, 195000);
    queries.length = 0;
    const owned = await new DrizzlePuzzleRepository(db).getOwnedPuzzles(people[14].playerId);
    expect(queries).toHaveLength(2); // Same count for many owned CircZles.
    expect(owned.find(item => item.id === a.puzzleId)).toMatchObject({ personalBest: "03:15.000", leaderboardRank: 15, leaderboardEligible: true });
    expect(owned.find(item => item.id === b.puzzleId)).toMatchObject({ personalBest: "03:15.000", leaderboardRank: 1 });
    const board = await new DrizzleLeaderboardRepository(db).getLeaderboard(a.puzzleId!, people[14].playerId);
    expect(board.entries).toHaveLength(10); expect(board.currentPlayerEntry?.rank).toBe(15);
    const topOwned = await new DrizzlePuzzleRepository(db).getOwnedPuzzles(people[0].playerId);
    expect(topOwned[0].leaderboardRank).toBe(1);
    await new CatalogService(db).saveCompetitionSettings(a.catalogVariantId, { leaderboardEnabled: false });
    expect((await new DrizzlePuzzleRepository(db).getOwnedPuzzles(people[14].playerId)).find(item => item.id === a.puzzleId)).toMatchObject({ personalBest: "03:15.000", leaderboardEligible: false, leaderboardRank: undefined });
  });
  it("breaks exact approved/submitted timestamp ties by submission identity consistently", async () => {
    const v = await puzzle(), people = await Promise.all([player(), player(), player()]);
    const attempts = [];
    for (const p of people) attempts.push(await attempt(p.playerId, v.puzzleId!, 195000));
    const order = attempts.sort((a, b) => a.submissionId.localeCompare(b.submissionId));
    const board = await new DrizzleLeaderboardRepository(db).getLeaderboard(v.puzzleId!, people[0].playerId);
    expect(board.entries.map(row => row.publicPlayerId)).toEqual(order.map(row => people.find(p => p.playerId === row.playerId)!.publicPlayerId));
    for (let i = 0; i < order.length; i++) expect((await new DrizzlePuzzleRepository(db).getOwnedPuzzles(order[i].playerId))[0].leaderboardRank).toBe(i + 1);
  });
  it("pending and rejected attempts expose status without inventing bests or ranks", async () => {
    for (const status of ["PENDING_REVIEW", "REJECTED"] as const) {
      const p = await player(), v = await puzzle(); const submission = await attempt(p.playerId, v.puzzleId!, 1000, status);
      await db.insert(s.leaderboardEntries).values({ playerId: p.playerId, puzzleId: v.puzzleId!, bestSubmissionId: submission.submissionId, bestCompletionTimeMs: 1000, bestApprovedAt: new Date(), bestSubmittedAt: submission.submittedAt });
      expect((await new DrizzlePuzzleRepository(db).getOwnedPuzzles(p.playerId))[0]).toMatchObject({ latestSubmissionStatus: status, personalBest: undefined, leaderboardRank: undefined });
    }
  });
  it("R2 and R3 share one canonical Lion board; unrelated designs remain independent", async () => {
    const v = await puzzle(), other = await puzzle(), c = new CatalogService(db), repo = new DrizzlePuzzleRepository(db);
    for (const [number, run] of [["29", "R2"], ["61", "R3"]]) await c.addBatch(v.catalogVariantId, { numberIdentifier: number, manufacturingCode: run, skuPrefix: `CC-${number}-${run}-01`, serialStart: "1", serialEnd: "5", unitsManufactured: "5", status: "ACTIVE" });
    const p = await player(), q = await player();
    await repo.claimByCode(p.playerId, { normalizedPrefix: "CC-29-R2-01", normalizedCode: "CC-29-R2-01-1", serialNumber: 1n });
    await repo.claimByCode(q.playerId, { normalizedPrefix: "CC-61-R3-01", normalizedCode: "CC-61-R3-01-1", serialNumber: 1n });
    await attempt(p.playerId, v.puzzleId!, 195000);
    expect((await repo.getOwnedPuzzles(p.playerId))[0]).toMatchObject({ id: v.puzzleId, personalBest: "03:15.000", leaderboardRank: 1 });
    expect((await repo.getOwnedPuzzles(q.playerId))[0]).toMatchObject({ id: v.puzzleId, personalBest: undefined });
    expect((await new DrizzleLeaderboardRepository(db).getLeaderboard(other.puzzleId!, p.playerId)).entries).toEqual([]);
  });
  it("coverage contains ten levels, distinguishes configuration gaps, and reads no player identities", async () => {
    const result = await pg.query<{ level: number; active_playable: number; enabled_main_leaderboards: number }>(leaderboardCoverageSql);
    expect(result.rows.map(row => row.level)).toEqual([1,2,3,4,5,6,7,8,9,10]);
    expect(result.rows[0].active_playable).toBeGreaterThan(1); expect(result.rows[0].enabled_main_leaderboards).toBeLessThan(result.rows[0].active_playable);
    expect(leaderboardCoverageSql).not.toMatch(/players|video_uploads|point_transactions/i);
  });
});
