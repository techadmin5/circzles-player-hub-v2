import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import * as s from "../src/db/schema.js";
import type { Database } from "../src/db/client.js";
import { CatalogService, validateBatch, catalogJson } from "../src/domain/catalog.js";
import { PuzzleOwnershipService, DrizzlePuzzleRepository, parseClaimCode } from "../src/domain/puzzles.js";
import { AdminAuthorizationService, DrizzleAdminAuthorizationRepository } from "../src/domain/adminAuth.js";
import { hashSessionToken, SESSION_COOKIE_NAME } from "../src/domain/sessions.js";
import { registerCatalogRoutes } from "../src/http/catalogRoutes.js";
import { DrizzleCompetitionSettingsRepository } from "../src/domain/competitionSettings.js";
import { AppError } from "../src/domain/errors.js";
import type { Env } from "../src/config/env.js";

let pg: PGlite, db: Database, catalog: CatalogService, ownership: PuzzleOwnershipService;
const secret = "catalog-test-session-secret-at-least-32-characters";
async function player() {
  const [user] = await db.insert(s.users).values({ verifiedEmail: crypto.randomUUID() + "@example.test", emailVerifiedAt: new Date() }).returning();
  const [row] = await db.insert(s.players).values({ userId: user.userId, displayName: "Player", publicPlayerId: "test_" + crypto.randomUUID().replaceAll("-", "") }).returning();
  return { id: row.playerId, userId: user.userId };
}
async function variant(overrides: Partial<Parameters<CatalogService["create"]>[0]> = {}) {
  return catalog.create({ displayName: "Isolated test design " + crypto.randomUUID(), brand: "CircZles", productType: "CIRCZLES", sizeLabel: "12", pieceCount: 121, levelId: 1, status: "ACTIVE", ...overrides });
}
let number = 100;
function batch(overrides: Partial<Parameters<CatalogService["addBatch"]>[1]> = {}) {
  const id = String(number++);
  return { numberIdentifier: id, manufacturingCode: "R4", skuPrefix: "CC-" + id + "-R4-01", serialStart: "1", serialEnd: "500", unitsManufactured: "500", status: "ACTIVE" as const, ...overrides };
}
function row(id: string, overrides: Record<string, unknown> = {}) {
  return { sourceId: id, name: "Lion", size: "12", brand: "CircZles ", numberIdentifier: id, manufacturingCode: "R3", level: "01", units: "500", firstFullSku: "CC-" + id + "-R3-01-0001", productType: "CIRCZLES", ...overrides };
}
async function counts() {
  const result: Record<string, unknown> = {};
  for (const table of ["catalog_variants", "manufacturing_batches", "manufacturing_batch_ranges", "puzzles", "puzzle_claims", "player_puzzles", "game_events", "players", "wallets", "xp_transactions", "point_transactions", "submissions", "leaderboard_entries", "player_inventory_items"]) result[table] = (await pg.query("SELECT count(*)::text AS count FROM " + table)).rows;
  return result;
}
beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql")).sort()) await pg.exec((await readFile(new URL("../drizzle/" + file, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  db = drizzle(pg, { schema: s }) as unknown as Database;
  catalog = new CatalogService(db); ownership = new PuzzleOwnershipService(new DrizzlePuzzleRepository(db));
}, 60000);
afterAll(async () => { await pg.close(); });

describe("manufactured CircZles claims", () => {
  it("preserves trusted development catalog claims with explicit demo ranges", async () => {
    await ownership.seedDevelopmentCatalog();
    const p = await player();
    expect((await ownership.claimByCode(p.id, "DEV-MM-R1-0777")).puzzle.name).toBe("Metamorphosis");
    await expect(ownership.claimByCode((await player()).id, "DEV-MM-R1-1001")).rejects.toMatchObject({ code: "PUZZLE_SERIAL_NOT_MANUFACTURED" });
  });
  it("allows explicit canonical corrections before claims and forbids them after claims", async () => {
    const original = await variant(), target = await variant({ displayName: "Explicit target" }), input = batch(), b = await catalog.addBatch(original.catalogVariantId, input);
    await catalog.editBatch(b.manufacturingBatchId, { ...input, catalogVariantId: target.catalogVariantId });
    expect((await ownership.claimByCode((await player()).id, b.skuPrefix + "-1")).puzzle.id).toBe(target.puzzleId);
    await expect(catalog.editBatch(b.manufacturingBatchId, { ...input, catalogVariantId: original.catalogVariantId })).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
  });
  it("completes a draft, corrects its NA prefix before claims and publishes the verified batch", async () => {
    const draft = await variant({ levelId: null, status: "DRAFT" });
    const b = await catalog.addBatch(draft.catalogVariantId, batch({ skuPrefix: "CC-915-R4-NA", numberIdentifier: "915", status: "DRAFT" }));
    await catalog.update(draft.catalogVariantId, { levelId: 3.5, status: "ACTIVE" });
    await expect(catalog.editBatch(b.manufacturingBatchId, { status: "ACTIVE" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await catalog.editBatch(b.manufacturingBatchId, batch({ skuPrefix: "CC-915-R4-3.5", numberIdentifier: "915" }));
    expect((await ownership.claimByCode((await player()).id, "CC-915-R4-3.5-1")).puzzle.levelId).toBe(3.5);
  });
  it.each(["0001", "1", "1001", "10000", "9223372036854775807"])("uses unbounded presentation digits with bigint identity: %s", serial => {
    expect(parseClaimCode("CC-79-R3-3.5-" + serial)).toMatchObject({ normalizedPrefix: "CC-79-R3-3.5", serialNumber: BigInt(serial) });
  });
  it.each(["CC-79-R3-3.5-0", "CC-79-R3-3.5--1", "CC-79-R3-3.5-1.5", "CC-79-R3-3.5-abc", "CC-79-R3-3.5-9223372036854775808", "CC-79-R3-3.5-", "CC--R3-1-1"])("rejects malformed or overflowing SKU %s", code => expect(() => parseClaimCode(code)).toThrow());
  it("maps Lion R2 and R3 to one canonical variant, preserving exact batch traceability and ownership uniqueness", async () => {
    const lion = await variant(), one = await player(), two = await player();
    const r2 = await catalog.addBatch(lion.catalogVariantId, batch({ numberIdentifier: "29", manufacturingCode: "R2", skuPrefix: "CC-29-R2-01", serialEnd: "48", unitsManufactured: "48", firstFullSku: "CC-29-R2-01-0001" }));
    const r3 = await catalog.addBatch(lion.catalogVariantId, batch({ numberIdentifier: "61", manufacturingCode: "R3", skuPrefix: "CC-61-R3-01" }));
    expect((await ownership.claimByCode(one.id, "CC-29-R2-01-0001")).puzzle.id).toBe(lion.puzzleId);
    const before = await counts();
    await expect(ownership.claimByCode(one.id, "CC-61-R3-01-0001")).rejects.toMatchObject({ code: "PUZZLE_ALREADY_OWNED" });
    expect(await counts()).toEqual(before);
    expect((await ownership.claimByCode(two.id, "CC-61-R3-01-1")).puzzle.id).toBe(lion.puzzleId);
    await expect(ownership.claimByCode(two.id, "CC-29-R2-01-1")).rejects.toMatchObject({ code: "PUZZLE_CODE_ALREADY_CLAIMED" });
    const detail = await catalog.detail(lion.catalogVariantId);
    expect(detail.batches.map(b => [b.puzzleId, b.claimedUnits, b.remainingUnits])).toEqual([[lion.puzzleId, 1n, 47n], [lion.puzzleId, 1n, 499n]]);
    const events = await db.select().from(s.gameEvents).where(eq(s.gameEvents.playerId, two.id));
    expect(events[0].payload).toMatchObject({ manufacturingBatchId: r3.manufacturingBatchId });
    expect(r2.puzzleClaimPrefixId).not.toBe(r3.puzzleClaimPrefixId);
  });
  it("enforces boundaries and added disjoint ranges, without materializing physical units", async () => {
    const v = await variant(), b = await catalog.addBatch(v.catalogVariantId, batch());
    const first = await player(), last = await player();
    await ownership.claimByCode(first.id, b.skuPrefix + "-0001"); await ownership.claimByCode(last.id, b.skuPrefix + "-0500");
    await expect(ownership.claimByCode((await player()).id, b.skuPrefix + "-0501")).rejects.toMatchObject({ code: "PUZZLE_SERIAL_NOT_MANUFACTURED" });
    await catalog.addRange(b.manufacturingBatchId, { serialStart: "1000", serialEnd: "10001" });
    await expect(catalog.addRange(b.manufacturingBatchId, { serialStart: "499", serialEnd: "1001" })).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
    await expect(ownership.claimByCode((await player()).id, b.skuPrefix + "-0999")).rejects.toMatchObject({ code: "PUZZLE_SERIAL_NOT_MANUFACTURED" });
    await ownership.claimByCode((await player()).id, b.skuPrefix + "-10000");
    expect((await catalog.detail(v.catalogVariantId)).batches[0]).toMatchObject({ unitsManufactured: 9502n, claimedUnits: 3n, ranges: expect.any(Array) });
    await catalog.editBatch(b.manufacturingBatchId, { status: "ARCHIVED" });
    await expect(ownership.claimByCode((await player()).id, b.skuPrefix + "-10001")).rejects.toMatchObject({ code: "PUZZLE_BATCH_INACTIVE" });
  });
  it("allows a non-one serial start and fractional levels without changing SKU formatting", async () => {
    for (const level of [3.5, 0.5]) {
      const v = await variant({ levelId: level }); const id = String(number++);
      const b = await catalog.addBatch(v.catalogVariantId, batch({ numberIdentifier: id, skuPrefix: "CC-" + id + "-R4-" + level, serialStart: "1000", serialEnd: "1001", unitsManufactured: "2" }));
      await expect(ownership.claimByCode((await player()).id, b.skuPrefix + "-999")).rejects.toMatchObject({ code: "PUZZLE_SERIAL_NOT_MANUFACTURED" });
      expect((await ownership.claimByCode((await player()).id, b.skuPrefix + "-1000")).puzzle.levelId).toBe(level);
    }
  });
  it("renames display metadata without rewriting SKU, claims, ownership or rewards", async () => {
    const v = await variant(), b = await catalog.addBatch(v.catalogVariantId, batch()), p = await player();
    const registered = await ownership.claimByCode(p.id, b.skuPrefix + "-1");
    const [upload] = await db.insert(s.videoUploads).values({ playerId: p.id, storageProvider: "TEST", publicId: crypto.randomUUID(), mimeType: "video/mp4", declaredSizeBytes: 100, status: "COMPLETE", expiresAt: new Date(Date.now() + 60000) }).returning();
    const [submitted] = await db.insert(s.submissions).values({ playerId: p.id, playerPuzzleId: registered.puzzle.playerPuzzleId, puzzleId: v.puzzleId!, levelId: 1, completionTimeMs: 10000, videoUploadId: upload.videoUploadId, status: "APPROVED" }).returning();
    const [rank] = await db.insert(s.leaderboardEntries).values({ playerId: p.id, puzzleId: v.puzzleId!, bestSubmissionId: submitted.submissionId, bestCompletionTimeMs: 10000, bestApprovedAt: new Date(), bestSubmittedAt: submitted.submittedAt }).returning();
    const claim = await db.select().from(s.puzzleClaims).where(eq(s.puzzleClaims.playerId, p.id));
    const before = await counts();
    await catalog.update(v.catalogVariantId, { displayName: "Final Lion", image: "/lion.svg", description: "Final art", marketingMetadata: { theme: "wildlife" } });
    expect((await ownership.getOwnedPuzzles(p.id))[0].name).toBe("Final Lion");
    expect(await catalog.detail(v.catalogVariantId)).toMatchObject({ status: "ACTIVE", batches: [expect.objectContaining({ status: "ACTIVE", skuPrefix: b.skuPrefix })] });
    expect(await db.select().from(s.puzzleClaims).where(eq(s.puzzleClaims.playerId, p.id))).toEqual(claim);
    expect((await db.select().from(s.submissions).where(eq(s.submissions.submissionId, submitted.submissionId)))[0]).toEqual(submitted);
    expect((await db.select().from(s.leaderboardEntries).where(eq(s.leaderboardEntries.leaderboardEntryId, rank.leaderboardEntryId)))[0]).toEqual(rank);
    expect(await counts()).toEqual(before);
    await expect(catalog.editBatch(b.manufacturingBatchId, batch({ numberIdentifier: "900", skuPrefix: "CC-900-R4-01" }))).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
    await expect(catalog.update(v.catalogVariantId, { sizeLabel: "16" })).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
    const larger = await variant({ puzzleDesignId: v.puzzleDesignId, sizeLabel: "16" }); expect(larger.puzzleId).not.toBe(v.puzzleId);
  });
  it("keeps incomplete drafts and accessories outside gameplay", async () => {
    const draft = await variant({ levelId: null, status: "DRAFT" }); expect(draft.puzzleId).toBeNull();
    const b = await catalog.addBatch(draft.catalogVariantId, batch({ skuPrefix: "CC-910-R4-NA", numberIdentifier: "910", status: "DRAFT" }));
    await expect(catalog.editBatch(b.manufacturingBatchId, { status: "ACTIVE" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(ownership.claimByCode((await player()).id, b.skuPrefix + "-1")).rejects.toMatchObject({ code: "PUZZLE_BATCH_INACTIVE" });
    const accessory = await variant({ displayName: "Puzzle Saver Board", brand: "Cogzart", productType: "ACCESSORY", levelId: null }); expect(accessory.puzzleId).toBeNull();
    const board = await catalog.addBatch(accessory.catalogVariantId, batch({ skuPrefix: "CZ-911-R4-NA", numberIdentifier: "911" }));
    const p = await player(), before = await counts();
    await expect(ownership.claimByCode(p.id, board.skuPrefix + "-1")).rejects.toMatchObject({ code: "PUZZLE_CODE_ACCESSORY" });
    expect(await counts()).toEqual(before);
  });
  it("rejects legacy prefixes without verified manufacturing ranges", async () => {
    const v = await variant(); await db.insert(s.puzzleClaimPrefixes).values({ puzzleId: v.puzzleId!, prefix: "CC-912-R4-01", normalizedPrefix: "CC-912-R4-01" });
    await expect(ownership.claimByCode((await player()).id, "CC-912-R4-01-1")).rejects.toMatchObject({ code: "PUZZLE_CODE_INVALID" });
  });
  it("corrects unclaimed setup but reserves globally unique manufacturing prefixes", async () => {
    const v = await variant(), b = await catalog.addBatch(v.catalogVariantId, batch({ numberIdentifier: "913", skuPrefix: "CC-913-R4-01" }));
    await catalog.editBatch(b.manufacturingBatchId, batch({ numberIdentifier: "914", skuPrefix: "CC-914-R4-01" }));
    await expect(catalog.addBatch(v.catalogVariantId, batch({ numberIdentifier: "914", skuPrefix: "CC-914-R4-01" }))).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
    await expect(ownership.claimByCode((await player()).id, "CC-913-R4-01-1")).rejects.toMatchObject({ code: "PUZZLE_CODE_INVALID" });
    await ownership.claimByCode((await player()).id, "CC-914-R4-01-1");
  });
  it("rolls back claim and ownership if the game-event write fails", async () => {
    const v = await variant(), b = await catalog.addBatch(v.catalogVariantId, batch()), p = await player(), before = await counts();
    await pg.exec("CREATE FUNCTION reject_catalog_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test event failure'; END $$; CREATE TRIGGER reject_catalog_event BEFORE INSERT ON game_events FOR EACH ROW EXECUTE FUNCTION reject_catalog_event();");
    try { await expect(ownership.claimByCode(p.id, b.skuPrefix + "-1")).rejects.toMatchObject({ code: "PUZZLE_CLAIM_FAILED" }); expect(await counts()).toEqual(before); }
    finally { await pg.exec("DROP TRIGGER reject_catalog_event ON game_events; DROP FUNCTION reject_catalog_event();"); }
  });
  it("concurrent claim attempts commit only one physical identity", async () => {
    const v = await variant(), b = await catalog.addBatch(v.catalogVariantId, batch()), one = await player(), two = await player();
    const results = await Promise.allSettled([ownership.claimByCode(one.id, b.skuPrefix + "-0001"), ownership.claimByCode(two.id, b.skuPrefix + "-1")]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await catalog.detail(v.catalogVariantId)).batches[0].claimedUnits).toBe(1n);
  });
  it("concurrent cross-batch claims preserve canonical ownership and leave the rejected unit unused", async () => {
    const v = await variant(), a = await catalog.addBatch(v.catalogVariantId, batch()), b = await catalog.addBatch(v.catalogVariantId, batch()), p = await player();
    const result = await Promise.allSettled([ownership.claimByCode(p.id, a.skuPrefix + "-1"), ownership.claimByCode(p.id, b.skuPrefix + "-1")]);
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await catalog.detail(v.catalogVariantId)).batches.reduce((sum, row) => sum + row.claimedUnits, 0n)).toBe(1n);
  });
  it.each([
    { skuPrefix: "CC-001-R4-01", numberIdentifier: "1" }, { skuPrefix: "CC-001-R5-01", numberIdentifier: "001" },
    { skuPrefix: "CC-001-R4-02", numberIdentifier: "001" }, { unitsManufactured: "501" }, { serialStart: "abc" },
  ])("rejects inconsistent metadata %#", patch => expect(() => validateBatch(batch(patch), { productType: "CIRCZLES", levelId: "1" })).toThrow());
});

describe("explicit transactional catalog imports", { timeout: 20000 }, () => {
  it("requires own explicit mapping entries even for source IDs matching object prototype names", async () => {
    const manifest = { datasetId: "own-mappings", rows: [row("940", { sourceId: "constructor" }), row("941", { sourceId: "__proto__" })], mappings: {} };
    const before = await counts(), report = await catalog.import(manifest);
    expect(report.errors).toHaveLength(2); expect(report.ready).toBe(false);
    await expect(catalog.import(manifest, true)).rejects.toMatchObject({ code: "VALIDATION_FAILED" }); expect(await counts()).toEqual(before);
  });
  it("keeps dataset and source-row identities unambiguous when their text contains delimiters", async () => {
    const first = { datasetId: "a:b", rows: [row("942", { sourceId: "c" })], mappings: { c: { newVariantKey: "first" } } };
    const second = { datasetId: "a", rows: [row("943", { sourceId: "b:c" })], mappings: { "b:c": { newVariantKey: "second" } } };
    expect(await catalog.import(first, true)).toMatchObject({ applied: true }); expect(await catalog.import(second, true)).toMatchObject({ applied: true });
    expect(await catalog.import(first, true)).toMatchObject({ planned: 0 }); expect(await catalog.import(second, true)).toMatchObject({ planned: 0 });
  });
  it("additively backfills populated legacy variants without rewriting IDs, ownership or claim history", async () => {
    const scratch = new PGlite();
    try {
      for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql") && file.slice(0, 4) < "0023").sort()) await scratch.exec((await readFile(new URL("../drizzle/" + file, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
      const fixture = drizzle(scratch, { schema: s });
      const [user] = await fixture.insert(s.users).values({ verifiedEmail: "migration@example.test", emailVerifiedAt: new Date() }).returning();
      const [actor] = await fixture.insert(s.players).values({ userId: user.userId, displayName: "Legacy", publicPlayerId: "migration_001" }).returning();
      const [design] = await fixture.insert(s.puzzleDesigns).values({ name: "Legacy" }).returning();
      const [puzzle] = await fixture.insert(s.puzzles).values({ puzzleDesignId: design.puzzleDesignId, name: "Legacy", levelId: 13 }).returning();
      const [prefix] = await fixture.insert(s.puzzleClaimPrefixes).values({ puzzleId: puzzle.puzzleId, prefix: "CC-970-R2-13", normalizedPrefix: "CC-970-R2-13" }).returning();
      const [claim] = await fixture.insert(s.puzzleClaims).values({ puzzleId: puzzle.puzzleId, puzzleClaimPrefixId: prefix.puzzleClaimPrefixId, playerId: actor.playerId, serialNumber: 7n, normalizedCode: "CC-970-R2-13-7" }).returning();
      await fixture.insert(s.playerPuzzles).values({ playerId: actor.playerId, puzzleId: puzzle.puzzleId, puzzleClaimId: claim.puzzleClaimId, source: "CODE_CLAIM" });
      await fixture.insert(s.wallets).values({ playerId: actor.playerId, balance: 123 });
      const tables = ["users", "players", "puzzle_designs", "puzzles", "puzzle_claim_prefixes", "puzzle_claims", "player_puzzles", "wallets"];
      const before = await Promise.all(tables.map(table => scratch.query("SELECT * FROM " + table).then(result => result.rows)));
      await scratch.exec(await readFile(new URL("../drizzle/0023_circzles_catalog_manufacturing.sql", import.meta.url), "utf8"));
      expect(await Promise.all(tables.map(table => scratch.query("SELECT * FROM " + table).then(result => result.rows)))).toEqual(before);
      await scratch.exec(await readFile(new URL("../drizzle/0025_catalog_max_leaderboard_time.sql", import.meta.url), "utf8"));
      expect(await new CatalogService(fixture as unknown as Database).list()).toMatchObject([{ puzzleId: puzzle.puzzleId, puzzleDesignId: design.puzzleDesignId, displayName: "Legacy", status: "ACTIVE" }]);
      expect((await scratch.query("SELECT count(*)::int AS count FROM manufacturing_batches")).rows).toEqual([{ count: 0 }]);
    } finally { await scratch.close(); }
  });
  it("validates every supplied source SKU when explicitly mapped, preserving raw source facts", async () => {
    const source = JSON.parse(await readFile(new URL("../../docs/circzles-catalog/r1-r2-r3.source.json", import.meta.url), "utf8"));
    for (const row of source.rows) source.mappings[row.sourceId] = { newVariantKey: "test-explicit-" + row.sourceId };
    source.mappings["29-R2"] = { newVariantKey: "test-explicit-lion" }; source.mappings["61-R3"] = { newVariantKey: "test-explicit-lion" };
    // A fresh database represents a first import; other tests deliberately reserve Lion prefixes.
    const scratch = new PGlite();
    try {
      for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql")).sort()) await scratch.exec((await readFile(new URL("../drizzle/" + file, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
      const isolated = new CatalogService(drizzle(scratch, { schema: s }) as unknown as Database);
      expect(await isolated.import(source)).toMatchObject({ ready: true, planned: 82 });
      expect((await scratch.query("SELECT count(*)::int AS count FROM manufacturing_batches")).rows).toEqual([{ count: 0 }]);
      await isolated.import(source, true);
      expect((await scratch.query("SELECT count(*)::int AS count, sum(units_manufactured)::text AS units FROM manufacturing_batches")).rows).toEqual([{ count: 82, units: "12001" }]);
      expect((await scratch.query("SELECT count(*)::int AS count FROM catalog_variants")).rows).toEqual([{ count: 81 }]);
      expect((await scratch.query("SELECT count(*)::int AS count FROM puzzles")).rows).toEqual([{ count: 77 }]);
      expect((await scratch.query("SELECT count(*)::int AS count FROM puzzle_claims")).rows).toEqual([{ count: 0 }]);
      const [raw] = (await scratch.query<{ source_data: Record<string, string>; brand: string }>("SELECT source_data, brand FROM manufacturing_batches WHERE sku_prefix = 'CC-31-R2-14'")).rows;
      expect(raw.brand).toBe("CircZles ");
      expect(raw.source_data).toMatchObject({ units: "03", brand: "CircZles ", firstFullSku: "CC-31-R2-14-0001" });
      expect(await isolated.import(source, true)).toMatchObject({ planned: 0, applied: true });
    } finally { await scratch.close(); }
  });
  it("rejects a duplicate design mapping with conflicting levels, not just conflicting size", async () => {
    const report = await catalog.import({ datasetId: "levels", rows: [row("930"), row("931", { level: "02", firstFullSku: "CC-931-R3-02-0001" })], mappings: { "930": { newVariantKey: "shared" }, "931": { newVariantKey: "shared" } } });
    expect(report.errors[0].message).toContain("conflicting gameplay");
  });
  it("registers verified legacy prefixes only through their explicit canonical variant and preserves historical claims", async () => {
    const v = await variant({ sizeLabel: "12", pieceCount: null });
    const [prefix] = await db.insert(s.puzzleClaimPrefixes).values({ puzzleId: v.puzzleId!, prefix: "CC-932-R3-01", normalizedPrefix: "CC-932-R3-01", active: false, deletedAt: new Date() }).returning();
    const p = await player();
    const [claim] = await db.insert(s.puzzleClaims).values({ puzzleId: v.puzzleId!, puzzleClaimPrefixId: prefix.puzzleClaimPrefixId, playerId: p.id, serialNumber: 2n, normalizedCode: "CC-932-R3-01-2" }).returning();
    const manifest = { datasetId: "legacy", rows: [row("932", { units: "1" })], mappings: { "932": { catalogVariantId: v.catalogVariantId } } };
    expect((await catalog.import(manifest)).errors[0].message).toContain("exclude a historical claim");
    manifest.rows[0].units = "500";
    await catalog.import(manifest, true);
    expect((await db.select().from(s.puzzleClaims).where(eq(s.puzzleClaims.puzzleClaimId, claim.puzzleClaimId)))[0]).toEqual(claim);
    expect((await catalog.detail(v.catalogVariantId)).batches[0].claimedUnits).toBe(1n);
    expect((await db.select().from(s.puzzleClaimPrefixes).where(eq(s.puzzleClaimPrefixes.puzzleClaimPrefixId, prefix.puzzleClaimPrefixId)))[0]).toMatchObject({ active: true, deletedAt: null });
    await ownership.claimByCode((await player()).id, "CC-932-R3-01-1");
  });
  it("reports ambiguous historical prefix identities rather than choosing an arbitrary registry row", async () => {
    const first = await variant({ pieceCount: null }), second = await variant({ pieceCount: null });
    await db.insert(s.puzzleClaimPrefixes).values([{ puzzleId: first.puzzleId!, prefix: "CC-933-R3-01", normalizedPrefix: "CC-933-R3-01", deletedAt: new Date() }, { puzzleId: second.puzzleId!, prefix: "CC-933-R3-01", normalizedPrefix: "CC-933-R3-01" }]);
    const before = await counts();
    const manifest = { datasetId: "ambiguous-history", rows: [row("933")], mappings: { "933": { catalogVariantId: second.catalogVariantId } } };
    expect((await catalog.import(manifest)).errors[0].message).toContain("multiple legacy identities");
    await expect(catalog.import(manifest, true)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await counts()).toEqual(before);
  });
  it("preserves all 82 source rows, exact decimal SKUs, leading zero units and unresolved mappings", async () => {
    const source = JSON.parse(await readFile(new URL("../../docs/circzles-catalog/r1-r2-r3.source.json", import.meta.url), "utf8"));
    expect(source.rows).toHaveLength(82); expect(source.rows.reduce((n: number, r: { units: string }) => n + Number(r.units), 0)).toBe(12001);
    expect(source.rows.find((r: { sourceId: string }) => r.sourceId === "31-R2").units).toBe("03");
    expect(source.rows.find((r: { sourceId: string }) => r.sourceId === "72-R3").firstFullSku).toBe("CC-72-R3-0.5-0001");
    const before = await counts(), report = await catalog.import(source); expect(report.errors).toHaveLength(82); expect(await counts()).toEqual(before);
  });
  it("preserves all 44 finalized R3 rows exactly without obsolete manufacturing aliases", async () => {
    const source = JSON.parse(await readFile(new URL("../../docs/circzles-catalog/r1-r2-r3.source.json", import.meta.url), "utf8"));
    const finalized = `1885	8	CircZles	39	R3	03	100	CC-39-R3-03-0001
Colorstom	8	CircZles	40	R3	10	20	CC-40-R3-10-0001
Red Alert	8	CircZles	41	R3	06	100	CC-41-R3-06-0001
Cosmic walk	10	CircZles	42	R3	16	20	CC-42-R3-16-0001
Eagle-eyed	10	CircZles	43	R3	09	100	CC-43-R3-09-0001
Elephant	10	CircZles	44	R3	19	20	CC-44-R3-19-0001
Hoot	10	CircZles	45	R3	05	100	CC-45-R3-05-0001
Jade Embers	10	CircZles	46	R3	05	100	CC-46-R3-05-0001
lucid skies	10	CircZles	47	R3	02	200	CC-47-R3-02-0001
metamorphosis	10	CircZles	48	R3	02	300	CC-48-R3-02-0001
Midnight Bazaar	10	CircZles	49	R3	05	100	CC-49-R3-05-0001
Peocock	10	CircZles	50	R3	09	100	CC-50-R3-09-0001
Spiritual Awakening	10	CircZles	51	R3	13	20	CC-51-R3-13-0001
1995	12	CircZles	52	R3	01	100	CC-52-R3-01-0001
Best friend	12	CircZles	53	R3	08	200	CC-53-R3-08-0001
Bullseye	12	CircZles	54	R3	04	100	CC-54-R3-04-0001
clockwork cogzart	12	CircZles	55	R3	04	100	CC-55-R3-04-0001
Florescence	12	CircZles	56	R3	08	100	CC-56-R3-08-0001
Folklore	12	CircZles	57	R3	21	20	CC-57-R3-21-0001
Glass puppies	12	CircZles	58	R3	01	200	CC-58-R3-01-0001
Gold Fishing	12	CircZles	59	R3	15	20	CC-59-R3-15-0001
Lightone	12	CircZles	60	R3	23	20	CC-60-R3-23-0001
LION	12	CircZles	61	R3	01	500	CC-61-R3-01-0001
Lunartic	12	CircZles	62	R3	01	100	CC-62-R3-01-0001
Mind Map	12	CircZles	63	R3	04	400	CC-63-R3-04-0001
Octo Gone	12	CircZles	64	R3	01	100	CC-64-R3-01-0001
Pluto	12	CircZles	65	R3	18	20	CC-65-R3-18-0001
Primate Directive	12	CircZles	66	R3	04	100	CC-66-R3-04-0001
Split Nature	12	CircZles	67	R3	04	100	CC-67-R3-04-0001
StagNation	12	CircZles	68	R3	04	100	CC-68-R3-04-0001
The OG	12	CircZles	69	R3	01	300	CC-69-R3-01-0001
the overthinker	12	CircZles	70	R3	12	100	CC-70-R3-12-0001
Aapdo Dham	16	CircZles	71	R3	14	20	CC-71-R3-14-0001
All who wander	16	CircZles	72	R3	0.5	20	CC-72-R3-0.5-0001
Birdwired	16	CircZles	73	R3	07	20	CC-73-R3-07-0001
DNA-Coded Carbon	16	CircZles	74	R3	25	20	CC-74-R3-25-0001
Forgotten Worlds	16	CircZles	75	R3	22	20	CC-75-R3-22-0001
Once Upon India	16	CircZles	76	R3	20	20	CC-76-R3-20-0001
Rickshaw	16	CircZles	77	R3	24	20	CC-77-R3-24-0001
Serenity	16	CircZles	78	R3	17	20	CC-78-R3-17-0001
Set in Stone	16	CircZles	79	R3	3.5	20	CC-79-R3-3.5-0001
Still Waters	16	CircZles	80	R3	07	20	CC-80-R3-07-0001
Swirled	16	CircZles	81	R3	11	20	CC-81-R3-11-0001
Waiting for god	16	CircZles	82	R3	11	20	CC-82-R3-11-0001`.split("\n").map(line => line.split("\t"));
    const rows = source.rows.filter((r: { manufacturingCode: string }) => r.manufacturingCode === "R3");
    expect(rows).toHaveLength(44);
    expect(rows.map((r: Record<string, string>) => [r.name, r.size, r.brand, r.numberIdentifier, r.manufacturingCode, r.level, r.units, r.firstFullSku])).toEqual(finalized);
    expect(rows.map((r: Record<string, string>) => [r.sourceId, r.productType])).toEqual(finalized.map(r => [r[3] + "-R3", "CIRCZLES"]));
    const prefixes = rows.map((r: { firstFullSku: string }) => r.firstFullSku.slice(0, r.firstFullSku.lastIndexOf("-")));
    for (const obsolete of ["CC-42-R3-05", "CC-43-R3-16", "CC-44-R3-09", "CC-45-R3-19", "CC-46-R3-02", "CC-48-R3-05", "CC-52-R3-04", "CC-53-R3-04", "CC-55-R3-21", "CC-56-R3-15", "CC-57-R3-23", "CC-59-R3-04", "CC-60-R3-04", "CC-62-R3-12", "CC-63-R3-08", "CC-64-R3-18", "CC-65-R3-08", "CC-66-R3-01", "CC-67-R3-01", "CC-70-R3-01", "CC-72-R3-3.5", "CC-74-R3-11", "CC-75-R3-25", "CC-76-R3-22", "CC-77-R3-20", "CC-78-R3-24", "CC-79-R3-17", "CC-80-R3-0.5", "CC-81-R3-07"]) expect(prefixes).not.toContain(obsolete);
    const example = JSON.parse(await readFile(new URL("../../docs/circzles-catalog/mapping.example.json", import.meta.url), "utf8"));
    expect(example).toEqual({ "29-R2": { newVariantKey: "explicit-lion-12-level-1" }, "61-R3": { newVariantKey: "explicit-lion-12-level-1" } });
    expect(source.mappings).toEqual({});
  });
  it("never merges names implicitly, previews without writes, imports multiple batches atomically and reruns idempotently", async () => {
    const manifest = { datasetId: "test-explicit", rows: [row("920"), row("921", { name: "LION" })], mappings: { "920": { newVariantKey: "explicit-lion" }, "921": { newVariantKey: "explicit-lion" } } };
    const before = await counts(); expect(await catalog.import(manifest)).toMatchObject({ ready: true, planned: 2, applied: false }); expect(await counts()).toEqual(before);
    expect(await catalog.import(manifest, true)).toMatchObject({ applied: true });
    const a = (await db.select().from(s.manufacturingBatches).where(eq(s.manufacturingBatches.skuPrefix, "CC-920-R3-01")))[0];
    const b = (await db.select().from(s.manufacturingBatches).where(eq(s.manufacturingBatches.skuPrefix, "CC-921-R3-01")))[0]; expect(a.puzzleId).toBe(b.puzzleId);
    const after = await counts(); expect(await catalog.import(manifest, true)).toMatchObject({ applied: true, skipped: ["920", "921"], planned: 0 }); expect(await counts()).toEqual(after);
    await expect(catalog.import({ ...manifest, rows: [row("920", { units: "501" }), manifest.rows[1]] }, true)).rejects.toMatchObject({ code: "VALIDATION_FAILED" }); expect(await counts()).toEqual(after);
  });
  it("keeps identical names separate when the explicit mapping creates separate variants", async () => {
    const manifest = { datasetId: "test-separate", rows: [row("922"), row("923")], mappings: { "922": { newVariantKey: "a" }, "923": { newVariantKey: "b" } } }; await catalog.import(manifest, true);
    const all = await db.select().from(s.manufacturingBatches); const a = all.find(b => b.skuPrefix === "CC-922-R3-01")!, b = all.find(b => b.skuPrefix === "CC-923-R3-01")!; expect(a.puzzleId).not.toBe(b.puzzleId);
  });
  it("rejects inconsistent shared variants and duplicate prefixes before any writes", async () => {
    const before = await counts(); const rows = [row("924"), row("925", { size: "16" })], mappings = { "924": { newVariantKey: "shared" }, "925": { newVariantKey: "shared" } };
    await expect(catalog.import({ datasetId: "bad", rows, mappings }, true)).rejects.toMatchObject({ code: "VALIDATION_FAILED" }); expect(await counts()).toEqual(before);
    const report = await catalog.import({ datasetId: "dup", rows: [row("926"), row("927", { numberIdentifier: "926", firstFullSku: "CC-926-R3-01-0001" })], mappings: { "926": { newVariantKey: "a" }, "927": { newVariantKey: "b" } } }); expect(report.errors[0].message).toContain("Duplicate manufacturing prefix");
  });
  it("rolls back an apply-time failure after earlier rows have been inserted", async () => {
    const before = await counts(); await pg.exec("CREATE FUNCTION reject_second_batch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.number_identifier = '929' THEN RAISE EXCEPTION 'test import failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_second_batch BEFORE INSERT ON manufacturing_batches FOR EACH ROW EXECUTE FUNCTION reject_second_batch();");
    try { await expect(catalog.import({ datasetId: "rollback", rows: [row("928"), row("929")], mappings: { "928": { newVariantKey: "a" }, "929": { newVariantKey: "b" } } }, true)).rejects.toThrow(); expect(await counts()).toEqual(before); }
    finally { await pg.exec("DROP TRIGGER reject_second_batch ON manufacturing_batches; DROP FUNCTION reject_second_batch();"); }
  });
  it("serializes bigint counts as decimal strings", () => expect(catalogJson({ remaining: 9223372036854775807n })).toEqual({ remaining: "9223372036854775807" }));
});

describe("complete source accessory and incomplete CircZles", () => {
  async function manifest() {
    const source = JSON.parse(await readFile(new URL("../../docs/circzles-catalog/r1-r2-r3.source.json", import.meta.url), "utf8"));
    source.rows = source.rows.filter((r: { level: string }) => r.level === "NA");
    for (const r of source.rows) source.mappings[r.sourceId] = { newVariantKey: "source-na-" + r.sourceId };
    return source;
  }
  beforeAll(async () => { await catalog.import(await manifest(), true); });
  it("keeps both complete source representations identical at 82 rows and 12001 units", async () => {
    const source = JSON.parse(await readFile(new URL("../../docs/circzles-catalog/r1-r2-r3.source.json", import.meta.url), "utf8"));
    const lines = (await readFile(new URL("../../docs/circzles-catalog/source.tsv", import.meta.url), "utf8")).trimEnd().split(/\r?\n/).slice(1);
    expect(lines).toHaveLength(82);
    expect(lines.map(line => line.split("\t"))).toEqual(source.rows.map((r: Record<string, string>) => [r.name, r.size, r.brand, r.numberIdentifier, r.manufacturingCode, r.level, r.units, r.firstFullSku]));
    expect(source.rows.reduce((sum: number, r: { units: string }) => sum + Number(r.units), 0)).toBe(12001);
  });
  it.each([
    ["Puzzle Saver Board", "CZ-15-R1-NA-0001", "ACCESSORY", "NA", "Cogzart", 500n, "PUZZLE_CODE_ACCESSORY"],
    ["Cupcake", "CC-16-R2-NA-0001", "CIRCZLES", "06", "CircZles", 64n, "PUZZLE_BATCH_INACTIVE"],
    ["Introduction To Circzles", "CC-17-R2-NA-0001", "CIRCZLES", "06", "CircZles", 32n, "PUZZLE_BATCH_INACTIVE"],
    ["Sorcery", "CC-18-R2-NA-0001", "CIRCZLES", "06", "CircZles", 32n, "PUZZLE_BATCH_INACTIVE"],
  ] as const)("imports %s without a playable or claimable ownership path", async (name, sku, productType, size, brand, units, code) => {
    const [b] = await db.select().from(s.manufacturingBatches).where(eq(s.manufacturingBatches.skuPrefix, sku.slice(0, sku.lastIndexOf("-"))));
    const detail = await catalog.detail(b.catalogVariantId);
    expect(detail).toMatchObject({ displayName: name, productType, sizeLabel: size, brand, levelId: null, status: "DRAFT", puzzleId: null });
    expect(b).toMatchObject({ firstFullSku: sku, status: "DRAFT", puzzleId: null, puzzleClaimPrefixId: null, unitsManufactured: units, sourceData: { level: "NA", firstFullSku: sku } });
    const actor = await player(), before = await counts();
    await expect(ownership.claimByCode(actor.id, sku)).rejects.toMatchObject({ code });
    expect(await counts()).toEqual(before);
    if (productType === "CIRCZLES") {
      await expect(catalog.update(b.catalogVariantId, { status: "ACTIVE" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await expect(catalog.editBatch(b.manufacturingBatchId, { status: "ACTIVE" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
    expect(await counts()).toEqual(before);
  });
  it("reruns the restored source rows idempotently without player or gameplay writes", async () => {
    const before = await counts();
    expect(await catalog.import(await manifest(), true)).toMatchObject({ planned: 0, applied: true, skipped: ["15-R1", "16-R2", "17-R2", "18-R2"] });
    expect(await counts()).toEqual(before);
  });
  it("rolls back the complete source import when its final row fails", async () => {
    const scratch = new PGlite();
    try {
      for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql")).sort()) await scratch.exec((await readFile(new URL("../drizzle/" + file, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
      const source = JSON.parse(await readFile(new URL("../../docs/circzles-catalog/r1-r2-r3.source.json", import.meta.url), "utf8"));
      for (const r of source.rows) source.mappings[r.sourceId] = { newVariantKey: "rollback-" + r.sourceId };
      await scratch.exec("CREATE FUNCTION reject_final_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.number_identifier = '82' THEN RAISE EXCEPTION 'test source failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_final_source BEFORE INSERT ON manufacturing_batches FOR EACH ROW EXECUTE FUNCTION reject_final_source();");
      const isolated = new CatalogService(drizzle(scratch, { schema: s }) as unknown as Database);
      await expect(isolated.import(source, true)).rejects.toThrow();
      for (const table of ["catalog_variants", "puzzle_designs", "puzzles", "puzzle_claim_prefixes", "manufacturing_batches", "manufacturing_batch_ranges", "puzzle_claims", "player_puzzles", "game_events"]) expect((await scratch.query("SELECT count(*)::int AS count FROM " + table)).rows).toEqual([{ count: 0 }]);
    } finally { await scratch.close(); }
  }, 20000);
});

describe("server-authorized catalog APIs", { timeout: 20000 }, () => {
  async function setup(role?: "SUPER_ADMIN" | "REVIEWER", active = true, expired = false, production = false) {
    const p = await player(), token = crypto.randomUUID();
    if (role) await db.insert(s.adminUsers).values({ userId: p.userId, role, active });
    await db.insert(s.authSessions).values({ userId: p.userId, tokenHash: hashSessionToken(token, secret), expiresAt: new Date(Date.now() + (expired ? -10000 : 60000)) });
    const app = Fastify(); await app.register(cookie);
    app.setErrorHandler((error, _req, reply) => { if (error instanceof AppError) reply.code(error.statusCode).send({ code: error.code }); else reply.code(500).send({ code: "INTERNAL" }); });
    registerCatalogRoutes(app, { env: { NODE_ENV: production ? "production" : "test", FRONTEND_ORIGIN: "https://hub.example.test", PLAYER_HUB_PROXY_SECRET: "test-proxy-secret" } as Env, adminAuth: new AdminAuthorizationService(new DrizzleAdminAuthorizationRepository(db), secret), catalog });
    await app.ready(); return { app, headers: { cookie: SESSION_COOKIE_NAME + "=" + token } };
  }
  it.each([[undefined, true, false, 403], ["REVIEWER", true, false, 403], ["SUPER_ADMIN", false, false, 403], ["SUPER_ADMIN", true, true, 401]] as const)("denies insufficient or expired roles %#", async (role, active, expired, code) => {
    const { app, headers } = await setup(role, active, expired);
    const uuid = "10000000-0000-4000-8000-000000000001";
    try {
      for (const [method, url] of [["GET", "/api/admin/catalog"], ["GET", "/api/admin/catalog/" + uuid], ["POST", "/api/admin/catalog"], ["PATCH", "/api/admin/catalog/" + uuid], ["POST", "/api/admin/catalog/" + uuid + "/batches"], ["PATCH", "/api/admin/catalog/batches/" + uuid], ["POST", "/api/admin/catalog/batches/" + uuid + "/ranges"], ["POST", "/api/admin/catalog/import/preview"], ["POST", "/api/admin/catalog/import/apply"]] as const) expect((await app.inject({ method, url, headers, ...(method !== "GET" ? { payload: method === "PATCH" && url === "/api/admin/catalog/" + uuid ? { maxLeaderboardTimeMs: 300000 } : {} } : {}) })).statusCode).toBe(code);
    } finally { await app.close(); }
  });
  it("requires a valid session on every route and ignores spoofed browser authority", async () => {
    const { app } = await setup("SUPER_ADMIN"); try { expect((await app.inject({ url: "/api/admin/catalog/access", headers: { "x-admin-role": "SUPER_ADMIN" } })).statusCode).toBe(401); } finally { await app.close(); }
  });
  it("authorizes super admin, validates strict mutations and rejects cross-site requests", async () => {
    const { app, headers } = await setup("SUPER_ADMIN"); try {
      expect((await app.inject({ url: "/api/admin/catalog/access", headers })).json()).toEqual({ allowed: true });
      expect((await app.inject({ method: "POST", url: "/api/admin/catalog", headers: { ...headers, origin: "https://evil.test" }, payload: {} })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url: "/api/admin/catalog", headers, payload: { displayName: "Test", brand: "CircZles", productType: "CIRCZLES", status: "DRAFT", playerId: crypto.randomUUID(), XP: 1000 } })).statusCode).toBe(400);
      const response = await app.inject({ method: "POST", url: "/api/admin/catalog", headers, payload: { displayName: "Secure draft", brand: "CircZles", productType: "CIRCZLES", status: "DRAFT" } }); expect(response.statusCode).toBe(201); expect(response.json().puzzleId).toBeNull();
      expect((await app.inject({ url: "/api/admin/catalog?search=Secure&status=DRAFT", headers })).json()).toHaveLength(1);
    } finally { await app.close(); }
  });
  it("requires the trusted website proxy in production", async () => {
    const { app, headers } = await setup("SUPER_ADMIN", true, false, true); try { expect((await app.inject({ url: "/api/admin/catalog/access", headers })).statusCode).toBe(403); expect((await app.inject({ url: "/api/admin/catalog/access", headers: { ...headers, "x-player-hub-proxy-secret": "test-proxy-secret" } })).statusCode).toBe(200); } finally { await app.close(); }
  });
  it("allows authorized catalog metadata, manufacturing activation, statistics and archival through the APIs", async () => {
    const { app, headers } = await setup("SUPER_ADMIN");
    try {
      const v = await variant();
      const updated = await app.inject({ method: "PATCH", url: "/api/admin/catalog/" + v.catalogVariantId, headers, payload: { displayName: "API Lion" } }); expect(updated.statusCode).toBe(200);
      expect((await app.inject({ method: "PATCH", url: "/api/admin/catalog/" + v.catalogVariantId, headers, payload: { maxLeaderboardTimeMs: 300000 } })).json().maxLeaderboardTimeMs).toBe(300000);
      expect((await app.inject({ method: "PATCH", url: "/api/admin/catalog/" + v.catalogVariantId, headers: { ...headers, origin: "https://evil.test" }, payload: { maxLeaderboardTimeMs: 150000 } })).statusCode).toBe(403);
      const created = await app.inject({ method: "POST", url: "/api/admin/catalog/" + v.catalogVariantId + "/batches", headers, payload: batch({ status: "DRAFT" }) }); expect(created.statusCode).toBe(201);
      const b = created.json();
      expect((await app.inject({ method: "PATCH", url: "/api/admin/catalog/batches/" + b.manufacturingBatchId, headers, payload: { status: "ACTIVE" } })).statusCode).toBe(200);
      await ownership.claimByCode((await player()).id, b.skuPrefix + "-1");
      const details = await app.inject({ url: "/api/admin/catalog/" + v.catalogVariantId, headers }); expect(details.json().batches[0]).toMatchObject({ claimedUnits: "1", remainingUnits: "499" });
      expect((await app.inject({ url: "/api/admin/catalog?search=" + b.skuPrefix, headers })).json()[0].displayName).toBe("API Lion");
      expect((await app.inject({ method: "PATCH", url: "/api/admin/catalog/batches/" + b.manufacturingBatchId, headers, payload: { status: "ARCHIVED" } })).statusCode).toBe(200);
      await expect(ownership.claimByCode((await player()).id, b.skuPrefix + "-2")).rejects.toMatchObject({ code: "PUZZLE_BATCH_INACTIVE" });
    } finally { await app.close(); }
  });
});


describe("catalog leaderboard timing storage", () => {
  it("creates timing-only settings safely, reloads/list displays one time for shared runs, and clears to null", async () => {
    const v = await variant();
    const first = await catalog.addBatch(v.catalogVariantId, batch()), second = await catalog.addBatch(v.catalogVariantId, batch({ manufacturingCode: "R5", skuPrefix: "CC-998-R5-01", numberIdentifier: "998" }));
    const before = await catalog.detail(v.catalogVariantId);
    expect(before.maxLeaderboardTimeMs).toBeNull();
    const queries: string[] = [], transaction = db.transaction.bind(db);
    const spy = vi.spyOn(db, "transaction").mockImplementation(callback => transaction(async tx => {
      const execute = tx.execute.bind(tx);
      vi.spyOn(tx, "execute").mockImplementation(query => { queries.push(typeof query === "string" ? query : new PgDialect().sqlToQuery(query.getSQL()).sql); return execute(query); });
      return callback(tx);
    }));
    try { await catalog.update(v.catalogVariantId, { maxLeaderboardTimeMs: 300000 }); }
    finally { spy.mockRestore(); }
    expect(queries.some(query => query.includes("pg_advisory_xact_lock"))).toBe(true);
    const detail = await new CatalogService(db).detail(v.catalogVariantId);
    expect(detail.maxLeaderboardTimeMs).toBe(300000);
    expect(detail.batches).toEqual(before.batches);
    expect(detail.batches.map(b => b.puzzleId)).toEqual([first.puzzleId, second.puzzleId]);
    expect((await catalog.list({ status: "ACTIVE", search: v.displayName }))[0].maxLeaderboardTimeMs).toBe(300000);
    const [setting] = await db.select().from(s.puzzleCompetitionSettings).where(eq(s.puzzleCompetitionSettings.puzzleId, v.puzzleId!));
    expect(setting).toMatchObject({ category: null, displayOrder: null, leaderboardEnabled: false, rewardEnabled: false, synapseReward: 0, xpReward: 0 });
    expect(await new DrizzleCompetitionSettingsRepository(db).getByPuzzleId(v.puzzleId!)).toBeNull();
    await catalog.update(v.catalogVariantId, { maxLeaderboardTimeMs: null });
    expect((await catalog.detail(v.catalogVariantId)).maxLeaderboardTimeMs).toBeNull();
  });
  it("updates only timing on configured competition rows, preserves rewards/identity, and keeps canonical configurations independent", async () => {
    const v = await variant(), other = await variant({ levelId: 2 });
    const [setting] = await db.insert(s.puzzleCompetitionSettings).values({ puzzleId: v.puzzleId!, category: "SIDE_QUEST", displayOrder: 7, leaderboardEnabled: true, rewardEnabled: true, synapseReward: 123, xpReward: 456, active: false }).returning();
    const before = await db.select().from(s.puzzles).where(eq(s.puzzles.puzzleId, v.puzzleId!));
    await catalog.update(v.catalogVariantId, { maxLeaderboardTimeMs: 150000 });
    await catalog.update(other.catalogVariantId, { maxLeaderboardTimeMs: 45000 });
    expect((await catalog.detail(other.catalogVariantId)).maxLeaderboardTimeMs).toBe(45000);
    expect((await db.select().from(s.puzzleCompetitionSettings).where(eq(s.puzzleCompetitionSettings.puzzleId, v.puzzleId!)))[0]).toEqual({ ...setting, maxLeaderboardTimeMs: 150000 });
    expect(await db.select().from(s.puzzles).where(eq(s.puzzles.puzzleId, v.puzzleId!))).toEqual(before);
    await catalog.update(v.catalogVariantId, { status: "ARCHIVED" });
    expect((await catalog.list({ status: "ARCHIVED", search: v.displayName }))[0]).toMatchObject({ status: "ARCHIVED", maxLeaderboardTimeMs: 150000 });
    await catalog.update(v.catalogVariantId, { maxLeaderboardTimeMs: 300000 });
    expect((await catalog.detail(v.catalogVariantId)).status).toBe("ARCHIVED");
  });
  it.each([0, -1, 1.5, 2147483648, "300000"])("rejects invalid stored timing %s without writes", async time => {
    const v = await variant();
    expect(() => catalog.update(v.catalogVariantId, { maxLeaderboardTimeMs: time })).toThrow();
    expect((await catalog.detail(v.catalogVariantId)).maxLeaderboardTimeMs).toBeNull();
  });
  it("rejects accessories and incomplete drafts, including attempted clear", async () => {
    for (const v of [await variant({ productType: "ACCESSORY", levelId: null, status: "DRAFT" }), await variant({ levelId: null, status: "DRAFT" })]) {
      for (const time of [300000, null]) await expect(catalog.update(v.catalogVariantId, { maxLeaderboardTimeMs: time })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });
  it("enforces database constraints and rolls timing back if the rest of an edit fails", async () => {
    const v = await variant();
    await catalog.addBatch(v.catalogVariantId, batch());
    await expect(catalog.update(v.catalogVariantId, { maxLeaderboardTimeMs: 300000, sizeLabel: "16" })).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
    expect((await catalog.detail(v.catalogVariantId)).maxLeaderboardTimeMs).toBeNull();
    await catalog.update(v.catalogVariantId, { maxLeaderboardTimeMs: 300000 });
    for (const time of [0, -1]) await expect(db.update(s.puzzleCompetitionSettings).set({ maxLeaderboardTimeMs: time }).where(eq(s.puzzleCompetitionSettings.puzzleId, v.puzzleId!))).rejects.toThrow();
    await expect(db.update(s.puzzleCompetitionSettings).set({ leaderboardEnabled: true }).where(eq(s.puzzleCompetitionSettings.puzzleId, v.puzzleId!))).rejects.toThrow();
    expect((await catalog.detail(v.catalogVariantId)).maxLeaderboardTimeMs).toBe(300000);
  });
  it("serializes concurrent timing saves under the existing management lock", async () => {
    const v = await variant();
    await Promise.all([catalog.update(v.catalogVariantId, { maxLeaderboardTimeMs: 150000 }), catalog.update(v.catalogVariantId, { maxLeaderboardTimeMs: 300000 })]);
    expect([150000, 300000]).toContain((await catalog.detail(v.catalogVariantId)).maxLeaderboardTimeMs);
    expect(await db.select().from(s.puzzleCompetitionSettings).where(eq(s.puzzleCompetitionSettings.puzzleId, v.puzzleId!))).toHaveLength(1);
  });
});
