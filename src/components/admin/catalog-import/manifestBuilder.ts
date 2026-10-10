import type { ImportReport } from "@/lib/catalogAdmin";
import { fields, MAX_ROWS, isWebsiteSku } from "./spreadsheetParser";
import type { Choices, ColumnMap, Manifest, PreviewRow, Sheet, SourceRow } from "./types";

const MAX_INTEGER = BigInt("9223372036854775807");
function positiveInteger(value: string): bigint | null {
  return /^[0-9]{1,19}$/.test(value) && BigInt(value) > BigInt("0") && BigInt(value) <= MAX_INTEGER ? BigInt(value) : null;
}
function inspect(source: SourceRow, key: number, rowNumber: number, warnings: string[], initial: string[] = []): PreviewRow {
  const errors = [...initial];
  for (const field of fields.filter(f => !f.optional)) if (!source[field.key]?.toString().trim()) errors.push(field.label + " is required.");
  for (const [name, value] of Object.entries(source)) if (typeof value === "string" && value.length > 200) errors.push(name + " exceeds 200 characters.");
  if (!source.sourceId.trim()) errors.push("Source ID is required.");
  const parts = /^(CC|CZ)-([0-9]{1,20})-(R[1-9][0-9]{0,8})-([0-9]+(?:\.[0-9])?|NA)-([0-9]{1,19})$/.exec(source.firstFullSku);
  let prefix = "", range = "";
  const units = positiveInteger(source.units);
  if (!units) errors.push("Units must be a positive integer within PostgreSQL bigint.");
  if (!/^[0-9]{1,20}$/.test(source.numberIdentifier)) errors.push("Number Identifier must contain manufacturing digits.");
  if (!/^R[1-9][0-9]{0,8}$/.test(source.manufacturingCode)) errors.push("Manufacturing Run must use R followed by a positive integer.");
  if (source.level !== "NA" && (!/^[0-9]+(?:\.[0-9])?$/.test(source.level) || Number(source.level) <= 0 || Number(source.level) > 999.9)) errors.push("Level must be positive with at most one decimal, or NA for an incomplete draft.");
  if (!["CIRCZLES", "ACCESSORY"].includes(source.productType)) errors.push("Confirm a supported product type.");
  if (source.pieceCount !== undefined && (!Number.isSafeInteger(source.pieceCount) || source.pieceCount <= 0 || source.pieceCount > 1000000)) errors.push("Piece Count must be a positive integer up to 1,000,000.");
  if (!parts) errors.push("First Full SKU must preserve family-number-run-level-serial manufacturing identity.");
  else {
    prefix = source.firstFullSku.slice(0, source.firstFullSku.lastIndexOf("-"));
    if (parts[2] !== source.numberIdentifier) errors.push("Number Identifier does not exactly match SKU; reconcile the source.");
    if (parts[3] !== source.manufacturingCode) errors.push("Manufacturing Run does not match SKU.");
    if (parts[4] !== source.level) errors.push("Level does not exactly match SKU; reconcile the source.");
    if (parts[1] !== (source.productType === "ACCESSORY" ? "CZ" : "CC")) errors.push("Product Type does not match manufacturing SKU family.");
    const start = positiveInteger(parts[5]);
    if (!start) errors.push("First serial must be a positive PostgreSQL bigint.");
    if (start && units) {
      const end = start + units - BigInt("1");
      if (end > MAX_INTEGER) errors.push("Manufactured serial range exceeds PostgreSQL bigint.");
      else range = start + "–" + end;
    }
  }
  if (source.level === "NA") warnings.push("NA level: incomplete DRAFT; no playable or claimable CircZles.");
  if (source.productType === "ACCESSORY") warnings.push("Accessory: catalog/manufacturing only; cannot be claimed through Add CircZles.");
  return { key, rowNumber, source, prefix, range, warnings, errors };
}
export function normalizeSheet(sheet: Sheet, map: ColumnMap): PreviewRow[] {
  const mapped = fields.flatMap(field => map[field.key] === undefined ? [] : [map[field.key]!]);
  return sheet.rows.flatMap((cells, key) => {
    // Unmapped notes are not catalog records. Keep any partial mapped data,
    // including numeric zero and formula/error cells, visible for validation.
    if (!mapped.some(index => cells[index]?.text.trim() || cells[index]?.issue || cells[index]?.numeric !== undefined)) return [];
    const values: Record<string, string> = {}, errors: string[] = [], warnings: string[] = [];
    if (map.firstFullSku !== undefined && isWebsiteSku(sheet.headers[map.firstFullSku] ?? "")) errors.push("Website SKU is commercial data; choose the manufacturing SKU column.");
    for (const field of fields) {
      const index = map[field.key], cell = index === undefined ? undefined : cells[index];
      values[field.key] = cell?.text ?? "";
      if (cell?.issue) errors.push(field.label + ": " + cell.issue);
      if (cell?.numeric !== undefined && ["units", "pieceCount"].includes(field.key)) {
        if (!Number.isSafeInteger(cell.numeric)) errors.push(field.label + ": numeric value must be a safe integer; use exact text for larger values.");
        if (!/^[0-9]+$/.test(cell.text) || Number(cell.text) !== cell.numeric) {
          values[field.key] = String(cell.numeric);
          if (cell.text !== values[field.key]) warnings.push(field.label + " normalized from Excel formatting to " + values[field.key] + ".");
        }
      }
    }
    const parts = values.firstFullSku.split("-");
    // Only typed numeric Excel cells may recover zero padding from the exact SKU.
    for (const [field, part] of [["numberIdentifier", 1], ["level", 3]] as const) {
      const cell = map[field] === undefined ? undefined : cells[map[field]!];
      if (field === "numberIdentifier" && cell?.numeric !== undefined && !Number.isSafeInteger(cell.numeric)) errors.push("Number Identifier is an unsafe Excel numeric value; replace it with verified exact text.");
      if (cell?.numeric !== undefined && /^[0-9]+(?:\.[0-9])?$/.test(parts[part] ?? "") && cell.numeric === Number(parts[part]) && values[field] !== parts[part]) {
        warnings.push(field + " normalized from Excel numeric " + values[field] + " to SKU text " + parts[part] + "."); values[field] = parts[part];
      }
    }
    const source: SourceRow = { sourceId: values.numberIdentifier + "-" + values.manufacturingCode, name: values.name, size: values.size, brand: values.brand, numberIdentifier: values.numberIdentifier, manufacturingCode: values.manufacturingCode, level: values.level, units: values.units, firstFullSku: values.firstFullSku, productType: parts[0] === "CZ" ? "ACCESSORY" : "CIRCZLES", ...(values.pieceCount ? { pieceCount: Number(values.pieceCount) } : {}) };
    if (values.canonicalDesign.trim()) source.canonicalDesign = values.canonicalDesign.trim();
    return [inspect(source, key, sheet.rowNumbers[key], warnings, errors)];
  });
}
export function manifestRows(manifest: Manifest): PreviewRow[] {
  return manifest.rows.map((source, key) => inspect({ ...source }, key, key + 1, []));
}
export function initialChoices(rows: PreviewRow[], manifest?: Manifest): Choices {
  return Object.fromEntries(rows.map(row => {
    const decision = manifest && Object.hasOwn(manifest.mappings, row.source.sourceId) ? manifest.mappings[row.source.sourceId] : undefined;
    return [row.key, { selected: true, identityState: decision ? decision.catalogVariantId ? "EXISTING-CANONICAL" : "AUTO-SEPARATE" : "NEEDS-REVIEW", identityReason: decision ? "Reviewed manifest identity." : row.errors.length ? "Resolve row validation before product identity." : "Checking verified design, size, level and pieces.", ...(decision ? { decision } : {}) }];
  }));
}
export function separateGroupKey(key: number, choices: Choices): string {
  const used = new Set(Object.entries(choices).filter(([id]) => Number(id) !== key).flatMap(([, choice]) => choice.decision?.newVariantKey ? [choice.decision.newVariantKey] : []));
  const base = "import-group-" + String(key + 1).padStart(4, "0");
  let candidate = base, suffix = 1;
  while (used.has(candidate)) candidate = base + "-" + suffix++;
  return candidate;
}
export function createSeparateDecisions(rows: PreviewRow[], choices: Choices): Choices {
  const next = { ...choices };
  const used = new Set(Object.values(choices).flatMap(c => c.decision?.newVariantKey ? [c.decision.newVariantKey] : []));
  for (const row of rows) if (next[row.key]?.selected && !next[row.key].decision) {
    const base = "import-group-" + String(row.key + 1).padStart(4, "0");
    let candidate = base, suffix = 1;
    while (used.has(candidate)) candidate = base + "-" + suffix++;
    used.add(candidate); next[row.key] = { ...next[row.key], needsReview: false, identityState: "AUTO-SEPARATE", identityReason: "Operator explicitly chose a separate product identity override.", decision: { newVariantKey: candidate } };
  }
  return next;
}
export function buildManifest(datasetId: string, rows: PreviewRow[], choices: Choices) {
  const selected = rows.filter(row => choices[row.key]?.selected);
  const issues: { key: number; sourceId: string; message: string }[] = [];
  const manifest: Manifest = { datasetId, rows: [], mappings: Object.create(null) };
  const ids = new Map<string, number>(), prefixes = new Map<string, number>();
  let totalUnits = BigInt("0"), needsMapping = 0;
  const newKeys = new Map<string, number>(), existingIds = new Set<string>();
  if (!datasetId.trim() || datasetId.length > 200) issues.push({ key: -1, sourceId: "Dataset", message: "Use a stable dataset ID between 1 and 200 characters." });
  if (!selected.length || selected.length > MAX_ROWS) issues.push({ key: -1, sourceId: "Selection", message: "Select between 1 and 5,000 rows." });
  for (const row of selected) {
    const choice = choices[row.key], source = { ...row.source, productType: choice.productType ?? row.source.productType };
    const checked = inspect(source, row.key, row.rowNumber, [], row.errors.filter(e => !e.startsWith("Product Type")));
    for (const message of new Set(checked.errors)) issues.push({ key: row.key, sourceId: source.sourceId, message });
    for (const [map, value, label] of [[ids, source.sourceId, "sourceId"], [prefixes, row.prefix, "manufacturing prefix"]] as const) {
      if (value && map.has(value)) {
        issues.push({ key: row.key, sourceId: source.sourceId, message: "Duplicate " + label + "; explicitly reconcile or skip the duplicate." });
        issues.push({ key: map.get(value)!, sourceId: source.sourceId, message: "Duplicate " + label + "; explicitly reconcile or skip the duplicate." });
      }
      map.set(value, row.key);
    }
    const decision = choice.decision;
    if (choice.needsReview) issues.push({ key: row.key, sourceId: source.sourceId, message: "NEEDS-REVIEW: " + (choice.identityReason ?? "Confirm product identity before applying.") });
    if (!decision || Boolean(decision.catalogVariantId) === Boolean(decision.newVariantKey)) { needsMapping++; issues.push({ key: row.key, sourceId: source.sourceId, message: "Explicit canonical mapping required; names are never merged automatically." }); }
    else {
      if (decision.catalogVariantId) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decision.catalogVariantId)) issues.push({ key: row.key, sourceId: source.sourceId, message: "Choose a valid existing catalog variant." });
        existingIds.add(decision.catalogVariantId);
      } else {
        if (!decision.newVariantKey!.trim() || decision.newVariantKey!.length > 200) issues.push({ key: row.key, sourceId: source.sourceId, message: "New canonical key must contain 1–200 characters." });
        newKeys.set(decision.newVariantKey!, (newKeys.get(decision.newVariantKey!) ?? 0) + 1);
      }
      manifest.mappings[source.sourceId] = decision;
    }
    const units = positiveInteger(source.units); if (units) totalUnits += units;
    manifest.rows.push(source);
  }
  return { manifest, issues, selected, summary: { found: rows.length, selected: selected.length, skipped: rows.length - selected.length, circzles: manifest.rows.filter(r => r.productType === "CIRCZLES").length, accessories: manifest.rows.filter(r => r.productType === "ACCESSORY").length, totalUnits: totalUnits.toString(), newVariants: newKeys.size, existingVariants: existingIds.size, sharedGroups: [...newKeys.values()].filter(n => n > 1).length, needsMapping, errorRows: new Set(issues.map(e => e.key)).size } };
}
export function canApply(report: ImportReport | null, previewSnapshot: string, manifest: Manifest, issues: unknown[]): boolean {
  return !!report?.ready && !report.applied && !report.errors.length && !issues.length && previewSnapshot === JSON.stringify(manifest);
}
