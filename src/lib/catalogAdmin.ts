import { request } from "./apiClient";
export type CatalogStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
export interface CatalogVariant {
  catalogVariantId: string; puzzleDesignId: string; puzzleId: string | null; displayName: string; brand: string;
  productType: "CIRCZLES" | "ACCESSORY"; sizeLabel: string | null; pieceCount: number | null; levelId: string | null;
  image: string | null; description: string | null; marketingMetadata: Record<string, string>; status: CatalogStatus;
  maxLeaderboardTimeMs: number | null;
  existingCanonical?: boolean;
}
export interface ManufacturingBatch {
  manufacturingBatchId: string; numberIdentifier: string; manufacturingCode: string; skuPrefix: string; firstFullSku: string | null;
  serialStart: string; serialEnd: string; unitsManufactured: string; status: CatalogStatus; claimedUnits: string; remainingUnits: string;
  ranges: { serialStart: string; serialEnd: string }[];
}
export type CatalogDetail = CatalogVariant & { batches: ManufacturingBatch[] };
export interface ImportReport { applied: boolean; rows: number; planned: number; skipped: string[]; ready: boolean; errors: { sourceId: string; message: string }[]; reconciliationCandidates?: { name: string; sourceIds: string[]; reason: string }[] }
const root = "/api/admin/catalog";
const send = (body: unknown) => JSON.stringify(body);
export const catalogAdmin = {
  designs: (signal?: AbortSignal) => request<import("../../backend/src/domain/catalogIdentity").IdentityContext>(root + "/designs", { signal }),
  alias: (puzzleDesignId: string, alias: string) => request<{ confirmed: boolean }>(root + "/design-aliases", { method: "POST", body: send({ puzzleDesignId, alias }) }),
  propose: (rows: unknown[], signal?: AbortSignal) => request<{ proposals: import("../../backend/src/domain/catalogIdentity").IdentityProposal[] }>(root + "/import/propose", { method: "POST", body: send({ rows }), signal }),
  access: (signal?: AbortSignal) => request<{ allowed: boolean }>(root + "/access", { signal }),
  list: (query: URLSearchParams, signal?: AbortSignal) => request<CatalogVariant[]>(root + "?" + query, { signal }),
  detail: (id: string) => request<CatalogDetail>(root + "/" + id),
  create: (body: unknown) => request<CatalogVariant>(root, { method: "POST", body: send(body) }),
  update: (id: string, body: unknown) => request<CatalogVariant>(root + "/" + id, { method: "PATCH", body: send(body) }),
  batch: (id: string, body: unknown) => request<ManufacturingBatch>(root + "/" + id + "/batches", { method: "POST", body: send(body) }),
  editBatch: (id: string, body: unknown) => request<ManufacturingBatch>(root + "/batches/" + id, { method: "PATCH", body: send(body) }),
  range: (id: string, body: unknown) => request<ManufacturingBatch>(root + "/batches/" + id + "/ranges", { method: "POST", body: send(body) }),
  import: (manifest: unknown, apply = false) => request<ImportReport>(root + "/import/" + (apply ? "apply" : "preview"), { method: "POST", body: send(manifest) }),
};
