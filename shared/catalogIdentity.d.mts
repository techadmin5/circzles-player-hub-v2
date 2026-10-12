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

export declare const normalizeDesign: (value: string) => string;
export declare const normalizeSize: (value: string) => string;
export declare function gameplaySignature(family: string, row: Pick<IdentityRow, "size" | "level" | "pieceCount">): string;
export declare function proposeIdentities(rows: IdentityRow[], context: IdentityContext): IdentityProposal[];
