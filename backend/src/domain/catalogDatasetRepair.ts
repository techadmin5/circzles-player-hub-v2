import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { catalogVariants, manufacturingBatches, manufacturingBatchRanges, puzzleDesignAliases, puzzles, puzzleClaimPrefixes } from "../db/schema.js";
import { managementLock } from "./catalog.js";
import { gameplaySignature, normalizeDesign, normalizeSize } from "./catalogIdentity.js";

export const repairInput = z.object({
  datasetId: z.literal("circzles-r1-r2-r3-v1"),
  verifiedRows: z.array(z.object({ sourceId: z.string().min(1).max(200), designFamily: z.string().trim().min(1).max(200), pieceCount: z.number().int().positive().max(1000000) }).strict()).max(82),
}).strict();
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Dependency = { table: string; column: string; count: string };
interface RepairPlanRow {
  batchId: string; skuPrefix: string; currentVariant: string; proposedVariant: string; designFamilyId: string; designFamily: string; pieceCount: number;
  reason: string; claimCount: string; ownershipCount: number; dependencies: Dependency[]; safe: boolean;
}
// Include deleted/history rows and every direct FK, including future tables.
async function dependencies(tx: Tx, puzzleId: string | null, variantId: string): Promise<Dependency[]> {
  const result: Dependency[] = [];
  const refs = await tx.execute<{ table_name: string; column_name: string; target: string }>(sql`
    SELECT c.relname AS table_name, a.attname AS column_name, target.relname AS target
    FROM pg_constraint fk JOIN pg_class c ON c.oid = fk.conrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    JOIN pg_class target ON target.oid = fk.confrelid
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(fk.conkey)
    WHERE fk.contype = 'f' AND ns.nspname = 'public' AND target.relname IN ('puzzles', 'catalog_variants') ORDER BY c.relname, a.attname`);
  for (const ref of refs.rows) {
    if (["catalog_variants", "manufacturing_batches", "puzzle_claim_prefixes"].includes(ref.table_name)) continue;
    const id = ref.target === "puzzles" ? puzzleId : variantId;
    if (!id) continue;
    const counts = await tx.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM ${sql.identifier(ref.table_name)} WHERE ${sql.identifier(ref.column_name)} = ${id}::uuid`);
    result.push({ table: ref.table_name, column: ref.column_name, count: counts.rows[0].count });
  }
  if (puzzleId) {
    const events = await tx.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM game_events WHERE payload::text LIKE ${"%" + puzzleId + "%"} OR source_id = ${puzzleId} OR source_id = ${variantId}`);
    result.push({ table: "game_events", column: "payload", count: events.rows[0].count });
    for (const table of ["xp_transactions", "point_transactions", "inventory_grants", "coupon_ownerships"]) {
      const counts = await tx.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM ${sql.identifier(table)} WHERE source_id::text IN (${puzzleId}, ${variantId})`);
      result.push({ table, column: "source_id", count: counts.rows[0].count });
    }
  }
  return result;
}
export class CatalogDatasetRepair {
  constructor(private db: Database) {}
  async reconcile(input: unknown, options: { apply?: boolean; expectedPreview?: string } = {}) {
    const verified = repairInput.parse(input);
    return this.db.transaction(async tx => {
      await managementLock(tx);
      // Maintenance operation: prevent claims/dependency creation racing checks.
      // Preview does not acquire these write-blocking table locks.
      if (options.apply) {
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        await tx.execute(sql`LOCK TABLE puzzles, catalog_variants, manufacturing_batches, manufacturing_batch_ranges, puzzle_claim_prefixes, puzzle_design_aliases, game_events, xp_transactions, point_transactions, inventory_grants, coupon_ownerships IN ACCESS EXCLUSIVE MODE`);
      }
      const all = await tx.select().from(manufacturingBatches).orderBy(manufacturingBatches.skuPrefix);
      const selected = all.filter(b => b.importKey === JSON.stringify([verified.datasetId, b.sourceData?.sourceId]));
      const issues: string[] = [];
      if (selected.length !== 82 || selected.reduce((n, b) => n + b.unitsManufactured, 0n) !== 12001n) issues.push("Dataset must contain exactly 82 batches / 12,001 units. Investigate rather than repairing a partial or altered dataset.");
      const evidence = new Map(verified.verifiedRows.map(r => [r.sourceId, r]));
      if (evidence.size !== verified.verifiedRows.length) issues.push("Duplicate verified source IDs.");
      for (const id of evidence.keys()) if (!selected.some(b => b.sourceData?.sourceId === id)) issues.push("Verified source ID is outside this dataset: " + id);
      const variants = await tx.select().from(catalogVariants).orderBy(catalogVariants.catalogVariantId);
      const playable = await tx.select().from(puzzles).orderBy(puzzles.puzzleId);
      const aliases = await tx.select().from(puzzleDesignAliases).orderBy(puzzleDesignAliases.normalizedAlias);
      const rangeSnapshot = await tx.select().from(manufacturingBatchRanges).orderBy(manufacturingBatchRanges.manufacturingBatchRangeId);
      const prefixSnapshot = await tx.select().from(puzzleClaimPrefixes).orderBy(puzzleClaimPrefixes.puzzleClaimPrefixId);
      const groups = new Map<string, typeof selected>();
      const details = new Map<string, Dependency[]>();
      for (const batch of selected) {
        const variant = variants.find(v => v.catalogVariantId === batch.catalogVariantId)!;
        if (!details.has(variant.catalogVariantId)) details.set(variant.catalogVariantId, await dependencies(tx, variant.puzzleId, variant.catalogVariantId));
        const row = evidence.get(batch.sourceData!.sourceId);
        if (batch.productType === "ACCESSORY" || variant.levelId === null) continue;
        if (!row) { issues.push("Verified design family and piece count required: " + batch.skuPrefix); continue; }
        const puzzle = playable.find(p => p.puzzleId === variant.puzzleId);
        if (!puzzle || puzzle.deletedAt || puzzle.puzzleDesignId !== variant.puzzleDesignId || normalizeSize(puzzle.sizeLabel ?? "") !== normalizeSize(variant.sizeLabel ?? "") || Number(puzzle.levelId) !== Number(variant.levelId) || (puzzle.pieceCount !== null && puzzle.pieceCount !== row.pieceCount) || normalizeSize(variant.sizeLabel ?? "") !== normalizeSize(batch.sourceData!.size) || Number(variant.levelId) !== Number(batch.sourceData!.level) || (variant.pieceCount !== null && variant.pieceCount !== row.pieceCount)) { issues.push("Gameplay/evidence conflict: " + batch.skuPrefix); continue; }
        const key = gameplaySignature(normalizeDesign(row.designFamily), { size: variant.sizeLabel!, level: variant.levelId!, pieceCount: row.pieceCount });
        groups.set(key, [...(groups.get(key) ?? []), batch]);
      }
      const plan: RepairPlanRow[] = [];
      const familyIds = new Map<string, string>();
      const aliasFamilies = new Map<string, string>();
      for (const group of groups.values()) {
        const target = variants.find(v => v.catalogVariantId === group[0].catalogVariantId)!;
        const evidenceRow = evidence.get(group[0].sourceData!.sourceId)!;
        const familyName = normalizeDesign(evidenceRow.designFamily);
        if (!familyIds.has(familyName)) familyIds.set(familyName, aliases.find(a => a.normalizedAlias === familyName)?.puzzleDesignId ?? target.puzzleDesignId);
        const family = familyIds.get(familyName)!;
        for (const b of group) {
          const aliasKey = normalizeDesign(b.sourceData!.name);
          if (aliasFamilies.has(aliasKey) && aliasFamilies.get(aliasKey) !== family) issues.push("One display alias cannot identify multiple design families: " + b.sourceData!.name);
          aliasFamilies.set(aliasKey, family);
          const priorAlias = aliases.find(a => a.normalizedAlias === normalizeDesign(b.sourceData!.name));
          if (priorAlias && priorAlias.puzzleDesignId !== family) issues.push("Alias belongs to another confirmed design family: " + b.sourceData!.name);
        }
        const conflicting = variants.filter(v => v.productType === "CIRCZLES" && v.status !== "ARCHIVED" && v.catalogVariantId !== target.catalogVariantId && v.puzzleDesignId === family && normalizeSize(v.sizeLabel ?? "") === normalizeSize(target.sizeLabel ?? "") && Number(v.levelId) === Number(target.levelId) && v.pieceCount === evidenceRow.pieceCount && !group.some(b => b.catalogVariantId === v.catalogVariantId));
        if (conflicting.length) issues.push("An existing configuration outside this group requires explicit historical reconciliation: " + familyName);
        for (const batch of group) {
          const current = variants.find(v => v.catalogVariantId === batch.catalogVariantId)!;
          const deps = details.get(current.catalogVariantId)!;
          const claims = await tx.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM puzzle_claims WHERE puzzle_claim_prefix_id = ${batch.puzzleClaimPrefixId}::uuid`);
          const unrelated = all.some(b => b.catalogVariantId === current.catalogVariantId && !group.some(g => g.manufacturingBatchId === b.manufacturingBatchId));
          const prefixRows = current.puzzleId ? await tx.select().from(puzzleClaimPrefixes).where(eq(puzzleClaimPrefixes.puzzleId, current.puzzleId)) : [];
          const orphanPrefix = prefixRows.some(p => !group.some(b => b.puzzleClaimPrefixId === p.puzzleClaimPrefixId));
          const prefix = prefixRows.find(p => p.puzzleClaimPrefixId === batch.puzzleClaimPrefixId);
          const unsafe = claims.rows[0].count !== "0" || deps.some(d => d.count !== "0") || unrelated || orphanPrefix || !current.puzzleId || !target.puzzleId || current.status !== target.status || !prefix || prefix.normalizedPrefix !== batch.skuPrefix || batch.puzzleId !== current.puzzleId;
          if (unsafe) issues.push("Claims, ownership/history, foreign batches, prefixes or status make this identity unsafe: " + batch.skuPrefix);
          plan.push({ batchId: batch.manufacturingBatchId, skuPrefix: batch.skuPrefix, currentVariant: current.catalogVariantId, proposedVariant: target.catalogVariantId, designFamilyId: family, designFamily: evidenceRow.designFamily, pieceCount: evidenceRow.pieceCount,
            reason: "Verified same design, size, level and pieces; manufacturing identity remains separate.", claimCount: claims.rows[0].count, ownershipCount: deps.filter(d => d.table === "player_puzzles").reduce((n, d) => n + Number(d.count), 0), dependencies: deps, safe: !unsafe });
        }
      }
      // Snapshot includes manufacturing evidence and catalog metadata, not only moves.
      const previewHash = createHash("sha256").update(JSON.stringify({ verified, selected, variants: variants.filter(v => selected.some(b => b.catalogVariantId === v.catalogVariantId)), playable: playable.filter(p => selected.some(b => b.puzzleId === p.puzzleId)), aliases, ranges: rangeSnapshot.filter(r => selected.some(b => b.manufacturingBatchId === r.manufacturingBatchId)), prefixes: prefixSnapshot.filter(p => selected.some(b => b.puzzleClaimPrefixId === p.puzzleClaimPrefixId)), plan, issues }, (_k, v) => typeof v === "bigint" ? v.toString() : v)).digest("hex");
      if (options.apply) {
        if (!options.expectedPreview || options.expectedPreview !== previewHash) throw new Error("Repair requires the exact reviewed preview hash; preview again after any change.");
        if (issues.length) throw new Error("Repair blocked: " + issues.join("; "));
        for (const item of plan) {
          const target = variants.find(v => v.catalogVariantId === item.proposedVariant)!;
          await tx.update(catalogVariants).set({ puzzleDesignId: item.designFamilyId, pieceCount: item.pieceCount, updatedAt: new Date() }).where(eq(catalogVariants.catalogVariantId, target.catalogVariantId));
          await tx.update(puzzles).set({ puzzleDesignId: item.designFamilyId, pieceCount: item.pieceCount, updatedAt: new Date() }).where(eq(puzzles.puzzleId, target.puzzleId!));
          const original = selected.find(b => b.manufacturingBatchId === item.batchId)!;
          if (item.currentVariant !== item.proposedVariant) {
            await tx.update(manufacturingBatches).set({ catalogVariantId: target.catalogVariantId, puzzleId: target.puzzleId, updatedAt: new Date() }).where(eq(manufacturingBatches.manufacturingBatchId, item.batchId));
            await tx.update(puzzleClaimPrefixes).set({ puzzleId: target.puzzleId!, updatedAt: new Date() }).where(eq(puzzleClaimPrefixes.puzzleClaimPrefixId, original.puzzleClaimPrefixId!));
          }
          for (const alias of [item.designFamily, original.sourceData!.name]) {
            const key = normalizeDesign(alias), prior = aliases.find(a => a.normalizedAlias === key);
            if (prior && prior.puzzleDesignId !== item.designFamilyId) throw new Error("Alias belongs to a different confirmed design; explicit alias reconciliation required: " + alias);
            await tx.insert(puzzleDesignAliases).values({ normalizedAlias: key, displayAlias: alias.trim(), puzzleDesignId: item.designFamilyId }).onConflictDoNothing();
          }
        }
        const targets = new Set(plan.map(p => p.proposedVariant));
        for (const id of new Set(plan.map(p => p.currentVariant))) if (!targets.has(id)) {
          const [remaining] = await tx.select().from(manufacturingBatches).where(eq(manufacturingBatches.catalogVariantId, id));
          const original = variants.find(v => v.catalogVariantId === id)!;
          if (remaining || (await dependencies(tx, original.puzzleId, id)).some(d => d.count !== "0")) throw new Error("Duplicate still has dependencies; aborting archive.");
          const prefixes = original.puzzleId ? await tx.select().from(puzzleClaimPrefixes).where(eq(puzzleClaimPrefixes.puzzleId, original.puzzleId)) : [];
          if (prefixes.length) throw new Error("Duplicate still has registered prefixes; aborting archive.");
          await tx.update(catalogVariants).set({ status: "ARCHIVED", updatedAt: new Date() }).where(eq(catalogVariants.catalogVariantId, id));
          if (original.puzzleId) await tx.update(puzzles).set({ status: "ARCHIVED", updatedAt: new Date() }).where(eq(puzzles.puzzleId, original.puzzleId));
        }
      }
      const unchangedBatches = selected.filter(b => !plan.some(p => p.batchId === b.manufacturingBatchId)).map(b => ({ batchId: b.manufacturingBatchId, skuPrefix: b.skuPrefix, currentVariant: b.catalogVariantId, proposedVariant: b.catalogVariantId, reason: b.productType === "ACCESSORY" ? "Accessory remains catalog-only." : "Incomplete draft remains separate, or verified evidence is missing; see issues.", dependencies: details.get(b.catalogVariantId) }));
      return { applied: !!options.apply, ready: !issues.length, datasetId: verified.datasetId, rows: selected.length, manufacturedUnits: selected.reduce((n, b) => n + b.unitsManufactured, 0n).toString(), previewHash, issues, plan, unchangedBatches };
    });
  }
}
