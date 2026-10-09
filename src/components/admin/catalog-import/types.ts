export interface SourceRow {
  sourceId: string; name: string; size: string; brand: string; numberIdentifier: string;
  manufacturingCode: string; level: string; units: string; firstFullSku: string;
  productType: "CIRCZLES" | "ACCESSORY"; pieceCount?: number;
}
export type Decision = { catalogVariantId: string; newVariantKey?: never } | { newVariantKey: string; catalogVariantId?: never };
export interface Manifest { datasetId: string; rows: SourceRow[]; mappings: Record<string, Decision> }
export type Field = Exclude<keyof SourceRow, "sourceId" | "productType">;
export type ColumnMap = Partial<Record<Field, number>>;
export interface Cell { text: string; numeric?: number; issue?: string }
export interface Sheet { name: string; headers: string[]; rows: Cell[][]; rowNumbers: number[]; headerRow: number }
export interface ParsedFile { name: string; size: number; format: string; sheets: Sheet[]; defaultSheet: number; manifest?: Manifest }
export interface PreviewRow { key: number; rowNumber: number; source: SourceRow; warnings: string[]; errors: string[]; prefix: string; range: string }
export interface RowChoice { selected: boolean; productType?: SourceRow["productType"]; decision?: Decision }
export type Choices = Record<number, RowChoice>;
