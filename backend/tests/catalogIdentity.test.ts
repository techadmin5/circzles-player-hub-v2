import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import * as s from "../src/db/schema.js";
import type { Database } from "../src/db/client.js";
import { CatalogService } from "../src/domain/catalog.js";
import { CatalogDatasetRepair } from "../src/domain/catalogDatasetRepair.js";
import { normalizeDesign, proposeIdentities, type IdentityRow, type IdentityContext } from "../src/domain/catalogIdentity.js";
import { repairArguments } from "../src/cli/reconcileCatalogDataset.js";
import { DrizzlePuzzleRepository, PuzzleOwnershipService } from "../src/domain/puzzles.js";

const empty: IdentityContext = { aliases: [], designs: [], variants: [] };
const row = (sourceId: string, changes: Partial<IdentityRow> = {}): IdentityRow => ({ sourceId, name: "Lion", size: "12", level: "01", pieceCount: 37, productType: "CIRCZLES", ...changes });
describe("verified canonical identity signatures", () => {
  it("shares Lion R2/R3, ignoring manufacturing run and presentation whitespace/case", () => {
    const plan = proposeIdentities([row("29-R2"), row("61-R3", { name: "  LION  ", size: "012", level: "1" })], empty);
    expect(plan.map(p => p.state)).toEqual(["AUTO-SHARED", "AUTO-SHARED"]); expect(plan[0].decision).toEqual(plan[1].decision);
    expect(normalizeDesign("  A   Design  ")).toBe("a design");
  });
  it.each([{ size: "16" }, { level: "02" }, { pieceCount: 61 }])("separates a different size/level/piece configuration %j", changes => {
    const plan = proposeIdentities([row("a"), row("b", changes)], empty); expect(plan[0].decision).not.toEqual(plan[1].decision);
  });
  it("Metamorphosis R1 is separate and R2/R3 share", () => {
    const plan = proposeIdentities([row("07-R1", { name: "Metamorphosis", size: "10", level: "13", pieceCount: 127 }), row("22-R2", { name: "Metamorphosis", size: "10", level: "02" }), row("48-R3", { name: "metamorphosis", size: "10", level: "02" })], empty);
    expect(plan[0].decision).not.toEqual(plan[1].decision); expect(plan[1].decision).toEqual(plan[2].decision);
  });
  it("L.S.Tree R1/R2 remain separate", () => {
    const plan = proposeIdentities([row("13-R1", { name: "L.S.Tree", level: "15", pieceCount: 169 }), row("27-R2", { name: "L.S.Tree", level: "08", pieceCount: 91 })], empty);
    expect(plan[0].decision).not.toEqual(plan[1].decision);
  });
  it("confirmed spelling aliases share while fuzzy/unconfirmed spellings never merge", () => {
    const confirmed = { ...empty, aliases: [{ normalizedAlias: "peacock", puzzleDesignId: "design" }, { normalizedAlias: "peocock", puzzleDesignId: "design" }] };
    expect(proposeIdentities([row("a", { name: "Peacock" }), row("b", { name: "Peocock" })], confirmed)[0].decision).toEqual(proposeIdentities([row("a", { name: "Peacock" }), row("b", { name: "Peocock" })], confirmed)[1].decision);
    const unconfirmed = proposeIdentities([row("a", { name: "Peacock" }), row("b", { name: "Peocock" })], empty);
    expect(unconfirmed.every(p => p.state === "NEEDS-REVIEW" && !p.decision)).toBe(true);
  });
  it("explicit canonical design column overrides the display name hint", () => {
    const plan = proposeIdentities([row("a", { name: "Different title", canonicalDesign: "Lion" }), row("b")], empty); expect(plan[0].decision).toEqual(plan[1].decision);
  });
  it("missing verified pieces on either side requires review without inventing a level tier", () => {
    const plan = proposeIdentities([row("a"), row("b", { pieceCount: undefined })], empty); expect(plan.every(p => p.state === "NEEDS-REVIEW" && !p.decision)).toBe(true);
  });
  it("historical unconfirmed names and conflicting existing variants require review", () => {
    expect(proposeIdentities([row("a")], { ...empty, designs: [{ puzzleDesignId: "legacy", name: "Lion" }] })[0].state).toBe("NEEDS-REVIEW");
    const variant = { catalogVariantId: "v", puzzleDesignId: "d", sizeLabel: "12", levelId: "1", pieceCount: 37, productType: "CIRCZLES", status: "ACTIVE" };
    const context = { ...empty, aliases: [{ normalizedAlias: "lion", puzzleDesignId: "d" }], variants: [variant, { ...variant, catalogVariantId: "other" }] };
    expect(proposeIdentities([row("a")], context)[0].state).toBe("NEEDS-REVIEW");
    expect(proposeIdentities([row("a")], { ...context, variants: [{ ...variant, pieceCount: null }] })[0].state).toBe("NEEDS-REVIEW");
  });
  it("NA drafts and accessories do not become shared playable identities", () => {
    const plan = proposeIdentities([row("a", { level: "NA" }), row("b", { level: "NA" }), row("c", { productType: "ACCESSORY" })], empty);
    expect(new Set(plan.map(p => p.decision?.newVariantKey)).size).toBe(3);
  });
  it("operator CLI defaults to preview and rejects unreviewed apply flags", () => {
    expect(repairArguments(["--plan", "evidence.json"]).apply).toBe(false);
    expect(() => repairArguments(["--plan", "evidence.json", "--apply"])).toThrow();
    expect(() => repairArguments(["--plan", "evidence.json", "--apply", "--expected-preview", "no"])).toThrow();
  });
});

async function isolated() {
  const pg = new PGlite();
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(f => f.endsWith(".sql")).sort()) await pg.exec((await readFile(new URL("../drizzle/" + file, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  const db = drizzle(pg, { schema: s }) as unknown as Database;
  return { pg, db, catalog: new CatalogService(db) };
}
let store: Awaited<ReturnType<typeof isolated>>;
beforeAll(async () => { store = await isolated(); }, 60000);
afterAll(async () => { await store.pg.close(); });
function source(id: string, run: string, name: string, pieces = 37) {
  return { sourceId: id + "-" + run, name, size: "12", brand: "CircZles", numberIdentifier: id, manufacturingCode: run, level: "01", units: "20", firstFullSku: `CC-${id}-${run}-01-0001`, pieceCount: pieces, productType: "CIRCZLES" };
}
describe("persistent families and concurrent catalog creation", () => {
  it("resumes an explicit complete shared key and rejects separate keys for an identical new signature", async () => {
    const rows = [source("220", "R2", "Resumed Panda"), source("221", "R3", "Resumed Panda")];
    const mappings = Object.fromEntries(rows.map(r => [r.sourceId, { newVariantKey: "shared" }]));
    const conflict = await store.catalog.import({ datasetId: "resumed", rows, mappings: { [rows[0].sourceId]: { newVariantKey: "one" }, [rows[1].sourceId]: { newVariantKey: "two" } } });
    expect(conflict.ready).toBe(false);
    await store.catalog.import({ datasetId: "resumed", rows: [rows[0]], mappings }, true);
    expect(await store.catalog.import({ datasetId: "resumed", rows: [...rows].reverse(), mappings }, true)).toMatchObject({ applied: true, planned: 1 });
    expect(await store.catalog.import({ datasetId: "resumed", rows, mappings }, true)).toMatchObject({ applied: true, planned: 0 });
  });
  it("manual duplicate create returns the existing variant for the batch flow, while different pieces remain separate", async () => {
    const input = { displayName: "Manual Lion", brand: "CircZles", productType: "CIRCZLES" as const, sizeLabel: "12", levelId: 1, pieceCount: 37, status: "ACTIVE" as const };
    const first = await store.catalog.create(input), second = await store.catalog.create({ ...input, puzzleDesignId: first.puzzleDesignId });
    expect(second).toMatchObject({ catalogVariantId: first.catalogVariantId, existingCanonical: true });
    expect((await store.catalog.create({ ...input, pieceCount: 61, puzzleDesignId: first.puzzleDesignId })).catalogVariantId).not.toBe(first.catalogVariantId);
  });
  it("concurrent complete creation is serialized and nullable drafts remain separate", async () => {
    const input = { displayName: "Concurrent Lion", brand: "CircZles", productType: "CIRCZLES" as const, sizeLabel: "12", levelId: 1, pieceCount: 37, status: "ACTIVE" as const };
    const created = await Promise.all([store.catalog.create(input), store.catalog.create(input)]); expect(created[0].catalogVariantId).toBe(created[1].catalogVariantId);
    const drafts = await Promise.all([store.catalog.create({ ...input, levelId: null, status: "DRAFT" }), store.catalog.create({ ...input, levelId: null, status: "DRAFT" })]); expect(drafts[0].catalogVariantId).not.toBe(drafts[1].catalogVariantId);
  });
  it("confirmed aliases persist across R4/R5 imports and shared manufacturing does not duplicate player ownership", async () => {
    const rows = [source("200", "R2", "Persistent Peacock"), source("201", "R3", "Persistent Peacock")];
    const proposed = await store.catalog.propose({ rows });
    const mappings = Object.fromEntries(proposed.proposals.map(p => [p.sourceId, p.decision]));
    expect(await store.catalog.import({ datasetId: "persistent", rows, mappings }, true)).toMatchObject({ applied: true });
    const variant = (await store.catalog.list({ search: "Persistent Peacock" }))[0];
    await store.catalog.confirmAlias({ puzzleDesignId: variant.puzzleDesignId, alias: "Persistent Peocock" });
    const later = [source("202", "R4", "Persistent Peocock"), source("203", "R5", "Persistent Peacock")];
    const plan = await store.catalog.propose({ rows: later }); expect(plan.proposals.every(p => p.decision?.catalogVariantId === variant.catalogVariantId)).toBe(true);
    await store.catalog.import({ datasetId: "later", rows: later, mappings: Object.fromEntries(plan.proposals.map(p => [p.sourceId, p.decision])) }, true);
    const ownership = new PuzzleOwnershipService(new DrizzlePuzzleRepository(store.db));
    const createPlayer = async () => { const [user] = await store.db.insert(s.users).values({}).returning(); const [p] = await store.db.insert(s.players).values({ userId: user.userId, displayName: "Test", publicPlayerId: crypto.randomUUID() }).returning(); return p.playerId; };
    const player = await createPlayer(); await ownership.claimByCode(player, rows[0].firstFullSku);
    await expect(ownership.claimByCode(player, later[0].firstFullSku)).rejects.toMatchObject({ code: "PUZZLE_ALREADY_OWNED" });
    expect((await ownership.claimByCode(await createPlayer(), later[0].firstFullSku)).puzzle.id).toBe(variant.puzzleId);
    const detail = await store.catalog.detail(variant.catalogVariantId); expect(detail.batches).toHaveLength(4); expect(new Set(detail.batches.map(b => b.skuPrefix)).size).toBe(4);
    const renamed = { ...source("205", "R6", "Verified Peacock rename"), canonicalDesign: "Persistent Peacock" };
    await store.catalog.import({ datasetId: "verified-rename", rows: [renamed], mappings: { [renamed.sourceId]: { catalogVariantId: variant.catalogVariantId } } }, true);
    expect((await store.catalog.propose({ rows: [source("206", "R7", "Verified Peacock rename")] })).proposals[0].decision?.catalogVariantId).toBe(variant.catalogVariantId);
    await expect(store.catalog.confirmAlias({ puzzleDesignId: crypto.randomUUID(), alias: "bad" })).rejects.toThrow();
  });
});

// Verified synthetic test evidence only; production never derives pieces from level.
const testPieces: Record<string, number> = { "0.5": 37, "1": 37, "2": 37, "3": 37, "3.5": 37, "4": 61, "5": 61, "6": 61, "7": 91, "8": 91, "9": 91, "10": 91, "11": 127, "12": 127, "13": 127, "14": 169, "15": 169, "16": 169, "17": 217, "18": 217, "19": 217, "20": 271, "21": 271, "22": 331, "23": 331, "24": 397, "25": 469 };
async function repairFixture() {
  const fixture = await isolated();
  const manifest = JSON.parse(await readFile(new URL("../../docs/circzles-catalog/r1-r2-r3.source.json", import.meta.url), "utf8"));
  manifest.mappings = Object.fromEntries(manifest.rows.map((r: IdentityRow) => [r.sourceId, { newVariantKey: r.sourceId }]));
  await fixture.catalog.import(manifest, true);
  // Reproduce 0024 being added after the old production import: no guessed aliases.
  await fixture.pg.exec("DELETE FROM puzzle_design_aliases");
  const verifiedRows = manifest.rows.filter((r: IdentityRow) => r.productType === "CIRCZLES" && r.level !== "NA").map((r: IdentityRow) => ({ sourceId: r.sourceId, designFamily: normalizeDesign(r.name).replace("colorstom", "colorstrom").replace("peocock", "peacock"), pieceCount: testPieces[String(Number(r.level))] }));
  return { ...fixture, evidence: { datasetId: "circzles-r1-r2-r3-v1", verifiedRows }, repair: new CatalogDatasetRepair(fixture.db), manifest };
}
describe("operator-only dataset reconciliation", () => {
  it("previews and atomically repairs unclaimed duplicates, preserving source fingerprints/ranges and legacy variants", async () => {
    const fixture = await repairFixture();
    try {
      const [design] = await fixture.db.insert(s.puzzleDesigns).values({ name: "Metamorphosis" }).returning();
      const [legacy] = await fixture.db.insert(s.puzzles).values({ name: "Metamorphosis", puzzleDesignId: design.puzzleDesignId, levelId: 13, pieceCount: 127, sizeLabel: "10" }).returning();
      const before = await fixture.db.select().from(s.manufacturingBatches);
      const ranges = await fixture.db.select().from(s.manufacturingBatchRanges);
      const preview = await fixture.repair.reconcile(fixture.evidence);
      expect(preview).toMatchObject({ applied: false, ready: true, rows: 82, manufacturedUnits: "12001", issues: [] });
      expect(preview.plan.some(p => p.currentVariant !== p.proposedVariant)).toBe(true);
      expect(await fixture.db.select().from(s.manufacturingBatches)).toEqual(before);
      await expect(fixture.repair.reconcile(fixture.evidence, { apply: true })).rejects.toThrow("preview hash");
      await fixture.pg.exec("CREATE FUNCTION fail_repair_prefix() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic repair failure'; END $$; CREATE TRIGGER fail_repair_prefix BEFORE UPDATE ON puzzle_claim_prefixes FOR EACH ROW EXECUTE FUNCTION fail_repair_prefix();");
      await expect(fixture.repair.reconcile(fixture.evidence, { apply: true, expectedPreview: preview.previewHash })).rejects.toThrow();
      expect(await fixture.db.select().from(s.manufacturingBatches)).toEqual(before);
      expect((await fixture.db.select().from(s.catalogVariants)).some(v => v.status === "ARCHIVED")).toBe(false);
      await fixture.pg.exec("DROP TRIGGER fail_repair_prefix ON puzzle_claim_prefixes; DROP FUNCTION fail_repair_prefix();");
      const applied = await fixture.repair.reconcile(fixture.evidence, { apply: true, expectedPreview: preview.previewHash }); expect(applied.applied).toBe(true);
      const after = await fixture.db.select().from(s.manufacturingBatches);
      for (const b of before) { const next = after.find(n => n.manufacturingBatchId === b.manufacturingBatchId)!; expect({ ...next, catalogVariantId: b.catalogVariantId, puzzleId: b.puzzleId, updatedAt: b.updatedAt }).toEqual(b); }
      expect(await fixture.db.select().from(s.manufacturingBatchRanges)).toEqual(ranges);
      const find = (prefix: string) => after.find(b => b.skuPrefix === prefix)!;
      expect(find("CC-29-R2-01").catalogVariantId).toBe(find("CC-61-R3-01").catalogVariantId);
      expect(find("CC-22-R2-02").catalogVariantId).toBe(find("CC-48-R3-02").catalogVariantId);
      expect(find("CC-07-R1-13").catalogVariantId).not.toBe(find("CC-22-R2-02").catalogVariantId);
      expect(find("CC-13-R1-15").catalogVariantId).not.toBe(find("CC-27-R2-08").catalogVariantId);
      expect((await fixture.db.select().from(s.puzzles).where(eq(s.puzzles.puzzleId, legacy.puzzleId)))[0]).toEqual(legacy);
      expect((await fixture.db.select().from(s.catalogVariants)).some(v => v.status === "ARCHIVED")).toBe(true);
      expect((await fixture.catalog.propose({ rows: [source("204", "R4", "Lion")] })).proposals[0].decision?.catalogVariantId).toBe(find("CC-29-R2-01").catalogVariantId);
      expect(await fixture.catalog.import(fixture.manifest, true)).toMatchObject({ planned: 0, applied: true });
    } finally { await fixture.pg.close(); }
  }, 60000);
  it("refuses a stale preview, claimed identities, missing evidence and ownership/history, with no partial writes", async () => {
    const fixture = await repairFixture();
    try {
      const preview = await fixture.repair.reconcile(fixture.evidence);
      const ownership = new PuzzleOwnershipService(new DrizzlePuzzleRepository(fixture.db));
      const [user] = await fixture.db.insert(s.users).values({}).returning(); const [p] = await fixture.db.insert(s.players).values({ userId: user.userId, displayName: "Test", publicPlayerId: "repair-test" }).returning();
      await ownership.claimByCode(p.playerId, "CC-61-R3-01-0001");
      const before = await fixture.db.select().from(s.manufacturingBatches);
      await expect(fixture.repair.reconcile(fixture.evidence, { apply: true, expectedPreview: preview.previewHash })).rejects.toThrow("preview");
      const unsafe = await fixture.repair.reconcile(fixture.evidence); expect(unsafe.ready).toBe(false); expect(unsafe.plan.find(p => p.skuPrefix === "CC-61-R3-01")).toMatchObject({ safe: false, claimCount: "1", ownershipCount: 1 });
      await expect(fixture.repair.reconcile(fixture.evidence, { apply: true, expectedPreview: unsafe.previewHash })).rejects.toThrow("blocked");
      expect(await fixture.db.select().from(s.manufacturingBatches)).toEqual(before);
      expect((await fixture.repair.reconcile({ ...fixture.evidence, verifiedRows: [] })).ready).toBe(false);
      const unclaimed = before.find(b => b.skuPrefix === "CC-44-R3-19")!;
      await fixture.db.insert(s.playerPuzzles).values({ playerId: p.playerId, puzzleId: unclaimed.puzzleId!, source: "ADMIN", deletedAt: new Date() });
      const history = await fixture.repair.reconcile(fixture.evidence);
      expect(history.plan.find(p => p.skuPrefix === unclaimed.skuPrefix)).toMatchObject({ safe: false, claimCount: "0", ownershipCount: 1 });
      expect(history.plan[0].dependencies.map(d => d.table)).toEqual(expect.arrayContaining(["submissions", "leaderboard_entries", "player_puzzles"]));
    } finally { await fixture.pg.close(); }
  }, 60000);
});
