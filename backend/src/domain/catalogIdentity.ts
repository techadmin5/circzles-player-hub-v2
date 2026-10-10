// Pure identity rules shared by import proposals and the operator repair planner.
export const normalizeDesign = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
export const normalizeSize = (value: string) => /^\d+(?:\.\d+)?$/.test(value.trim()) ? String(Number(value)) : normalizeDesign(value);
export interface IdentityRow {
  sourceId: string; name: string; size: string; level: string; productType: string; pieceCount?: number; canonicalDesign?: string;
}
export interface IdentityContext {
  aliases: { normalizedAlias: string; puzzleDesignId: string }[];
  designs: { puzzleDesignId: string; name: string }[];
  variants: { catalogVariantId: string; puzzleDesignId: string; sizeLabel: string | null; levelId: string | null; pieceCount: number | null; productType: string; status: string }[];
}
export type IdentityDecision = { catalogVariantId: string; newVariantKey?: never } | { newVariantKey: string; catalogVariantId?: never };
export interface IdentityProposal { sourceId: string; state: "AUTO-SHARED" | "AUTO-SEPARATE" | "EXISTING-CANONICAL" | "NEEDS-REVIEW"; reason: string; designFamily: string; decision?: IdentityDecision }
export function gameplaySignature(family: string, row: Pick<IdentityRow, "size" | "level" | "pieceCount">) {
  return JSON.stringify([family, normalizeSize(row.size), Number(row.level), row.pieceCount]);
}
export function proposeIdentities(rows: IdentityRow[], context: IdentityContext): IdentityProposal[] {
  const resolved = rows.map(row => {
    const name = normalizeDesign(row.canonicalDesign || row.name);
    const confirmed = context.aliases.filter(a => a.normalizedAlias === name);
    const exact = context.designs.filter(d => normalizeDesign(d.name) === name);
    const family = confirmed.length === 1 ? confirmed[0].puzzleDesignId : "new:" + name;
    const displayAlias = context.aliases.find(a => a.normalizedAlias === normalizeDesign(row.name));
    return { row, name, family, ambiguous: confirmed.length > 1 || (!confirmed.length && exact.length > 0) || (!!row.canonicalDesign && !!displayAlias && displayAlias.puzzleDesignId !== family) };
  });
  const signatures = new Map<string, number>();
  for (const { row, family } of resolved) if (row.productType === "CIRCZLES" && row.pieceCount && Number(row.level) > 0) {
    const key = gameplaySignature(family, row); signatures.set(key, (signatures.get(key) ?? 0) + 1);
  }
  const groupKeys = new Map<string, string>();
  return resolved.map(({ row, family, ambiguous }) => {
    const base = { sourceId: row.sourceId, designFamily: family };
    const review = (reason: string): IdentityProposal => ({ ...base, state: "NEEDS-REVIEW", reason });
    if (ambiguous) return review("Confirm this design family/alias before linking historical catalog records.");
    // Confirmed source typo examples are review hints, never implicit aliases.
    const counterpart = ({ colorstom: "colorstrom", colorstrom: "colorstom", peocock: "peacock", peacock: "peocock" } as Record<string, string>)[normalizeDesign(row.name)];
    if (!row.canonicalDesign && counterpart && !context.aliases.some(a => a.normalizedAlias === normalizeDesign(row.name)) && (resolved.some(p => normalizeDesign(p.row.name) === counterpart) || context.designs.some(d => normalizeDesign(d.name) === counterpart))) return review("Known spelling difference requires a confirmed design alias or Canonical Design value.");
    if (row.productType === "ACCESSORY" || row.level === "NA") return { ...base, state: "AUTO-SEPARATE", reason: "Accessory or incomplete draft: separate catalog identity; no playable grouping.", decision: { newVariantKey: "separate:" + row.sourceId } };
    if (!row.pieceCount || !row.size.trim() || !(Number(row.level) > 0)) return review("Verified size, positive level and piece count are required for automatic playable identity.");
    const peers = resolved.filter(p => p.family === family && normalizeSize(p.row.size) === normalizeSize(row.size) && Number(p.row.level) === Number(row.level));
    if (peers.some(p => !p.row.pieceCount)) return review("Another matching design/size/level row is missing a verified piece count.");
    const candidates = context.variants.filter(v => v.puzzleDesignId === family && v.productType === "CIRCZLES" && v.status !== "ARCHIVED" && normalizeSize(v.sizeLabel ?? "") === normalizeSize(row.size) && Number(v.levelId) === Number(row.level));
    if (candidates.some(v => v.pieceCount === null)) return review("Existing configuration has an unverified piece count; reconcile before linking.");
    const matching = candidates.filter(v => v.pieceCount === row.pieceCount);
    const reason = `Same design · Size ${normalizeSize(row.size)} · Level ${Number(row.level)} · ${row.pieceCount} pieces`;
    if (matching.length > 1 || matching.some(v => v.status !== "ACTIVE")) return review("Existing canonical configurations conflict or are inactive; operator review required.");
    if (matching.length === 1) return { ...base, state: "EXISTING-CANONICAL", reason, decision: { catalogVariantId: matching[0].catalogVariantId } };
    const signature = gameplaySignature(family, row);
    if (!groupKeys.has(signature)) groupKeys.set(signature, "auto-group-" + (groupKeys.size + 1));
    return { ...base, state: (signatures.get(signature) ?? 0) > 1 ? "AUTO-SHARED" : "AUTO-SEPARATE", reason, decision: { newVariantKey: groupKeys.get(signature)! } };
  });
}
