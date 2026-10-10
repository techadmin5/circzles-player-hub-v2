import { createHash } from "node:crypto";
import { getTableColumns, and, eq, ne, lt, gt, lte, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { catalogVariants as variants, manufacturingBatches as batches, manufacturingBatchRanges as ranges, puzzles, puzzleDesigns, puzzleDesignAliases, puzzleClaimPrefixes, puzzleClaims, playerPuzzles, puzzleCompetitionSettings as competition } from "../db/schema.js";
import { gameplaySignature, normalizeDesign, normalizeSize, proposeIdentities, type IdentityContext } from "./catalogIdentity.js";
import { AppError, validationFailed } from "./errors.js";
import { parseClaimCode } from "./puzzles.js";
import { PLAYER_STATE_CHANNEL } from "./playerStateEvents.js";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
const status = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);
const productType = z.enum(["CIRCZLES", "ACCESSORY"]);
const short = z.string().trim().min(1).max(200);
const brand = z.string().min(1).max(200).refine(value => value.trim().length > 0, "Brand is required");
const serial = z.string().regex(/^[0-9]{1,19}$/).refine(v => /^[0-9]{1,19}$/.test(v) && BigInt(v) > 0n && BigInt(v) <= 9223372036854775807n, "Serial must fit a positive PostgreSQL bigint");
const level = z.number().positive().max(999.9).refine(v => Math.abs(v * 10 - Math.round(v * 10)) < 1e-8, "Use at most one decimal place");
const image = z.string().max(2000).refine(v => {
  if (!v || /^\/(?!\/)/.test(v)) return true;
  try { const url = new URL(v); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}, "Use a local path or HTTPS image");
export const variantInput = z.object({
  displayName: short, designName: short.optional(), puzzleDesignId: z.string().uuid().optional(), brand, productType,
  sizeLabel: short.nullable().optional(), pieceCount: z.number().int().positive().max(1000000).nullable().optional(),
  levelId: level.nullable().optional(), image: image.optional(), description: z.string().max(10000).optional(),
  marketingMetadata: z.record(z.string().max(100), z.string().max(2000)).optional(), status: status.default("DRAFT"),
}).strict();
export const variantPatch = variantInput.omit({ puzzleDesignId: true, productType: true, status: true }).partial().extend({ status: status.optional(), maxLeaderboardTimeMs: z.number().int().positive().max(2147483647).nullable().optional() }).strict();
export const batchInput = z.object({
  numberIdentifier: z.string().regex(/^[0-9]{1,20}$/), manufacturingCode: z.string().regex(/^R[1-9][0-9]{0,8}$/),
  skuPrefix: short, firstFullSku: short.optional(), serialStart: serial, serialEnd: serial, unitsManufactured: serial,
  status: status.default("DRAFT"),
}).strict();
export const rangeInput = z.object({ serialStart: serial, serialEnd: serial }).strict();
const batchCorrection = batchInput.extend({ catalogVariantId: z.string().uuid().optional() }).strict();
export type VariantInput = z.input<typeof variantInput>;
export type BatchInput = z.input<typeof batchInput>;
const conflict = (message: string) => new AppError("CATALOG_CONFLICT", message, 409);
const missing = () => new AppError("CATALOG_NOT_FOUND", "CircZles catalog entry was not found.", 404);
function read<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw validationFailed("Invalid CircZles catalog request.", result.error.flatten());
  return result.data;
}
export function validateBatch(input: unknown, variant: Pick<typeof variants.$inferSelect, "levelId" | "productType">) {
  const value = read(batchInput, input);
  const start = BigInt(value.serialStart), end = BigInt(value.serialEnd), units = BigInt(value.unitsManufactured);
  if (end < start || end - start + 1n !== units) throw validationFailed("Units must equal the inclusive manufactured serial range.");
  const parts = value.skuPrefix.split("-");
  if (parts.length !== 4 || parts[0] !== (variant.productType === "CIRCZLES" ? "CC" : "CZ") || parts[1] !== value.numberIdentifier || parts[2] !== value.manufacturingCode || !/^(?:[0-9]+(?:\.[0-9])?|NA)$/.test(parts[3])) throw validationFailed("SKU must preserve family, number identifier, manufacturing run and level.");
  if (parts[3] !== "NA" && (Number(parts[3]) <= 0 || Number(parts[3]) > 999.9)) throw validationFailed("SKU gameplay level must be positive or explicitly NA for a draft.");
  if (variant.levelId !== null && Number(parts[3]) !== Number(variant.levelId)) throw validationFailed("SKU level does not match the canonical CircZles level.");
  if (variant.productType === "CIRCZLES" && value.status === "ACTIVE" && (variant.levelId === null || parts[3] === "NA")) throw validationFailed("Complete the gameplay level before activating this batch.");
  if (value.firstFullSku) {
    const first = parseClaimCode(value.firstFullSku);
    if (first.normalizedPrefix !== value.skuPrefix || first.serialNumber !== start) throw validationFailed("First full SKU must match its prefix and serial start.");
  }
  return { ...value, serialStart: start, serialEnd: end, unitsManufactured: units };
}
export function catalogJson(value: unknown): unknown { return JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item)); }
export async function managementLock(tx: Tx) { await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('circzles.catalog.management'))`); }
export async function identityContext(tx: Tx | Database): Promise<IdentityContext> {
  const designs = await tx.select().from(puzzleDesigns).where(isNull(puzzleDesigns.deletedAt));
  return { aliases: (await tx.select().from(puzzleDesignAliases)).filter(a => designs.some(d => d.puzzleDesignId === a.puzzleDesignId)), designs, variants: await tx.select().from(variants) };
}
async function rememberAlias(tx: Tx, designId: string, alias: string) {
  const key = normalizeDesign(alias);
  const [existing] = await tx.select().from(puzzleDesignAliases).where(eq(puzzleDesignAliases.normalizedAlias, key));
  if (existing && existing.puzzleDesignId !== designId) throw conflict("This alias is already confirmed for another design family.");
  if (!existing) await tx.insert(puzzleDesignAliases).values({ normalizedAlias: key, displayAlias: alias.trim(), puzzleDesignId: designId });
}
async function completeDuplicate(tx: Tx, designId: string, value: { productType: string; sizeLabel?: string | null; levelId?: string | number | null; pieceCount?: number | null }, except?: string) {
  if (value.productType !== "CIRCZLES" || !value.sizeLabel || value.levelId == null || !value.pieceCount) return undefined;
  const rows = await tx.select().from(variants).where(and(eq(variants.puzzleDesignId, designId), ne(variants.status, "ARCHIVED")));
  return rows.find(v => v.catalogVariantId !== except && v.productType === "CIRCZLES" && normalizeSize(v.sizeLabel ?? "") === normalizeSize(value.sizeLabel!) && Number(v.levelId) === Number(value.levelId) && v.pieceCount === value.pieceCount);
}
async function getVariant(tx: Tx | Database, id: string) {
  const [row] = await tx.select().from(variants).where(eq(variants.catalogVariantId, id));
  if (!row) throw missing();
  return row;
}
async function getBatch(tx: Tx, id: string) {
  const [row] = await tx.select().from(batches).where(eq(batches.manufacturingBatchId, id)).for("update");
  if (!row) throw missing();
  return row;
}
async function claimCount(tx: Tx | Database, prefixId: string | null) {
  if (!prefixId) return 0n;
  const [row] = await tx.select({ count: sql<string>`count(*)::text` }).from(puzzleClaims).where(eq(puzzleClaims.puzzleClaimPrefixId, prefixId));
  return BigInt(row.count);
}
async function bindPrefix(tx: Tx, variant: typeof variants.$inferSelect, prefix: string) {
  if (!variant.puzzleId || variant.productType !== "CIRCZLES") return null;
  const registry = await tx.select().from(puzzleClaimPrefixes).where(eq(puzzleClaimPrefixes.normalizedPrefix, prefix));
  if (registry.length > 1) throw conflict("This prefix has multiple legacy identities. Explicit historical reconciliation is required.");
  const existing = registry[0];
  if (existing) {
    if (existing.puzzleId !== variant.puzzleId) throw conflict("Existing prefix belongs to another canonical CircZles. Reconcile it explicitly.");
    return existing.puzzleClaimPrefixId;
  }
  const [created] = await tx.insert(puzzleClaimPrefixes).values({ puzzleId: variant.puzzleId, prefix, normalizedPrefix: prefix, active: true }).returning();
  return created.puzzleClaimPrefixId;
}
async function ensureHistoricalRange(tx: Tx, prefixId: string | null, start: bigint, end: bigint) {
  if (!prefixId) return;
  const [below] = await tx.select().from(puzzleClaims).where(and(eq(puzzleClaims.puzzleClaimPrefixId, prefixId), lt(puzzleClaims.serialNumber, start))).limit(1);
  const [above] = await tx.select().from(puzzleClaims).where(and(eq(puzzleClaims.puzzleClaimPrefixId, prefixId), gt(puzzleClaims.serialNumber, end))).limit(1);
  if (below || above) throw conflict("Verified range would exclude a historical claim. Reconciliation is required.");
}
async function createVariant(tx: Tx, input: VariantInput) {
  const value = read(variantInput, input);
  if (value.productType === "CIRCZLES" && value.status === "ACTIVE" && value.levelId == null) throw validationFailed("Active CircZles require a positive gameplay level.");
  let designId = value.puzzleDesignId;
  if (designId) {
    const [design] = await tx.select().from(puzzleDesigns).where(and(eq(puzzleDesigns.puzzleDesignId, designId), isNull(puzzleDesigns.deletedAt)));
    if (!design) throw missing();
  } else {
    const name = value.designName ?? value.displayName;
    const [alias] = await tx.select().from(puzzleDesignAliases).where(eq(puzzleDesignAliases.normalizedAlias, normalizeDesign(name)));
    if (alias) designId = alias.puzzleDesignId;
    else {
      const historical = (await tx.select().from(puzzleDesigns).where(isNull(puzzleDesigns.deletedAt))).filter(d => normalizeDesign(d.name) === normalizeDesign(name));
      if (historical.length) throw conflict("Choose and confirm the existing design family; historical names alone do not prove identity.");
      const [design] = await tx.insert(puzzleDesigns).values({ name, status: "ACTIVE" }).returning();
      designId = design.puzzleDesignId;
    }
  }
  const [resolvedDesign] = await tx.select().from(puzzleDesigns).where(and(eq(puzzleDesigns.puzzleDesignId, designId), isNull(puzzleDesigns.deletedAt)));
  if (!resolvedDesign) throw missing();
  await rememberAlias(tx, designId, value.designName ?? value.displayName);
  if (value.designName) await rememberAlias(tx, designId, value.displayName);
  const duplicate = await completeDuplicate(tx, designId, value);
  if (duplicate) return { ...duplicate, existingCanonical: true };
  let puzzleId: string | null = null;
  if (value.productType === "CIRCZLES" && value.levelId != null) {
    const [puzzle] = await tx.insert(puzzles).values({ puzzleDesignId: designId, name: value.displayName, sizeLabel: value.sizeLabel, pieceCount: value.pieceCount, levelId: value.levelId, image: value.image, description: value.description, status: value.status }).returning();
    puzzleId = puzzle.puzzleId;
  }
  const fields = { ...value };
  delete fields.designName;
  const [created] = await tx.insert(variants).values({ ...fields, puzzleDesignId: designId, puzzleId, levelId: value.levelId == null ? null : String(value.levelId) }).returning();
  return created;
}
async function createBatch(tx: Tx, variantId: string, input: BatchInput, source?: { importKey: string; sourceFingerprint: string; sourceData: Record<string, string> }) {
  const variant = await getVariant(tx, variantId), value = validateBatch(input, variant);
  if (value.status === "ACTIVE" && variant.status !== "ACTIVE") throw validationFailed("Activate the canonical catalog entry before its manufacturing batch.");
  const [duplicate] = await tx.select().from(batches).where(eq(batches.skuPrefix, value.skuPrefix));
  if (duplicate) throw conflict("This manufacturing prefix is already reserved.");
  const prefixId = await bindPrefix(tx, variant, value.skuPrefix);
  await ensureHistoricalRange(tx, prefixId, value.serialStart, value.serialEnd);
  if (prefixId && value.status === "ACTIVE") await tx.update(puzzleClaimPrefixes).set({ active: true, deletedAt: null, updatedAt: new Date() }).where(eq(puzzleClaimPrefixes.puzzleClaimPrefixId, prefixId));
  const [created] = await tx.insert(batches).values({ ...value, ...source, catalogVariantId: variantId, puzzleId: variant.puzzleId, puzzleClaimPrefixId: prefixId, brand: source?.sourceData.brand ?? variant.brand, productType: variant.productType }).returning();
  await tx.insert(ranges).values({ manufacturingBatchId: created.manufacturingBatchId, serialStart: value.serialStart, serialEnd: value.serialEnd });
  return created;
}

// Null is incomplete, never numeric zero. Size follows the existing canonical
// identity normalization; piece counts are validated integers and compare exactly.
function sameLevel(a: string | number | null, b: string | number | null) {
  return a === null || b === null ? a === b : Number(a) === Number(b);
}
function sameSize(a: string | null, b: string | null) {
  return a === null || b === null ? a === b : normalizeSize(a) === normalizeSize(b);
}

export class CatalogService {
  constructor(private db: Database) {}
  async designs() { return (await identityContext(this.db)); }
  confirmAlias(input: unknown) {
    const value = read(z.object({ puzzleDesignId: z.string().uuid(), alias: short }).strict(), input);
    return this.db.transaction(async tx => {
      await managementLock(tx);
      const [design] = await tx.select().from(puzzleDesigns).where(and(eq(puzzleDesigns.puzzleDesignId, value.puzzleDesignId), isNull(puzzleDesigns.deletedAt)));
      if (!design) throw missing();
      await rememberAlias(tx, value.puzzleDesignId, value.alias);
      return { confirmed: true };
    });
  }
  async propose(input: unknown) {
    const value = read(z.object({ rows: z.array(sourceRow).min(1).max(5000) }).strict(), input);
    return { proposals: proposeIdentities(value.rows, await identityContext(this.db)) };
  }
  async list(query: { search?: string; status?: "DRAFT" | "ACTIVE" | "ARCHIVED"; productType?: "CIRCZLES" | "ACCESSORY"; limit?: number; offset?: number } = {}) {
    const conditions = [];
    if (query.status) conditions.push(eq(variants.status, query.status));
    if (query.productType) conditions.push(eq(variants.productType, query.productType));
    if (query.search) {
      const term = "%" + query.search.replace(/[%_\\]/g, "\\$&") + "%";
      conditions.push(sql`(${variants.displayName} ILIKE ${term} OR EXISTS (SELECT 1 FROM manufacturing_batches b WHERE b.catalog_variant_id = ${variants.catalogVariantId} AND b.sku_prefix ILIKE ${term}))`);
    }
    return this.db.select({ ...getTableColumns(variants), maxLeaderboardTimeMs: competition.maxLeaderboardTimeMs }).from(variants).leftJoin(competition, eq(variants.puzzleId, competition.puzzleId)).where(and(...conditions)).orderBy(variants.displayName, variants.catalogVariantId).limit(query.limit ?? 100).offset(query.offset ?? 0);
  }
  async detail(id: string) {
    const variant = await getVariant(this.db, id), rows = await this.db.select().from(batches).where(eq(batches.catalogVariantId, id)).orderBy(batches.createdAt);
    const manufacturing = await Promise.all(rows.map(async batch => {
      const claimed = await claimCount(this.db, batch.puzzleClaimPrefixId);
      return { ...batch, claimedUnits: claimed, remainingUnits: batch.unitsManufactured - claimed, ranges: await this.db.select().from(ranges).where(eq(ranges.manufacturingBatchId, batch.manufacturingBatchId)) };
    }));
    return { ...variant, maxLeaderboardTimeMs: await this.timing(this.db, variant.puzzleId), batches: manufacturing };
  }
  private async timing(db: Pick<Database, "select">, puzzleId: string | null) {
    if (!puzzleId) return null;
    const [setting] = await db.select({ time: competition.maxLeaderboardTimeMs }).from(competition).where(eq(competition.puzzleId, puzzleId));
    return setting?.time ?? null;
  }
  create(input: VariantInput) { return this.db.transaction(async tx => { await managementLock(tx); return createVariant(tx, input); }); }
  addBatch(id: string, input: BatchInput) { return this.db.transaction(async tx => { await managementLock(tx); return createBatch(tx, id, input); }); }
  update(id: string, input: unknown) {
    const { maxLeaderboardTimeMs, ...patch } = read(variantPatch, input);
    return this.db.transaction(async tx => {
      await managementLock(tx);
      const current = await getVariant(tx, id);
      // The editor posts the full form. Remove semantic no-ops before deciding
      // whether timing also needs a metadata/identity update (numeric is text in pg).
      for (const [key, value] of Object.entries(patch)) {
        let unchanged: boolean;
        if (key === "designName") {
          const [design] = await tx.select({ name: puzzleDesigns.name }).from(puzzleDesigns).where(eq(puzzleDesigns.puzzleDesignId, current.puzzleDesignId));
          unchanged = value === design?.name;
        } else if (key === "levelId") unchanged = sameLevel(value as number | null, current.levelId);
        else if (key === "sizeLabel") unchanged = sameSize(value as string | null, current.sizeLabel);
        else if (key === "image" || key === "description") unchanged = (value ?? "") === (current[key] ?? "");
        else if (key === "marketingMetadata") {
          const metadata = value as Record<string, string>;
          unchanged = Object.keys(metadata).length === Object.keys(current.marketingMetadata).length && Object.entries(metadata).every(([name, entry]) => current.marketingMetadata[name] === entry);
        } else unchanged = value === current[key as keyof typeof current];
        if (unchanged) delete patch[key as keyof typeof patch];
      }
      if (maxLeaderboardTimeMs !== undefined) {
        if (current.productType !== "CIRCZLES" || !current.puzzleId) throw validationFailed("Leaderboard timing becomes available when this is a playable CircZles.");
        // Timing-only rows carry no category/order; existing competition behavior is untouched.
        await tx.insert(competition).values({ puzzleId: current.puzzleId, maxLeaderboardTimeMs }).onConflictDoUpdate({ target: competition.puzzleId, set: { maxLeaderboardTimeMs } });
        if (!Object.keys(patch).length) return { ...current, maxLeaderboardTimeMs };
      }
      const children = await tx.select().from(batches).where(eq(batches.catalogVariantId, id)).orderBy(batches.manufacturingBatchId).for("update");
      const next = { ...current, ...patch, levelId: patch.levelId === undefined ? current.levelId : patch.levelId === null ? null : String(patch.levelId) };
      if (next.status !== "ARCHIVED" && await completeDuplicate(tx, current.puzzleDesignId, next, id)) throw conflict("This playable CircZles already exists. Add a Manufacturing Batch instead.");
      if (next.productType === "CIRCZLES" && next.status === "ACTIVE" && next.levelId === null) throw validationFailed("Active CircZles require a positive level.");
      const gameplayChanged = !sameLevel(next.levelId, current.levelId) || !sameSize(next.sizeLabel, current.sizeLabel) || next.pieceCount !== current.pieceCount;
      // Filling an incomplete draft is safe; an existing playable identity is not reconfigured.
      if (gameplayChanged && children.length && current.puzzleId) throw conflict("Create a separate variant for gameplay changes once manufacturing exists.");
      let puzzleId = current.puzzleId;
      if (next.productType === "CIRCZLES" && next.levelId !== null) {
        const fields = { name: next.displayName, levelId: Number(next.levelId), sizeLabel: next.sizeLabel, pieceCount: next.pieceCount, image: next.image, description: next.description, status: next.status, updatedAt: new Date() };
        if (puzzleId) await tx.update(puzzles).set(fields).where(eq(puzzles.puzzleId, puzzleId));
        else {
          const [created] = await tx.insert(puzzles).values({ ...fields, puzzleDesignId: current.puzzleDesignId }).returning();
          puzzleId = created.puzzleId;
        }
      } else if (puzzleId) throw conflict("A playable level cannot be removed. Archive this variant instead.");
      if (patch.designName) await tx.update(puzzleDesigns).set({ name: patch.designName, updatedAt: new Date() }).where(eq(puzzleDesigns.puzzleDesignId, current.puzzleDesignId));
      if (next.status !== "ACTIVE" && next.status !== current.status) await tx.update(batches).set({ status: next.status, updatedAt: new Date() }).where(eq(batches.catalogVariantId, id));
      for (const child of children) {
        if (puzzleId && !child.puzzleId) {
          const prefixId = await bindPrefix(tx, { ...next, puzzleId }, child.skuPrefix);
          await tx.update(batches).set({ puzzleId, puzzleClaimPrefixId: prefixId }).where(eq(batches.manufacturingBatchId, child.manufacturingBatchId));
        }
      }
      const fields = { ...patch };
      delete fields.designName;
      const [updated] = await tx.update(variants).set({ ...fields, levelId: next.levelId, puzzleId, updatedAt: new Date() }).where(eq(variants.catalogVariantId, id)).returning();
      if (puzzleId) {
        const owners = await tx.select({ id: playerPuzzles.playerId }).from(playerPuzzles).where(and(eq(playerPuzzles.puzzleId, puzzleId), isNull(playerPuzzles.deletedAt)));
        for (const owner of owners) await tx.execute(sql`SELECT pg_notify(${PLAYER_STATE_CHANNEL}, ${owner.id})`);
      }
      return { ...updated, maxLeaderboardTimeMs: await this.timing(tx, puzzleId) };
    });
  }
  editBatch(id: string, input: unknown) {
    return this.db.transaction(async tx => {
      await managementLock(tx);
      const current = await getBatch(tx, id), variant = await getVariant(tx, current.catalogVariantId);
      // Status-only changes are valid even after disjoint production ranges are appended.
      const stateOnly = z.object({ status }).strict().safeParse(input);
      if (stateOnly.success) {
        if (stateOnly.data.status === "ACTIVE") {
          if (variant.status !== "ACTIVE") throw validationFailed("The canonical CircZles must be active.");
          validateBatch({ numberIdentifier: current.numberIdentifier, manufacturingCode: current.manufacturingCode, skuPrefix: current.skuPrefix, serialStart: current.serialStart.toString(), serialEnd: current.serialStart.toString(), unitsManufactured: "1", status: "ACTIVE" }, variant);
          if (current.puzzleClaimPrefixId) await tx.update(puzzleClaimPrefixes).set({ active: true, deletedAt: null, updatedAt: new Date() }).where(eq(puzzleClaimPrefixes.puzzleClaimPrefixId, current.puzzleClaimPrefixId));
        }
        const [updated] = await tx.update(batches).set({ status: stateOnly.data.status, updatedAt: new Date() }).where(eq(batches.manufacturingBatchId, id)).returning();
        return updated;
      }
      const correction = read(batchCorrection, input);
      const target = correction.catalogVariantId ? await getVariant(tx, correction.catalogVariantId) : variant;
      if (target.productType !== variant.productType || (target.catalogVariantId !== variant.catalogVariantId && !target.puzzleId)) throw conflict("Canonical corrections require a complete variant of the same product type.");
      const body = { ...correction }; delete body.catalogVariantId;
      const value = validateBatch(body, target);
      const changed = target.catalogVariantId !== variant.catalogVariantId || value.skuPrefix !== current.skuPrefix || value.serialStart !== current.serialStart || value.serialEnd !== current.serialEnd || value.unitsManufactured !== current.unitsManufactured;
      if (changed && await claimCount(tx, current.puzzleClaimPrefixId) > 0n) throw conflict("Claimed manufacturing identity is immutable. Archive and create a new batch.");
      const children = await tx.select().from(ranges).where(eq(ranges.manufacturingBatchId, id));
      if (changed && children.length > 1) throw conflict("Multiple verified ranges cannot be replaced. Add a range or archive this batch.");
      if (value.status === "ACTIVE" && target.status !== "ACTIVE") throw validationFailed("The canonical CircZles must be active.");
      if (changed) {
        const [duplicate] = await tx.select().from(batches).where(and(eq(batches.skuPrefix, value.skuPrefix), ne(batches.manufacturingBatchId, id)));
        if (duplicate) throw conflict("This manufacturing prefix is already reserved.");
        if (current.puzzleClaimPrefixId && current.skuPrefix !== value.skuPrefix) {
          const [existing] = await tx.select().from(puzzleClaimPrefixes).where(eq(puzzleClaimPrefixes.normalizedPrefix, value.skuPrefix));
          if (existing) throw conflict("Reconcile the already registered prefix instead of replacing it.");
          await tx.update(puzzleClaimPrefixes).set({ prefix: value.skuPrefix, normalizedPrefix: value.skuPrefix, updatedAt: new Date() }).where(eq(puzzleClaimPrefixes.puzzleClaimPrefixId, current.puzzleClaimPrefixId));
        }
        await tx.update(ranges).set({ serialStart: value.serialStart, serialEnd: value.serialEnd }).where(eq(ranges.manufacturingBatchId, id));
        if (current.puzzleClaimPrefixId && target.puzzleId) await tx.update(puzzleClaimPrefixes).set({ puzzleId: target.puzzleId, updatedAt: new Date() }).where(eq(puzzleClaimPrefixes.puzzleClaimPrefixId, current.puzzleClaimPrefixId));
      }
      const prefixId = await bindPrefix(tx, target, value.skuPrefix);
      await ensureHistoricalRange(tx, prefixId, value.serialStart, value.serialEnd);
      if (value.status === "ACTIVE" && prefixId) await tx.update(puzzleClaimPrefixes).set({ active: true, deletedAt: null, updatedAt: new Date() }).where(eq(puzzleClaimPrefixes.puzzleClaimPrefixId, prefixId));
      const [updated] = await tx.update(batches).set({ ...value, catalogVariantId: target.catalogVariantId, puzzleId: target.puzzleId, puzzleClaimPrefixId: prefixId, brand: target.brand, updatedAt: new Date() }).where(eq(batches.manufacturingBatchId, id)).returning();
      return updated;
    });
  }
  addRange(id: string, input: unknown) {
    const value = read(rangeInput, input), start = BigInt(value.serialStart), end = BigInt(value.serialEnd);
    if (end < start) throw validationFailed("Serial end must be at least serial start.");
    return this.db.transaction(async tx => {
      await managementLock(tx);
      const batch = await getBatch(tx, id);
      if (batch.status === "ARCHIVED") throw conflict("Archived manufacturing batches cannot receive new ranges.");
      const [overlap] = await tx.select().from(ranges).where(and(eq(ranges.manufacturingBatchId, id), lte(ranges.serialStart, end), gte(ranges.serialEnd, start))).limit(1);
      if (overlap) throw conflict("Manufactured serial ranges must not overlap.");
      const units = batch.unitsManufactured + end - start + 1n;
      if (units > 9223372036854775807n) throw validationFailed("Manufactured quantity exceeds PostgreSQL bigint.");
      await tx.insert(ranges).values({ manufacturingBatchId: id, serialStart: start, serialEnd: end });
      const [updated] = await tx.update(batches).set({ serialStart: start < batch.serialStart ? start : batch.serialStart, serialEnd: end > batch.serialEnd ? end : batch.serialEnd, unitsManufactured: units, updatedAt: new Date() }).where(eq(batches.manufacturingBatchId, id)).returning();
      return updated;
    });
  }
  import(input: unknown, apply = false) {
    const manifest = read(importManifest, input);
    return this.db.transaction(async tx => {
      await managementLock(tx);
      const report = await planImport(tx, manifest);
      if (!apply || report.errors.length) {
        if (apply && report.errors.length) throw validationFailed("Reconcile all import errors before applying.", report);
        return report;
      }
      const created = new Map<string, string>();
      // Recover explicit shared keys on a resumed/idempotent import.
      for (const row of manifest.rows) if (report.skipped.includes(row.sourceId)) {
        const decision = manifest.mappings[row.sourceId];
        const [batch] = await tx.select().from(batches).where(eq(batches.importKey, sourceKey(manifest.datasetId, row.sourceId)));
        if (decision.newVariantKey) created.set(decision.newVariantKey, batch.catalogVariantId);
      }
      for (const row of manifest.rows) {
        if (report.skipped.includes(row.sourceId)) continue;
        const decision = manifest.mappings[row.sourceId];
        let variantId = decision.catalogVariantId ?? created.get(decision.newVariantKey ?? "");
        if (!variantId) {
          const variant = await createVariant(tx, { displayName: row.name.trim(), designName: row.canonicalDesign ?? row.name, brand: row.brand, productType: row.productType, sizeLabel: row.size, pieceCount: row.pieceCount ?? null, levelId: sourceLevel(row.level), status: sourceLevel(row.level) === null || row.productType === "ACCESSORY" ? "DRAFT" : "ACTIVE" });
          variantId = variant.catalogVariantId;
          created.set(decision.newVariantKey!, variantId);
        }
        if (row.canonicalDesign) {
          const target = await getVariant(tx, variantId);
          await rememberAlias(tx, target.puzzleDesignId, row.canonicalDesign);
          await rememberAlias(tx, target.puzzleDesignId, row.name);
        }
        await createBatch(tx, variantId, sourceBatch(row), { importKey: sourceKey(manifest.datasetId, row.sourceId), sourceFingerprint: fingerprint(row, decision), sourceData: sourceStrings(row) });
      }
      return { ...report, applied: true };
    });
  }
}

export const sourceRow = z.object({ sourceId: short, name: z.string().min(1).max(200).refine(v => v.trim().length > 0), size: z.string().min(1).max(200), brand: z.string().min(1).max(200).refine(v => v.trim().length > 0), numberIdentifier: z.string().min(1).max(200), manufacturingCode: z.string().min(1).max(200), level: z.string().min(1).max(200), units: serial, firstFullSku: z.string().min(1).max(200), productType, pieceCount: z.number().int().positive().max(1000000).optional(), canonicalDesign: short.optional() }).strict();
const mapping = z.object({ catalogVariantId: z.string().uuid().optional(), newVariantKey: short.optional() }).strict().refine(v => Boolean(v.catalogVariantId) !== Boolean(v.newVariantKey), "Choose an existing variant or an explicit new variant key");
export const importManifest = z.object({ datasetId: short, rows: z.array(sourceRow).min(1).max(5000), mappings: z.record(z.string(), mapping) }).strict();
type Manifest = z.infer<typeof importManifest>;
type Source = z.infer<typeof sourceRow>;
function sourceLevel(value: string): number | null { return value === "NA" ? null : read(level, Number(value)); }
function sourceBatch(row: Source): BatchInput {
  if ([row.size, row.numberIdentifier, row.manufacturingCode, row.level, row.firstFullSku].some(value => value !== value.trim())) throw validationFailed("Manufacturing source fields contain unexpected whitespace; reconcile the original source instead of silently correcting it.");
  const parsed = parseClaimCode(row.firstFullSku);
  const parts = parsed.normalizedPrefix.split("-");
  if (parts[3] !== row.level) throw validationFailed("Source level text and SKU level disagree; preserve the source and reconcile it.");
  return { numberIdentifier: row.numberIdentifier, manufacturingCode: row.manufacturingCode, skuPrefix: parsed.normalizedPrefix, firstFullSku: row.firstFullSku, serialStart: parsed.serialNumber.toString(), serialEnd: (parsed.serialNumber + BigInt(row.units) - 1n).toString(), unitsManufactured: row.units, status: sourceLevel(row.level) === null || row.productType === "ACCESSORY" ? "DRAFT" : "ACTIVE" };
}
function sourceStrings(row: Source): Record<string, string> { return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value)])); }
function sourceKey(datasetId: string, sourceId: string) { return JSON.stringify([datasetId, sourceId]); }
function fingerprint(row: Source, decision: z.infer<typeof mapping>) { return createHash("sha256").update(JSON.stringify([row, decision])).digest("hex"); }
async function planImport(tx: Tx, manifest: Manifest) {
  const errors: { sourceId: string; message: string }[] = [], skipped: string[] = [];
  const seen = new Set<string>(), prefixes = new Set<string>(), groups = new Map<string, Source>();
  const context = await identityContext(tx);
  const completeKeys = new Map<string, string>();
  const stored = await tx.select().from(batches);
  const byKey = new Map(stored.filter(b => b.importKey).map(b => [b.importKey!, b]));
  const byPrefix = new Map(stored.map(b => [b.skuPrefix, b]));
  const recoveredGroups = new Map<string, string>();
  for (const row of manifest.rows) {
    const decision = manifest.mappings[row.sourceId], previous = byKey.get(sourceKey(manifest.datasetId, row.sourceId));
    if (decision?.newVariantKey && previous?.sourceFingerprint === fingerprint(row, decision)) recoveredGroups.set(decision.newVariantKey, previous.catalogVariantId);
  }
  for (const row of manifest.rows) {
    try {
      if (seen.has(row.sourceId)) throw conflict("Duplicate source row identity.");
      seen.add(row.sourceId);
      const decision = manifest.mappings[row.sourceId];
      if (!Object.hasOwn(manifest.mappings, row.sourceId)) throw conflict("Explicit canonical mapping is required; names are never merged automatically.");
      const value = sourceBatch(row), key = sourceKey(manifest.datasetId, row.sourceId);
      if (row.canonicalDesign) {
        const displayAlias = context.aliases.find(a => a.normalizedAlias === normalizeDesign(row.name));
        const canonicalAlias = context.aliases.find(a => a.normalizedAlias === normalizeDesign(row.canonicalDesign!));
        if (displayAlias && displayAlias.puzzleDesignId !== canonicalAlias?.puzzleDesignId) throw conflict("Display alias and Canonical Design refer to conflicting families; review the alias explicitly.");
      }
      const existing = byKey.get(key);
      if (existing) {
        if (existing.sourceFingerprint !== fingerprint(row, decision)) throw conflict("Previously imported source or mapping changed; use explicit catalog correction.");
        skipped.push(row.sourceId);
      }
      if (!existing && row.productType === "CIRCZLES" && row.level !== "NA" && row.pieceCount && decision.newVariantKey) {
        const alias = context.aliases.find(a => a.normalizedAlias === normalizeDesign(row.canonicalDesign ?? row.name));
        const duplicate = alias && await completeDuplicate(tx, alias.puzzleDesignId, { productType: row.productType, sizeLabel: row.size, levelId: sourceLevel(row.level), pieceCount: row.pieceCount });
        if (duplicate && recoveredGroups.get(decision.newVariantKey) !== duplicate.catalogVariantId) throw conflict("This complete playable configuration already exists; link its existing CircZles instead of proposing a new identity.");
        const signature = gameplaySignature(alias?.puzzleDesignId ?? normalizeDesign(row.canonicalDesign ?? row.name), row);
        if (completeKeys.has(signature) && completeKeys.get(signature) !== decision.newVariantKey) throw conflict("Identical complete configurations require the same product identity; use the same manufacturing group.");
        completeKeys.set(signature, decision.newVariantKey);
      }
      if (prefixes.has(value.skuPrefix)) throw conflict("Duplicate manufacturing prefix in source.");
      prefixes.add(value.skuPrefix);
      const reserved = byPrefix.get(value.skuPrefix);
      if (reserved && reserved.importKey !== key) throw conflict("Manufacturing prefix is already reserved.");
      let target: Pick<typeof variants.$inferSelect, "levelId" | "productType"> = { levelId: sourceLevel(row.level)?.toString() ?? null, productType: row.productType };
      if (decision.catalogVariantId) {
        const variant = await getVariant(tx, decision.catalogVariantId);
        if (variant.productType !== row.productType || variant.brand.trim() !== row.brand.trim() || normalizeSize(variant.sizeLabel ?? "") !== normalizeSize(row.size) || Number(variant.levelId) !== Number(sourceLevel(row.level)) || (row.pieceCount != null && variant.pieceCount !== row.pieceCount)) throw conflict("Source gameplay, size or brand disagrees with explicit canonical target.");
        if (!existing && value.status === "ACTIVE" && variant.status !== "ACTIVE") throw conflict("Target canonical CircZles is not active.");
        const legacyRows = await tx.select().from(puzzleClaimPrefixes).where(eq(puzzleClaimPrefixes.normalizedPrefix, value.skuPrefix));
        if (legacyRows.length > 1) throw conflict("This prefix has multiple legacy identities. Explicit historical reconciliation is required.");
        const legacy = legacyRows[0];
        if (legacy && legacy.puzzleId !== variant.puzzleId) throw conflict("Legacy prefix belongs to another canonical variant.");
        if (!existing) await ensureHistoricalRange(tx, legacy?.puzzleClaimPrefixId ?? null, BigInt(value.serialStart), BigInt(value.serialEnd));
        target = variant;
      } else {
        const prior = groups.get(decision.newVariantKey!);
        if (prior && (row.level === "NA" || prior.level === "NA")) throw conflict("Incomplete NA-level drafts require separate catalog identities.");
        if (prior && [normalizeSize(prior.size), prior.brand.trim(), sourceLevel(prior.level), prior.productType, prior.pieceCount ?? null, normalizeDesign(prior.canonicalDesign ?? prior.name)].join("|") !== [normalizeSize(row.size), row.brand.trim(), sourceLevel(row.level), row.productType, row.pieceCount ?? null, normalizeDesign(row.canonicalDesign ?? row.name)].join("|")) {
          const family = (r: Source) => context.aliases.find(a => a.normalizedAlias === normalizeDesign(r.canonicalDesign ?? r.name))?.puzzleDesignId ?? normalizeDesign(r.canonicalDesign ?? r.name);
          if (family(prior!) !== family(row) || [normalizeSize(prior!.size), prior!.brand.trim(), sourceLevel(prior!.level), prior!.productType, prior!.pieceCount ?? null].join("|") !== [normalizeSize(row.size), row.brand.trim(), sourceLevel(row.level), row.productType, row.pieceCount ?? null].join("|")) throw conflict("Explicit shared variant key has conflicting gameplay, design, size or brand.");
        }
        groups.set(decision.newVariantKey!, row);
        const legacyRows = await tx.select().from(puzzleClaimPrefixes).where(eq(puzzleClaimPrefixes.normalizedPrefix, value.skuPrefix));
        if (legacyRows.length > 1) throw conflict("This prefix has multiple legacy identities. Explicit historical reconciliation is required.");
        const legacy = legacyRows[0];
        if (legacy && !existing) throw conflict("Legacy prefix requires explicit mapping to its existing canonical variant.");
      }
      validateBatch(value, target);
    } catch (error) { errors.push({ sourceId: row.sourceId, message: error instanceof AppError ? error.message : "Invalid source row." }); }
  }
  const candidates = new Map<string, string[]>();
  for (const row of manifest.rows) {
    const key = row.name.trim().toLowerCase();
    candidates.set(key, [...(candidates.get(key) ?? []), row.sourceId]);
  }
  return { applied: false, rows: manifest.rows.length, skipped, errors, ready: errors.length === 0, planned: manifest.rows.length - skipped.length,
    reconciliationCandidates: [...candidates].filter(([, ids]) => ids.length > 1).map(([name, sourceIds]) => ({ name, sourceIds, reason: "Name similarity is a review hint only; explicit mappings determine canonical identity." })) };
}
