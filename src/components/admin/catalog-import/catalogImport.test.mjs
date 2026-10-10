import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";
import { detectColumns, fields, missingColumns, parseCsv, parseFile, readManifest, openExcel } from "./spreadsheetParser.ts";
import { buildManifest, canApply, initialChoices, manifestRows, normalizeSheet, separateGroupKey, createSeparateDecisions } from "./manifestBuilder.ts";

const headers = ["Puzzle Name", "Size", "Brand Name", "Number Identifier", "Manufacturing Code", "Levels", "Units", "Sku Number", "Website SKU", "Notes"];
const values = ["Lion", "12", "CircZles", "29", "R2", "01", "48", "CC-29-R2-01-0001", "WEB-LION", "ignored"];
const source = { sourceId: "29-R2", name: "Lion", size: "12", brand: "CircZles", numberIdentifier: "29", manufacturingCode: "R2", level: "01", units: "48", firstFullSku: "CC-29-R2-01-0001", productType: "CIRCZLES" };
const manifest = { datasetId: "test", rows: [source], mappings: { "29-R2": { newVariantKey: "lion" } } };
const csv = (rows = [values]) => [headers, ...rows].map(row => row.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(",")).join("\r\n");
function normalized(rows = [values]) { const sheet = parseCsv(csv(rows)); return normalizeSheet(sheet, detectColumns(sheet.headers)); }
function built(rows = normalized(), decision = { newVariantKey: "new" }) { const choices = initialChoices(rows); for (const r of rows) choices[r.key].decision = decision; return buildManifest("test", rows, choices); }
function textFile(name, text) { return { name, size: Buffer.byteLength(text), text: async () => text }; }
function excelFile(format, sheets) {
  const book = XLSX.utils.book_new();
  for (const [name, sheet] of sheets) XLSX.utils.book_append_sheet(book, sheet, name);
  const bytes = XLSX.write(book, { type: "buffer", bookType: format === "xls" ? "biff8" : "xlsx" });
  return { name: "catalog." + format, size: bytes.length, arrayBuffer: async () => bytes };
}
async function loadedFile(file) {
  const parsed = await parseFile(file);
  parsed.sheets[parsed.defaultSheet] = await parsed.loadSheet(parsed.defaultSheet);
  return parsed;
}
test("JSON manifest file retains exact rows, dataset and explicit decisions", async () => {
  const parsed = await parseFile(textFile("catalog.json", JSON.stringify(manifest)));
  assert.deepEqual(parsed.manifest, manifest);
  assert.deepEqual(JSON.parse(JSON.stringify(buildManifest(parsed.manifest.datasetId, manifestRows(parsed.manifest), initialChoices(manifestRows(parsed.manifest), parsed.manifest)).manifest)), manifest);
});
for (const format of ["xlsx", "xls"]) test(format + " binary parsing preserves formatted cells and selects strongest worksheet", async () => {
  const data = XLSX.utils.aoa_to_sheet([headers, ["Abyss", "8", "CircZles", 1, "R1", 6, 500, "CC-01-R1-06-0001", "WEB", "note"]]);
  data.D2.z = "00"; data.F2.z = "00";
  const parsed = await loadedFile(excelFile(format, [["Empty", XLSX.utils.aoa_to_sheet([])], ["Notes", XLSX.utils.aoa_to_sheet([["note"], ["none"]])], ["Manufacturing", data]]));
  assert.deepEqual(parsed.sheets.map(s => s.name), ["Empty", "Notes", "Manufacturing"]); assert.equal(parsed.defaultSheet, 2);
  const sheet = parsed.sheets[2], rows = normalizeSheet(sheet, detectColumns(sheet.headers));
  assert.equal(rows[0].source.numberIdentifier, "01"); assert.equal(rows[0].source.level, "06"); assert.equal(rows[0].range, "1–500");
  assert.equal(rows[0].errors.length, 0);
  // Explicit sheet selection does not merge content from the other sheets.
  assert.equal((await parsed.loadSheet(1)).rows.length, 1); assert.equal(rows.length, 1);
});
test("unformatted Excel numeric identity is recovered only from agreeing exact SKU segments", async () => {
  const data = XLSX.utils.aoa_to_sheet([headers, ["Abyss", 8, "CircZles", 1, "R1", 6, 500, "CC-01-R1-06-0001"]]);
  const parsed = await loadedFile(excelFile("xlsx", [["Data", data]]));
  const rows = normalizeSheet(parsed.sheets[0], detectColumns(parsed.sheets[0].headers));
  assert.equal(rows[0].source.sourceId, "01-R1"); assert.equal(rows[0].source.level, "06"); assert.equal(rows[0].warnings.length, 2);
});
test("Excel numeric identity disagreements are errors, never guessed", async () => {
  const data = XLSX.utils.aoa_to_sheet([headers, ["Abyss", 8, "CircZles", 2, "R1", 7, 500, "CC-01-R1-06-0001"]]);
  const parsed = await loadedFile(excelFile("xlsx", [["Data", data]]));
  assert.match(normalizeSheet(parsed.sheets[0], detectColumns(parsed.sheets[0].headers))[0].errors.join(" "), /does not exactly match/);
});
test("UTF-8 CSV preserves quoted commas, quotes, newlines, zero strings and ignores extras", async () => {
  const row = ["Lión, \"gold\"\nart", "08", "CircZles ", "01", "R1", "06", "03", "CC-01-R1-06-0001", "WEB", "ignore"];
  const file = await parseFile(textFile("file.csv", "\uFEFF" + csv([row])));
  const rows = normalizeSheet(file.sheets[0], detectColumns(file.sheets[0].headers));
  assert.equal(rows[0].source.name, row[0]); assert.equal(rows[0].source.numberIdentifier, "01"); assert.equal(rows[0].source.units, "03");
  assert.equal("Website SKU" in rows[0].source, false); assert.equal(rows[0].source.brand, "CircZles ");
});
for (const field of fields) test("exact column aliases: " + field.label, () => {
  for (const alias of field.aliases) assert.equal(detectColumns([alias])[field.key], 0);
});
test("Website SKU never autodetects; explicit manufacturing SKU wins generic SKU", () => {
  assert.deepEqual(detectColumns(["Website SKU", "Website Product ID", "Price", "Notes"]), {});
  assert.equal(detectColumns(["Website SKU", "SKU", "Manufacturing SKU"]).firstFullSku, 2);
});
test("ambiguous duplicate header aliases require manual mapping and overrides work", () => {
  assert.equal(detectColumns(["Name", "Name"]).name, undefined);
  const sheet = parseCsv(csv()); const map = detectColumns(sheet.headers); map.name = 9;
  assert.equal(normalizeSheet(sheet, map)[0].source.name, "ignored");
  delete map.level; assert.deepEqual(missingColumns(map), ["Level"]);
});
for (const level of ["0.5", "3.5", "NA"]) test("preserves level " + level + " and exact manufacturing agreement", () => {
  const row = [...values]; row[5] = level; row[7] = "CC-29-R2-" + level + "-0001";
  const result = built(normalized([row])); assert.equal(result.issues.length, 0); assert.equal(result.manifest.rows[0].level, level);
  if (level === "NA") assert.match(result.selected[0].warnings.join(" "), /DRAFT/);
});
test("CC and CZ detection remains manually reviewable without bypassing SKU checks", () => {
  const rows = normalized([values, ["Board", "NA", "Cogzart", "15", "R1", "NA", "500", "CZ-15-R1-NA-0001"]]);
  assert.equal(rows[0].source.productType, "CIRCZLES"); assert.equal(rows[1].source.productType, "ACCESSORY");
  const choices = initialChoices(rows); choices[1].productType = "CIRCZLES";
  assert.equal(buildManifest("test", rows, choices).manifest.rows[1].productType, "CIRCZLES");
  assert.match(buildManifest("test", rows, choices).issues.map(e => e.message).join(" "), /SKU family/);
});
test("select all, deselect all and individual selection exclude rows and mappings", () => {
  const rows = normalized([values, ["LION", "12", "CircZles", "61", "R3", "01", "500", "CC-61-R3-01-0001"]]);
  const choices = initialChoices(rows); assert.equal(buildManifest("test", rows, choices).summary.selected, 2);
  choices[0].selected = false; choices[0].decision = { newVariantKey: "excluded" }; choices[1].decision = { newVariantKey: "selected" };
  const result = buildManifest("test", rows, choices); assert.deepEqual(result.manifest.rows.map(r => r.sourceId), ["61-R3"]); assert.deepEqual(Object.keys(result.manifest.mappings), ["61-R3"]);
  choices[1].selected = false; assert.match(buildManifest("test", rows, choices).issues[0].message, /Select between/);
});
test("duplicate source IDs and prefixes are reported on both rows without silently discarding", () => {
  const result = built(normalized([values, values])); assert.equal(result.manifest.rows.length, 2);
  assert.equal(result.issues.filter(e => e.message.startsWith("Duplicate sourceId")).length, 2);
  assert.equal(result.issues.filter(e => e.message.startsWith("Duplicate manufacturing prefix")).length, 2);
});
test("same-name rows never receive implicit canonical mappings", () => {
  const rows = normalized([values, ["Lion", "12", "CircZles", "61", "R3", "01", "500", "CC-61-R3-01-0001"]]);
  const result = buildManifest("test", rows, initialChoices(rows)); assert.equal(result.summary.needsMapping, 2); assert.equal(Object.keys(result.manifest.mappings).length, 0);
});
test("explicit shared keys and existing catalog IDs use the original backend contract", () => {
  const rows = normalized([values, ["LION", "12", "CircZles", "61", "R3", "01", "500", "CC-61-R3-01-0001"]]);
  const result = built(rows, { newVariantKey: "lion-group" }); assert.equal(result.issues.length, 0); assert.equal(result.summary.newVariants, 1); assert.equal(result.summary.sharedGroups, 1);
  const existing = built(rows, { catalogVariantId: "10000000-0000-4000-8000-000000000001" }); assert.equal(existing.summary.existingVariants, 1); assert.equal(existing.summary.newVariants, 0);
});
test("serial ranges derive from first serial and manufactured quantity", () => {
  const row = [...values]; row[6] = "500"; row[7] = "CC-29-R2-01-1001";
  assert.equal(normalized([row])[0].range, "1001–1500");
});
for (const [field, value, message] of [[6, "0", /positive integer/], [6, "-2", /positive integer/], [6, "1.5", /positive integer/], [7, "bad", /First Full SKU/], [5, "02", /Level does not exactly/], [4, "", /Manufacturing Run/]]) test("early validation rejects invalid field " + field + "=" + value, () => {
  const row = [...values]; row[field] = value; assert.match(built(normalized([row])).issues.map(e => e.message).join(" "), message);
});
test("successful current dry-run is required; errors, changes and unresolved mappings block apply", () => {
  const result = built(), snapshot = JSON.stringify(result.manifest), report = { ready: true, applied: false, errors: [], rows: 1, planned: 1, skipped: [] };
  assert.equal(canApply(null, snapshot, result.manifest, []), false);
  assert.equal(canApply(report, snapshot, result.manifest, []), true);
  assert.equal(canApply({ ...report, ready: false }, snapshot, result.manifest, []), false);
  assert.equal(canApply({ ...report, errors: [{ sourceId: "29-R2", message: "Conflict" }] }, snapshot, result.manifest, []), false);
  assert.equal(canApply(report, snapshot, result.manifest, ["mapping unresolved"]), false);
  assert.equal(canApply(report, snapshot, { ...result.manifest, datasetId: "changed" }, []), false);
  assert.equal(canApply({ ...report, applied: true }, snapshot, result.manifest, []), false);
});
test("final 82-row fixtures retain totals and Lion 29-R2 / 61-R3 decisions", async () => {
  const fixture = readManifest(await readFile(new URL("../../../../docs/circzles-catalog/r1-r2-r3.source.json", import.meta.url), "utf8"));
  const rows = manifestRows(fixture), choices = initialChoices(rows);
  for (const row of rows) choices[row.key].decision = { newVariantKey: row.source.sourceId === "61-R3" ? "29-R2" : row.source.sourceId };
  const result = buildManifest(fixture.datasetId, rows, choices);
  assert.equal(result.issues.length, 0); assert.equal(result.summary.found, 82); assert.equal(result.summary.totalUnits, "12001"); assert.equal(result.summary.accessories, 1); assert.equal(result.summary.newVariants, 81);
  assert.deepEqual(result.manifest.mappings["29-R2"], result.manifest.mappings["61-R3"]);
});
test("supports 5000 rows with bounded parse and no truncation", () => {
  const rows = Array.from({ length: 5000 }, (_, i) => ["Puzzle", "12", "CircZles", String(i + 100), "R4", "01", "1", `CC-${i + 100}-R4-01-0001`]);
  assert.equal(parseCsv(csv(rows)).rows.length, 5000);
  const overflow = normalized([...rows, rows[0]]); assert.match(buildManifest("test", overflow, initialChoices(overflow)).issues.map(e => e.message).join(" "), /5,000/);
});
test("mapped formula cells are blocked while formulas in irrelevant columns are ignored", async () => {
  const data = XLSX.utils.aoa_to_sheet([headers, values]); data.I2.f = '"WEB"';
  let parsed = await loadedFile(excelFile("xlsx", [["Data", data]]));
  assert.equal(normalizeSheet(parsed.sheets[0], detectColumns(parsed.sheets[0].headers))[0].errors.length, 0);
  data.G2.f = "24*2"; parsed = await loadedFile(excelFile("xlsx", [["Data", data]]));
  assert.match(normalizeSheet(parsed.sheets[0], detectColumns(parsed.sheets[0].headers))[0].errors.join(" "), /Formula cell/);
});
test("invalid format, oversize, binary mismatch, malformed CSV and unsupported JSON fail clearly", async () => {
  await assert.rejects(parseFile(textFile("bad.txt", "data")), /Choose an/);
  await assert.rejects(parseFile({ ...textFile("large.csv", "x"), size: 11 * 1024 * 1024 }), /10 MB/);
  await assert.rejects(parseFile({ name: "fake.xlsx", size: 4, arrayBuffer: async () => new Uint8Array([1, 2]) }), /does not match/);
  assert.throws(() => parseCsv('"bad'), /Unterminated/);
  assert.throws(() => readManifest('{"rows":[]}'), /datasetId/);
  assert.throws(() => readManifest(JSON.stringify({ ...manifest, rows: [{ ...source, unexpected: "no" }] })), /contract/);
});

test("new canonical groups cannot collide with loaded JSON keys", () => {
  const rows = normalized([values, ["LION", "12", "CircZles", "61", "R3", "01", "500", "CC-61-R3-01-0001"]]);
  const choices = initialChoices(rows); choices[0].decision = { newVariantKey: "import-group-0002" };
  assert.equal(separateGroupKey(1, choices), "import-group-0002-1");
  const created = createSeparateDecisions(rows, choices); assert.equal(created[1].decision.newVariantKey, "import-group-0002-1"); assert.equal(created[0].decision.newVariantKey, "import-group-0002");
});
test("unsafe Excel integer identity is blocked even when rounded numbers compare equally", async () => {
  const data = XLSX.utils.aoa_to_sheet([headers, ["Puzzle", "12", "CircZles", 1000000000000000000, "R4", 1, 500, "CC-1000000000000000001-R4-01-0001"]]);
  const parsed = await loadedFile(excelFile("xlsx", [["Data", data]]));
  assert.match(normalizeSheet(parsed.sheets[0], detectColumns(parsed.sheets[0].headers))[0].errors.join(" "), /unsafe Excel numeric/);
});
test("Excel digit formatting preserves leading zero units instead of changing import fingerprints", async () => {
  const data = XLSX.utils.aoa_to_sheet([headers, ["Lion", "12", "CircZles", "29", "R2", "01", 3, "CC-29-R2-01-0001"]]); data.G2.z = "00";
  const parsed = await loadedFile(excelFile("xlsx", [["Data", data]]));
  assert.equal(normalizeSheet(parsed.sheets[0], detectColumns(parsed.sheets[0].headers))[0].source.units, "03");
});

test("Website SKU cannot be manually substituted for manufacturing identity", () => {
  const sheet = parseCsv(csv()); const map = detectColumns(sheet.headers); map.firstFullSku = 8;
  assert.match(normalizeSheet(sheet, map)[0].errors.join(" "), /commercial data/);
});
test("Excel date-formatted manufacturing cells require verified static text", async () => {
  const data = XLSX.utils.aoa_to_sheet([headers, values]); data.D2 = { t: "n", v: 29, z: "m/d/yy" };
  const parsed = await loadedFile(excelFile("xlsx", [["Data", data]]));
  assert.match(normalizeSheet(parsed.sheets[0], detectColumns(parsed.sheets[0].headers))[0].errors.join(" "), /date cell/);
});

for (const format of ["xlsx", "xls"]) for (const count of [51, 201]) test(`metadata-first ${format} opening supports ${count} sheets with on-demand rows`, async () => {
  const sheets = Array.from({ length: count }, (_, i) => ["Archive " + i, XLSX.utils.aoa_to_sheet([["Notes"], ["Archive"]])]);
  sheets[count - 1] = ["Final Run SKU", XLSX.utils.aoa_to_sheet([headers, values])];
  const file = excelFile(format, sheets), calls = [];
  const opened = openExcel(new Uint8Array(await file.arrayBuffer()), { ...XLSX, read: (bytes, options) => { calls.push(options); return XLSX.read(bytes, options); } });
  assert.equal(opened.sheets.length, count); assert.equal(opened.sheets.at(-1).name, "Final Run SKU");
  assert.equal(opened.defaultSheet, count - 1); assert.ok(opened.sheets.every(s => s.rows.length === 0));
  assert.equal(calls[0].bookSheets, true); assert.equal(calls[0].bookProps, true);
  assert.ok(calls.slice(1).every(call => call.sheetRows === 25 && call.sheets.length === 1));
  assert.ok(calls.length <= 9);
  const selected = await opened.loadSheet(count - 1);
  assert.equal(selected.rows.length, 1); assert.equal(calls.at(-1).sheetRows, 0); assert.deepEqual(calls.at(-1).sheets, [count - 1]);
  assert.equal(selected.rows[0][7].text, "CC-29-R2-01-0001");
  const empty = await opened.loadSheet(0); assert.equal(empty.name, "Archive 0"); assert.equal(empty.rows.length, 1);
});
test("oversized unselected sheets do not block opening and selected row/column limits still apply", async () => {
  const large = XLSX.utils.aoa_to_sheet([headers, ...Array.from({ length: 5001 }, () => values)]);
  const wide = XLSX.utils.aoa_to_sheet([Array.from({ length: 101 }, (_, i) => "Column " + i), Array(101).fill("value")]);
  const opened = await parseFile(excelFile("xlsx", [["Final Run SKU", XLSX.utils.aoa_to_sheet([headers, values])], ["Oversized rows", large], ["Oversized columns", wide], ["Empty", XLSX.utils.aoa_to_sheet([])]]));
  assert.equal(opened.sheets.length, 4);
  assert.equal((await opened.loadSheet(0)).rows.length, 1);
  const oversized = await opened.loadSheet(1), tooMany = normalizeSheet(oversized, detectColumns(oversized.headers));
  assert.equal(tooMany.length, 5001); assert.match(buildManifest("test", tooMany, initialChoices(tooMany)).issues.map(e => e.message).join(" "), /5,000/);
  await assert.rejects(opened.loadSheet(2), /100 columns/);
  assert.equal((await opened.loadSheet(3)).rows.length, 0);
  assert.equal((await opened.loadSheet(0)).rows.length, 1);
});
test("51-sheet real-catalog-shaped workbook preserves the final 82 rows and 12001 units", async () => {
  const fixture = readManifest(await readFile(new URL("../../../../docs/circzles-catalog/r1-r2-r3.source.json", import.meta.url), "utf8"));
  const catalogRows = fixture.rows.map(r => [r.name, r.size, r.brand, r.numberIdentifier, r.manufacturingCode, r.level, r.units, r.firstFullSku]);
  const sheets = Array.from({ length: 50 }, (_, i) => ["Reference " + i, XLSX.utils.aoa_to_sheet([["Notes"], ["Not catalog data"]])]);
  sheets.push(["Final Run SKU", XLSX.utils.aoa_to_sheet([headers.slice(0, 8), ...catalogRows])]);
  const opened = await parseFile(excelFile("xlsx", sheets));
  const selected = await opened.loadSheet(opened.defaultSheet), rows = normalizeSheet(selected, detectColumns(selected.headers));
  const choices = createSeparateDecisions(rows, initialChoices(rows)), result = buildManifest("real-shaped", rows, choices);
  assert.equal(result.issues.length, 0); assert.equal(result.summary.found, 82); assert.equal(result.summary.totalUnits, "12001");
  assert.deepEqual(result.manifest.rows, fixture.rows);
});

for (const location of ["after", "between"]) test(`ignored-column-only rows ${location} catalog data do not become records`, () => {
  const note = Array(headers.length).fill(""); note[9] = "Reference text";
  const input = location === "after" ? [values, note, note] : [values, note, values];
  const rows = normalized(input);
  assert.equal(rows.length, location === "after" ? 1 : 2);
  assert.deepEqual(rows.map(r => r.rowNumber), location === "after" ? [2] : [2, 4]);
});
test("partial mapped data stays visible, while mapping changes recompute eligibility", () => {
  const partial = Array(headers.length).fill(""); partial[0] = "Incomplete product";
  const note = Array(headers.length).fill(""); note[9] = "Reference only";
  const sheet = parseCsv(csv([values, partial, note])), map = detectColumns(sheet.headers);
  let rows = normalizeSheet(sheet, map);
  assert.equal(rows.length, 2); assert.match(rows[1].errors.join(" "), /Units Manufactured is required/); assert.match(rows[1].errors.join(" "), /First Full SKU is required/);
  rows = normalizeSheet(sheet, { ...map, pieceCount: 9 });
  assert.equal(rows.length, 3); assert.match(rows[2].errors.join(" "), /Piece Count/);
  assert.equal(normalizeSheet(sheet, map).length, 2);
});
test("mapped zero/formula/error content qualifies and empty or whitespace-only ignored rows do not", () => {
  const sheet = { name: "Data", headers, headerRow: 1, rowNumbers: [2, 3, 4, 5], rows: [[{ text: "", numeric: 0 }], [{ text: "", issue: "Formula cell" }], [{ text: "" }, ...Array(8).fill({ text: "" }), { text: "reference" }], [{ text: "   " }]] };
  const rows = normalizeSheet(sheet, { name: 0 }); assert.deepEqual(rows.map(r => r.rowNumber), [2, 3]); assert.ok(rows.every(r => r.errors.length));
});
for (const format of ["xlsx", "xls"]) test(`real workbook-shaped ${format} has 82 catalog rows despite 44 distant column-17 references`, async () => {
  const fixture = readManifest(await readFile(new URL("../../../../docs/circzles-catalog/r1-r2-r3.source.json", import.meta.url), "utf8"));
  const matrix = Array.from({ length: 248 }, () => []);
  matrix[0] = ["Business workbook"]; matrix[2] = [...headers.slice(0, 8), ...Array(8).fill(""), "Reference Notes"];
  fixture.rows.forEach((r, i) => { matrix[i + 3] = [r.name, r.size, r.brand, r.numberIdentifier, r.manufacturingCode, r.level, r.units, r.firstFullSku]; });
  for (let i = 0; i < 44; i++) matrix[161 + i * 2][16] = fixture.rows[38 + i].name + " (reference only)";
  const opened = await parseFile(excelFile(format, [["circzles sku", XLSX.utils.aoa_to_sheet(matrix)]]));
  const selected = await opened.loadSheet(0), rows = normalizeSheet(selected, detectColumns(selected.headers));
  assert.equal(selected.rows.length, 126); assert.equal(rows.length, 82); assert.deepEqual(rows.map(r => r.rowNumber), Array.from({ length: 82 }, (_, i) => i + 4));
  const result = buildManifest("real-workbook", rows, initialChoices(rows)); assert.equal(result.summary.found, 82); assert.equal(result.summary.selected, 82); assert.equal(result.summary.totalUnits, "12001");
  assert.deepEqual(result.manifest.rows, fixture.rows);
});
test("distant ignored rows beyond the old raw-row cutoff are retained for deliberate remapping", async () => {
  const data = XLSX.utils.aoa_to_sheet([headers, values]); data.J6000 = { t: "s", v: "Reference after 6000" }; data["!ref"] = "A1:J6000";
  const opened = await parseFile(excelFile("xlsx", [["Data", data]])), sheet = await opened.loadSheet(0);
  assert.equal(normalizeSheet(sheet, detectColumns(sheet.headers)).length, 1);
  const remapped = normalizeSheet(sheet, { ...detectColumns(sheet.headers), name: 9 });
  assert.equal(remapped.length, 2); assert.equal(remapped[1].rowNumber, 6000); assert.ok(remapped[1].errors.length);
});

for (const alias of ["Piece Count", "Pieces", "No of pieces", "No. of Pieces", "Number of Pieces"]) test(`verified pieces map from ${alias}`, () => {
  const sheet = parseCsv(csv([values.map((v, i) => i === 8 ? "37" : v)]).replace("Website SKU", alias));
  assert.equal(detectColumns(sheet.headers).pieceCount, 8); assert.equal(normalizeSheet(sheet, detectColumns(sheet.headers))[0].source.pieceCount, 37);
});
for (const alias of ["Canonical Design", "Design Family", "Design Key", "Canonical Name"]) test(`optional family column ${alias} preserves verified design hint`, () => {
  const sheet = parseCsv(csv([values]).replace("Website SKU", alias));
  assert.equal(detectColumns(sheet.headers).canonicalDesign, 8); assert.equal(normalizeSheet(sheet, detectColumns(sheet.headers))[0].source.canonicalDesign, values[8]);
});
