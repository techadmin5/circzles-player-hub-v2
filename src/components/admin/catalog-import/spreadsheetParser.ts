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
  { key: "pieceCount", label: "Piece Count", aliases: ["Piece Count", "Pieces", "No of pieces", "No. of Pieces", "Number of Pieces"], optional: true },
  { key: "canonicalDesign", label: "Canonical Design", aliases: ["Canonical Design", "Design Family", "Design Key", "Canonical Name"], optional: true },
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
function makeSheet(name: string, matrix: Cell[][], originalRows?: number[]): Sheet {
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
  for (let i = header + 1; i < matrix.length; i++) if (matrix[i].some(cell => cell.text.trim() || cell.issue)) { rows.push(matrix[i]); rowNumbers.push(originalRows?.[i] ?? i + 1); }
  return { name, headers: matrix[header].map(cell => cell.text), rows, rowNumbers, headerRow: originalRows?.[header] ?? header + 1 };
}
// CSV is parsed as text, including quoted newlines and UTF-8; no numeric coercion.
export function parseCsv(text: string): Sheet {
  const matrix: Cell[][] = [], row: Cell[] = [];
  let value = "", quoted = false, closed = false;
  const pushCell = () => { row.push({ text: value }); value = ""; closed = false; };
  const pushRow = () => { pushCell(); matrix.push(row.splice(0)); };
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
    if (!isObject(row) || strings.some(k => typeof row[k] !== "string") || Object.keys(row).some(k => ![...strings, "pieceCount", "canonicalDesign"].includes(k)) || (row.canonicalDesign !== undefined && (typeof row.canonicalDesign !== "string" || !row.canonicalDesign.trim() || row.canonicalDesign.length > 200)) || (row.pieceCount !== undefined && (typeof row.pieceCount !== "number" || !Number.isInteger(row.pieceCount) || row.pieceCount <= 0))) throw new Error("JSON rows must use the existing source-row contract with text identity fields and optional positive numeric pieceCount.");
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
  return { name: file.name, size: file.size, format, ...openExcel(bytes, xlsx) };
}

// Metadata and bounded header samples never materialize all worksheet data.
export function openExcel(bytes: Uint8Array, xlsx: typeof import("xlsx")): Pick<ParsedFile, "sheets" | "defaultSheet" | "loadSheet"> {
  const metadata = xlsx.read(bytes, { type: "array", bookSheets: true, bookProps: true });
  const names = metadata.SheetNames;
  if (!names.length) throw new Error("Workbook contains no worksheets.");
  const sheets = names.map(name => makeSheet(name, []));
  const preferred = names.flatMap((name, i) => /catalog|manufactur|sku|final.*run/i.test(name) ? [i] : []);
  const candidates = [...new Set([...preferred, ...names.map((_, i) => i)])].slice(0, 8);
  let defaultSheet = 0, best = -1;
  for (const index of candidates) {
    try {
      const sample = xlsx.read(bytes, { type: "array", sheets: [index], sheetRows: 25, cellText: true, cellHTML: false });
      const sheet = sample.Sheets[names[index]];
      const matrix = worksheetMatrix(sheet, xlsx, 25, 100);
      if (!matrix.some(row => row.some(cell => cell.text.trim()))) continue;
      const headers = makeSheet(names[index], matrix).headers;
      const score = Object.keys(detectColumns(headers)).length;
      if (score > best) { best = score; defaultSheet = index; }
      if (score >= 8) break;
    } catch { /* An unusable sample must not prevent selecting other worksheets. */ }
  }
  return { sheets, defaultSheet, loadSheet: async index => {
    if (!Number.isInteger(index) || index < 0 || index >= names.length) throw new Error("Choose a valid worksheet.");
    // Retained bytes are local only; every read filters to the selected index.
    const workbook = xlsx.read(bytes, { type: "array", sheets: [index], cellNF: true, cellText: true, cellDates: true, cellHTML: false, cellFormula: true });
    const sheet = workbook.Sheets[names[index]];
    if (!sheet?.["!ref"]) return makeSheet(names[index], []);
    const range = xlsx.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"]);
    if (range.e.c >= 100) throw new Error("Selected worksheet exceeds 100 columns. Choose another worksheet or export a bounded sheet.");
    // Walk populated cells only: distant notes/formatting must not allocate a
    // dense matrix or consume the mapped catalog row budget before mapping.
    const populated = new Map<number, Cell[]>();
    for (const [address, cell] of Object.entries(sheet)) {
      if (!/^[A-Z]+[1-9][0-9]*$/.test(address)) continue;
      const position = xlsx.utils.decode_cell(address);
      const cells = populated.get(position.r) ?? [];
      cells[position.c] = cellValue(cell);
      populated.set(position.r, cells);
    }
    const physicalRows = [...populated.keys()].sort((a, b) => a - b);
    const matrix = physicalRows.map(row => Array.from({ length: range.e.c + 1 }, (_, col) => populated.get(row)![col] ?? { text: "" }));
    return makeSheet(names[index], matrix, physicalRows.map(row => row + 1));
  } };
}
function worksheetMatrix(sheet: import("xlsx").WorkSheet | undefined, xlsx: typeof import("xlsx"), maxRows: number, maxColumns: number): Cell[][] {
  if (!sheet?.["!ref"]) return [];
  const range = xlsx.utils.decode_range(sheet["!ref"]), matrix: Cell[][] = [];
  for (let r = 0; r <= Math.min(range.e.r, maxRows - 1); r++) {
    const cells: Cell[] = [];
    for (let c = 0; c <= Math.min(range.e.c, maxColumns - 1); c++) {
      const cell = sheet[xlsx.utils.encode_cell({ r, c })];
      cells.push(cellValue(cell));
    }
    matrix.push(cells);
  }
  return matrix;
}

function cellValue(cell: import("xlsx").CellObject | undefined): Cell {
  return cell ? { text: String(cell.w ?? cell.v ?? ""), ...(cell.t === "n" ? { numeric: cell.v as number } : {}), ...(cell.f ? { issue: "Formula cell: replace with a verified static value." } : cell.t === "e" || cell.t === "d" ? { issue: "Invalid or date cell: use manufacturing text." } : {}) } : { text: "" };
}
