import type { Cell, ColumnMap, Field, Manifest, ParsedFile, Sheet } from "./types";

export const MAX_ROWS = 5000;
export const MAX_BYTES = 10 * 1024 * 1024;
export const fields: { key: Field; label: string; aliases: string[]; optional?: boolean }[] = [
  { key: "name", label: "CircZles Name", aliases: ["Puzzle Name", "CircZles Name", "Product Name", "Name"] },
  { key: "size", label: "Size", aliases: ["Size", "Puzzle Size"] },
  { key: "brand", label: "Brand", aliases: ["Brand", "Brand Name"] },
  { key: "numberIdentifier", label: "Number Identifier", aliases: ["Number Identifier", "Number ID", "Identifier"] },
  { key: "manufacturingCode", label: "Manufacturing Run", aliases: ["Manufacturing Code", "Manufacturing Run", "Run", "Batch Run"] },
  { key: "level", label: "Level", aliases: ["Level", "Levels"] },
  { key: "units", label: "Units Manufactured", aliases: ["Units", "Quantity", "Manufactured Units", "Units Manufactured"] },
  { key: "firstFullSku", label: "First Full SKU", aliases: ["SKU Number", "SKU", "First Full SKU", "Final SKU", "Manufacturing SKU"] },
  { key: "pieceCount", label: "Piece Count", aliases: ["Piece Count", "Pieces"], optional: true },
];
const headerKey = (value: string) => value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[ _-]+/g, " ");
export const isWebsiteSku = (value: string) => headerKey(value).replaceAll(" ", "") === "websitesku";
export function detectColumns(headers: string[]): ColumnMap {
  const result: ColumnMap = {};
  for (const field of fields) {
    // Prefer explicit manufacturing headers over the generic SKU alias.
    const aliases = field.key === "firstFullSku" ? [...field.aliases.filter(a => a !== "SKU"), "SKU"] : field.aliases;
    for (const alias of aliases) {
      const indexes = headers.flatMap((h, i) => headerKey(h) === headerKey(alias) ? [i] : []);
      if (indexes.length === 1) { result[field.key] = indexes[0]; break; }
    }
  }
  return result;
}
export function missingColumns(map: ColumnMap): string[] {
  return fields.filter(f => !f.optional && map[f.key] === undefined).map(f => f.label);
}
function makeSheet(name: string, matrix: Cell[][]): Sheet {
  if (matrix.some(row => row.length > 100)) throw new Error("A worksheet may contain at most 100 columns. Remove unused columns and retry.");
  let header = matrix.findIndex(row => row.some(cell => cell.text.trim()));
  if (header < 0) return { name, headers: [], rows: [], rowNumbers: [], headerRow: 0 };
  let score = -1;
  const headerSearchEnd = Math.min(matrix.length, header + 25);
  for (let i = header; i < headerSearchEnd; i++) {
    const current = Object.keys(detectColumns(matrix[i].map(cell => cell.text))).length;
    if (current > score) { header = i; score = current; }
  }
  const rows: Cell[][] = [], rowNumbers: number[] = [];
  for (let i = header + 1; i < matrix.length; i++) if (matrix[i].some(cell => cell.text.trim() || cell.issue)) { rows.push(matrix[i]); rowNumbers.push(i + 1); }
  if (rows.length > MAX_ROWS) throw new Error("The worksheet exceeds 5,000 rows. Split the file explicitly; rows are never silently discarded.");
  return { name, headers: matrix[header].map(cell => cell.text), rows, rowNumbers, headerRow: header + 1 };
}
// CSV is parsed as text, including quoted newlines and UTF-8; no numeric coercion.
export function parseCsv(text: string): Sheet {
  const matrix: Cell[][] = [], row: Cell[] = [];
  let value = "", quoted = false, closed = false;
  const pushCell = () => { row.push({ text: value }); value = ""; closed = false; };
  const pushRow = () => { pushCell(); matrix.push(row.splice(0)); if (matrix.length > MAX_ROWS + 26) throw new Error("CSV exceeds the 5,000-row limit."); };
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } }
      else value += c;
    } else if (c === '"') {
      if (value || closed) throw new Error("Malformed CSV quote. Export a standard comma-delimited CSV.");
      quoted = true;
    } else if (c === ",") pushCell();
    else if (c === "\r" || c === "\n") { pushRow(); if (c === "\r" && text[i + 1] === "\n") i++; }
    else { if (closed && c.trim()) throw new Error("Unexpected text after a quoted CSV value."); if (!closed) value += c; }
  }
  if (quoted) throw new Error("Unterminated quoted CSV value.");
  if (value || row.length || closed) pushRow();
  return makeSheet("CSV", matrix);
}
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
export function readManifest(text: string): Manifest {
  const value: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
  if (!isObject(value) || typeof value.datasetId !== "string" || !Array.isArray(value.rows) || !isObject(value.mappings)) throw new Error("JSON must contain datasetId, rows and explicit mappings.");
  if (Object.keys(value).some(k => !["datasetId", "rows", "mappings"].includes(k))) throw new Error("Unsupported JSON manifest field.");
  if (!value.rows.length || value.rows.length > MAX_ROWS) throw new Error("Choose between 1 and 5,000 rows.");
  const strings = ["sourceId", "name", "size", "brand", "numberIdentifier", "manufacturingCode", "level", "units", "firstFullSku", "productType"];
  for (const row of value.rows) {
    if (!isObject(row) || strings.some(k => typeof row[k] !== "string") || Object.keys(row).some(k => ![...strings, "pieceCount"].includes(k)) || (row.pieceCount !== undefined && (typeof row.pieceCount !== "number" || !Number.isInteger(row.pieceCount) || row.pieceCount <= 0))) throw new Error("JSON rows must use the existing source-row contract with text identity fields and optional positive numeric pieceCount.");
  }
  for (const decision of Object.values(value.mappings)) {
    if (!isObject(decision) || Object.keys(decision).length !== 1 || !Object.entries(decision).every(([key, v]) => ["catalogVariantId", "newVariantKey"].includes(key) && typeof v === "string" && !!v.trim())) throw new Error("Each mapping must choose exactly one catalogVariantId or newVariantKey.");
  }
  return value as unknown as Manifest;
}
export async function parseFile(file: Pick<File, "name" | "size" | "text" | "arrayBuffer">): Promise<ParsedFile> {
  const format = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["xlsx", "xls", "csv", "json"].includes(format)) throw new Error("Choose an .xlsx, .xls, .csv or .json file.");
  if (!file.size || file.size > MAX_BYTES) throw new Error("Choose a non-empty file up to 10 MB.");
  if (format === "json") return { name: file.name, size: file.size, format, sheets: [], defaultSheet: 0, manifest: readManifest(await file.text()) };
  if (format === "csv") return { name: file.name, size: file.size, format, sheets: [parseCsv(await file.text())], defaultSheet: 0 };
  const xlsx = await import("xlsx");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!(format === "xlsx" ? bytes[0] === 0x50 && bytes[1] === 0x4b : bytes[0] === 0xd0 && bytes[1] === 0xcf)) throw new Error("File content does not match its Excel extension. Export a valid XLSX or Excel 97–2003 XLS workbook.");
  const workbook = xlsx.read(bytes, { type: "array", cellNF: true, cellText: true, cellDates: true, cellHTML: false, cellFormula: true, sheetRows: MAX_ROWS + 26 });
  if (workbook.SheetNames.length > 50) throw new Error("Workbook exceeds 50 worksheets. Export the relevant sheets separately.");
  const sheets = workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name];
    if (!sheet["!ref"]) return makeSheet(name, []);
    const range = xlsx.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"]);
    if (range.e.r - range.s.r > MAX_ROWS + 25 || range.e.c >= 100) throw new Error("Worksheet exceeds 5,000 data rows or 100 columns. Export a bounded sheet; rows are never silently discarded.");
    const matrix: Cell[][] = [];
    for (let r = 0; r <= range.e.r; r++) {
      const cells: Cell[] = [];
      for (let c = 0; c <= range.e.c; c++) {
        const cell = sheet[xlsx.utils.encode_cell({ r, c })];
        cells.push(cell ? { text: String(cell.w ?? cell.v ?? ""), ...(cell.t === "n" ? { numeric: cell.v as number } : {}), ...(cell.f ? { issue: "Formula cell: replace with a verified static value." } : cell.t === "e" || cell.t === "d" ? { issue: "Invalid or date cell: use manufacturing text." } : {}) } : { text: "" });
      }
      matrix.push(cells);
    }
    return makeSheet(name, matrix);
  });
  if (!sheets.length) throw new Error("Workbook contains no worksheets.");
  let defaultSheet = 0, best = -1;
  sheets.forEach((sheet, i) => { const score = sheet.rows.length ? Object.keys(detectColumns(sheet.headers)).length : -1; if (score > best) { best = score; defaultSheet = i; } });
  return { name: file.name, size: file.size, format, sheets, defaultSheet };
}
