"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { catalogAdmin, type CatalogVariant, type ImportReport } from "@/lib/catalogAdmin";
import { buildManifest, canApply, initialChoices, manifestRows, normalizeSheet, separateGroupKey, createSeparateDecisions } from "./manifestBuilder";
import { detectColumns, fields, missingColumns, parseFile, readManifest, isWebsiteSku } from "./spreadsheetParser";
import type { Choices, ColumnMap, ParsedFile, PreviewRow, RowChoice, Sheet } from "./types";

const input = "mt-1 min-h-11 w-full rounded-lg border border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] p-2";
const steps = ["Upload", "Worksheet & columns", "Select rows", "Canonical mapping", "Summary", "Validation"];
const errorText = (e: unknown) => e instanceof Error ? e.message : "Import request failed. Review and retry.";
const pageSize = 50;

export function CatalogImportWizard({ onApplied }: { onApplied: () => void }) {
  const [file, setFile] = useState<ParsedFile | null>(null), [sheetIndex, setSheetIndex] = useState(0), [columns, setColumns] = useState<ColumnMap>({});
  const [loadedSheet, setLoadedSheet] = useState<Sheet | null>(null);
  const [choices, setChoices] = useState<Choices>({}), [dataset, setDataset] = useState(""), [step, setStep] = useState(0), [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null), [snapshot, setSnapshot] = useState(""), [confirm, setConfirm] = useState(false);
  const [focusKey, setFocusKey] = useState<number | null>(null), [query, setQuery] = useState(""), [variants, setVariants] = useState<CatalogVariant[]>([]), [searchBusy, setSearchBusy] = useState(false), [searchError, setSearchError] = useState("");
  const [reuseSearch, setReuseSearch] = useState(""), [advanced, setAdvanced] = useState<string | null>(null);
  const epoch = useRef(0), alive = useRef(true), pending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const sheet = loadedSheet;
  const rows: PreviewRow[] = useMemo(() => file?.manifest ? manifestRows(file.manifest) : sheet ? normalizeSheet(sheet, columns) : [], [file, sheet, columns]);
  const built = useMemo(() => buildManifest(dataset, rows, choices), [dataset, rows, choices]);
  const visible = (step === 3 ? built.selected : rows).slice(page * pageSize, (page + 1) * pageSize);
  const focused = rows.find(row => row.key === focusKey);
  const ready = advanced === null && canApply(report, snapshot, built.manifest, built.issues);
  const mappedColumns = new Set(Object.values(columns));
  useEffect(() => {
    if (step !== 3 || !focused) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearchBusy(true); setSearchError("");
      catalogAdmin.list(new URLSearchParams({ search: query, limit: "50", offset: "0" }), controller.signal)
        .then(result => { if (!controller.signal.aborted) setVariants(result); })
        .catch(e => { if (!controller.signal.aborted) { setVariants([]); setSearchError(errorText(e)); } })
        .finally(() => { if (!controller.signal.aborted) setSearchBusy(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [step, focusKey, query, focused]);
  function invalidate() { epoch.current++; setReport(null); setSnapshot(""); setConfirm(false); setNotice(""); setError(""); }
  function choose(key: number, change: Partial<RowChoice>) { invalidate(); setChoices(current => ({ ...current, [key]: { ...current[key], ...change } })); }
  function install(parsed: ParsedFile) {
    invalidate(); setFile(parsed); setLoadedSheet(parsed.manifest ? null : parsed.sheets[parsed.defaultSheet]); setSheetIndex(parsed.defaultSheet); setPage(0); setFocusKey(null); setQuery("");
    const map = parsed.manifest ? {} : detectColumns(parsed.sheets[parsed.defaultSheet]?.headers ?? []);
    setColumns(map);
    const normalized = parsed.manifest ? manifestRows(parsed.manifest) : normalizeSheet(parsed.sheets[parsed.defaultSheet], map);
    setChoices(initialChoices(normalized, parsed.manifest));
    setDataset(parsed.manifest?.datasetId ?? (parsed.name.replace(/\.[^.]+$/, "") + "-" + (parsed.sheets[parsed.defaultSheet]?.name ?? "catalog")).slice(0, 200));
    setAdvanced(null); setStep(parsed.manifest ? 2 : 1);
  }
  async function upload(selected: File) {
    if (pending.current) return;
    invalidate(); setFile(null); setLoadedSheet(null); setChoices({}); setStep(0); pending.current = true; setBusy(true);
    const version = epoch.current;
    try {
      const parsed = await parseFile(selected);
      if (alive.current && version === epoch.current) {
        install(parsed);
        if (parsed.loadSheet) {
          const loadingVersion = epoch.current;
          try { const selectedSheet = await parsed.loadSheet(parsed.defaultSheet); if (alive.current && loadingVersion === epoch.current) acceptSheet(selectedSheet); }
          catch (e) { if (alive.current && loadingVersion === epoch.current) { setLoadedSheet(null); setError(errorText(e)); } }
        }
      }
    }
    catch (e) { if (alive.current && version === epoch.current) setError(errorText(e)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  function acceptSheet(selected: Sheet) {
    setLoadedSheet(selected); const map = detectColumns(selected.headers); setColumns(map);
    setChoices(initialChoices(normalizeSheet(selected, map)));
  }
  async function changeSheet(index: number) {
    if (!file || pending.current) return;
    invalidate(); setSheetIndex(index); setLoadedSheet(null); setColumns({}); setChoices({}); setAdvanced(null); setStep(1); setPage(0); setFocusKey(null); setQuery("");
    setDataset((file.name.replace(/\.[^.]+$/, "") + "-" + file.sheets[index].name).slice(0, 200));
    pending.current = true; setBusy(true); const version = epoch.current;
    try { const selected = file.loadSheet ? await file.loadSheet(index) : file.sheets[index]; if (alive.current && version === epoch.current) acceptSheet(selected); }
    catch (e) { if (alive.current && version === epoch.current) setError(errorText(e)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  function mapColumn(key: keyof ColumnMap, value: string) {
    invalidate(); const map = { ...columns }; if (value === "") delete map[key]; else map[key] = Number(value);
    setColumns(map); setChoices(initialChoices(normalizeSheet(sheet!, map))); setFocusKey(null); setPage(0);
  }
  async function validate() {
    if (pending.current || built.issues.length || advanced !== null) return;
    const current = JSON.stringify(built.manifest); invalidate(); const version = epoch.current;
    pending.current = true; setBusy(true); setStep(5);
    try { const result = await catalogAdmin.import(built.manifest); if (alive.current && version === epoch.current) { setReport(result); setSnapshot(current); } }
    catch (e) { if (alive.current && version === epoch.current) setError(errorText(e)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function apply() {
    if (pending.current || !confirm || !ready) return;
    pending.current = true; setBusy(true); setError(""); setConfirm(false);
    const version = epoch.current;
    try {
      const result = await catalogAdmin.import(built.manifest, true);
      if (alive.current && version === epoch.current) { setReport(result); setSnapshot(""); setNotice("Import completed successfully. Created: " + result.planned + " batches. Skipped as already imported: " + result.skipped.length + "."); onApplied(); }
    } catch (e) { if (alive.current && version === epoch.current) { setError(errorText(e) + " Run validation again before retrying. If the response was lost, the same dataset can safely be rerun."); setReport(null); setSnapshot(""); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  function go(next: number) { setStep(next); setPage(0); if (next === 3) setFocusKey(built.selected[0]?.key ?? null); }
  function reviewRow(key: number) { go(3); setFocusKey(key); setQuery(""); setReuseSearch(""); setPage(Math.max(0, Math.floor(built.selected.findIndex(r => r.key === key) / pageSize))); }
  const plannedRows = built.manifest.rows.filter(row => !report?.skipped.includes(row.sourceId));
  const plannedUnits = plannedRows.reduce((sum, row) => sum + (/^[0-9]+$/.test(row.units) ? BigInt(row.units) : BigInt("0")), BigInt("0")).toString();
  const plannedNew = new Set(plannedRows.flatMap(row => built.manifest.mappings[row.sourceId]?.newVariantKey ? [built.manifest.mappings[row.sourceId].newVariantKey] : [])).size;
  return <section className="cz-surface space-y-4 p-5" aria-labelledby="catalog-import-title">
    <h2 id="catalog-import-title" className="cz-display text-xl">Import CircZles Catalog</h2>
    <p className="text-sm">Upload a spreadsheet, select rows, explicitly resolve canonical products, then dry-run and confirm. Files are parsed in this browser; only the selected catalog manifest is sent to the existing admin API.</p>
    <ol className="flex flex-wrap gap-3 text-sm" aria-label="Import steps">{steps.map((name, i) => <li key={name} aria-current={step === i ? "step" : undefined} className={step === i ? "font-bold" : "opacity-70"}>{i + 1}. {name}</li>)}</ol>
    {error && <p role="alert" className="text-[var(--cz-danger)]">{error}</p>}{notice && <p role="status">{notice}</p>}
    <fieldset disabled={busy || confirm} className="space-y-4 min-w-0">
      <label className="block">Upload file (.xlsx, .xls, .csv, .json; up to 10 MB)<input aria-label="Catalog source file" type="file" accept=".xlsx,.xls,.csv,.json" className={input} onChange={event => { const selected = event.target.files?.[0]; event.target.value = ""; if (selected) void upload(selected); }} /></label>
      {busy && <p role="status">{file ? "Processing catalog request…" : "Reading file…"}</p>}
      {file && <>
        <p className="text-sm">File: {file.name} · {file.format.toUpperCase()} · {file.size.toLocaleString()} bytes{file.sheets.length > 0 && ` · ${file.sheets.length} worksheet(s)`} · Worksheet: {file.manifest ? "JSON manifest" : file.sheets[sheetIndex]?.name}</p>
        <label className="block">Dataset ID<input aria-label="Import dataset ID" className={input} value={dataset} onChange={e => { invalidate(); setDataset(e.target.value); }} maxLength={200} /><span className="text-sm">Keep this ID and all source/mapping values unchanged on reruns. Download the prepared manifest to preserve decisions. A different dataset ID does not permit reusing reserved prefixes.</span></label>
        {file.loadSheet && <label className="block">Select worksheet<select aria-label="Select worksheet" className={input} value={sheetIndex} onChange={e => void changeSheet(Number(e.target.value))}>{file.sheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}</select></label>}
        {!file.manifest && !busy && (!sheet || !rows.length) && <p role="status">{error ? "This worksheet could not be loaded. Choose another worksheet." : "No usable rows found. Choose another worksheet or upload a sheet with catalog data."}</p>}
        {step === 1 && sheet && <>

          <p className="text-sm">Headers detected at worksheet row {sheet.headerRow}. Only this worksheet is used. Changing worksheet or columns clears row choices and canonical decisions.</p>
          <div className="grid gap-3 sm:grid-cols-3">{fields.map(field => <label key={field.key}>{field.label}{field.optional ? " (optional)" : " *"}<select aria-label={"Column for " + field.label} className={input} value={columns[field.key] ?? ""} onChange={e => mapColumn(field.key, e.target.value)}><option value="">{field.optional ? "Ignore / blank" : "Choose source column"}</option>{sheet.headers.map((header, i) => <option key={i} value={i} disabled={field.key === "firstFullSku" && isWebsiteSku(header)}>{i + 1}. {header || "Unnamed"}</option>)}</select></label>)}</div>
          <p className="text-sm">Ignored columns: {sheet.headers.flatMap((header, i) => mappedColumns.has(i) ? [] : [(header || "Column " + (i + 1)) + " → Ignored"]).join("; ") || "None"}</p>
          {!!missingColumns(columns).length && <p role="alert">Map required columns: {missingColumns(columns).join(", ")}</p>}
          <button className="cz-btn cz-btn-primary" disabled={!!missingColumns(columns).length || !rows.length} onClick={() => go(2)}>Preview normalized rows</button>
        </>}
        {(step === 2 || step === 3) && <>
          <div className="flex flex-wrap items-center gap-3"><p>Selected {built.summary.selected} of {rows.length} rows</p><button className="cz-btn" onClick={() => { invalidate(); setChoices(current => Object.fromEntries(rows.map(row => [row.key, { ...current[row.key], selected: true }]))); }}>Select All</button><button className="cz-btn" onClick={() => { invalidate(); setChoices(current => Object.fromEntries(rows.map(row => [row.key, { ...current[row.key], selected: false }]))); }}>Deselect All</button></div>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Normalized catalog rows</caption><thead><tr>{["Import?", "CircZles Name", "Size", "Brand", "Number", "Run", "Level", "Units", "SKU Prefix", "First Full SKU", "Serial Range", "Product Type", "Validation / Mapping"].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{visible.map(row => {
            const choice = choices[row.key], issues = built.issues.filter(e => e.key === row.key), decision = choice?.decision;
            return <tr key={row.key} className="border-t border-[var(--cz-hairline)]"><td className="p-2"><input aria-label={"Import row " + row.rowNumber} type="checkbox" checked={!!choice?.selected} onChange={e => choose(row.key, { selected: e.target.checked })} /></td>{[row.source.name, row.source.size, row.source.brand, row.source.numberIdentifier, row.source.manufacturingCode, row.source.level, row.source.units, row.prefix, row.source.firstFullSku, row.range].map((value, i) => <td key={i} className="p-2 whitespace-nowrap">{value}</td>)}<td className="p-2"><select aria-label={"Product type for row " + row.rowNumber} value={choice?.productType ?? row.source.productType} onChange={e => choose(row.key, { productType: e.target.value as "CIRCZLES" | "ACCESSORY" })}><option>CIRCZLES</option><option>ACCESSORY</option></select></td><td className="p-2 min-w-64">{row.warnings.map(w => <p key={w}>{w}</p>)}{issues.map((e, i) => <p key={i} className="text-[var(--cz-danger)]">{e.message}</p>)}{!issues.length && <p>{choice?.selected ? "Ready for server validation" : "Skipped"}</p>}{decision && <p>{decision.newVariantKey ? "New canonical group: " + decision.newVariantKey : "Existing canonical selected"}</p>}<button className="cz-btn" disabled={!choice?.selected} onClick={() => reviewRow(row.key)}>Resolve row {row.rowNumber}</button></td></tr>;
          })}</tbody></table></div>
          <div className="flex items-center gap-3"><button className="cz-btn" disabled={!page} onClick={() => setPage(p => p - 1)}>Previous rows</button><span>Page {page + 1} · up to 50 rows per page</span><button className="cz-btn" disabled={(page + 1) * pageSize >= (step === 3 ? built.selected.length : rows.length)} onClick={() => setPage(p => p + 1)}>Next rows</button></div>
          {step === 3 && <>
            <p className="text-sm">Names are review hints only. New groups and existing canonical products must be explicitly chosen. Accessories use catalog identities without creating playable products.</p>
            <button className="cz-btn" onClick={() => { invalidate(); setChoices(current => createSeparateDecisions(built.selected, current)); }}>Create separate canonical products for all unmapped selected rows</button>
            {focused && choices[focused.key]?.selected && <article className="space-y-3 rounded-xl border border-[var(--cz-hairline-strong)] p-4" aria-label="Canonical decision">
              <h3 className="font-bold">Row {focused.rowNumber}: {focused.source.name} · {focused.prefix}</h3>
              <p>Current decision: {choices[focused.key]?.decision?.newVariantKey ?? (choices[focused.key]?.decision?.catalogVariantId ? (variants.find(v => v.catalogVariantId === choices[focused.key]?.decision?.catalogVariantId)?.displayName ?? "Existing canonical product selected") : "Unresolved")}</p>
              {choices[focused.key]?.decision?.catalogVariantId && <p className="text-xs opacity-70">Catalog variant ID: {choices[focused.key].decision!.catalogVariantId}</p>}
              <div className="flex flex-wrap gap-2"><button className="cz-btn" onClick={() => choose(focused.key, { decision: { newVariantKey: separateGroupKey(focused.key, choices) } })}>Create new canonical product</button><button className="cz-btn" onClick={() => choose(focused.key, { decision: undefined })}>Clear canonical decision</button></div>
              <label className="block">Search existing canonical CircZles<input aria-label="Search existing canonical CircZles" className={input} value={query} onChange={e => { setVariants([]); setQuery(e.target.value); }} /></label>
              {searchBusy && <p role="status">Searching catalog…</p>}{searchError && <p role="alert">{searchError}</p>}
              <label className="block">Map to existing canonical product<select aria-label="Existing canonical product" className={input} value={variants.some(v => v.catalogVariantId === choices[focused.key]?.decision?.catalogVariantId) ? choices[focused.key]?.decision?.catalogVariantId : ""} onChange={e => { if (e.target.value) choose(focused.key, { decision: { catalogVariantId: e.target.value } }); }}><option value="">Choose explicitly (search to find more)</option>{variants.map(v => <option key={v.catalogVariantId} value={v.catalogVariantId}>{v.displayName} · Size {v.sizeLabel ?? "NA"} · Level {v.levelId ?? "NA"} · {v.status} · {v.catalogVariantId}</option>)}</select></label>
              <label className="block">Find another row’s new canonical group<input aria-label="Find shared canonical group" className={input} value={reuseSearch} onChange={e => setReuseSearch(e.target.value)} placeholder="Search source ID or name" /></label>
              <label className="block">Reuse another row’s new canonical key<select aria-label="Reuse new canonical group" className={input} value="" onChange={e => { if (e.target.value) choose(focused.key, { decision: { newVariantKey: e.target.value } }); }}><option value="">Choose explicitly (up to 50 matching rows)</option>{built.selected.filter(r => r.key !== focused.key && choices[r.key]?.decision?.newVariantKey && (r.source.sourceId + " " + r.source.name).toLowerCase().includes(reuseSearch.toLowerCase())).slice(0, 50).map(r => <option key={r.key} value={choices[r.key].decision!.newVariantKey}>{r.source.name} · {r.prefix} · {choices[r.key].decision!.newVariantKey}</option>)}</select></label>
            </article>}
          </>}
        </>}
        {step >= 4 && <>
          <h3 className="font-bold">Import summary</h3><dl className="grid gap-2 sm:grid-cols-3">{Object.entries({ "Rows found": built.summary.found, "Rows selected": built.summary.selected, "Rows skipped": built.summary.skipped, "CircZles rows": built.summary.circzles, "Accessory rows": built.summary.accessories, "Manufactured units": built.summary.totalUnits, "New canonical variants planned": built.summary.newVariants, "Existing variants referenced": built.summary.existingVariants, "Shared new canonical groups": built.summary.sharedGroups, "Rows needing mapping": built.summary.needsMapping, "Rows with errors": built.summary.errorRows }).map(([label, value]) => <div key={label}><dt className="text-sm opacity-70">{label}</dt><dd className="font-bold">{value}</dd></div>)}</dl>
          <p className="text-sm">Counts are based on selected source rows. The server identifies already imported rows and validates all configuration. New playable variants do not receive competition/reward configuration from this workflow.</p>
          {!!built.issues.length && <div role="alert">{built.issues.slice(0, 100).map((issue, i) => <p key={i}><button className="underline" onClick={() => issue.key < 0 ? go(2) : reviewRow(issue.key)}>{issue.sourceId}: {issue.message}</button></p>)}{built.issues.length > 100 && <p>Showing the first 100 issues; review rows to resolve the rest.</p>}</div>}
          <div className="flex gap-3"><button className="cz-btn" disabled={!!built.issues.length || advanced !== null} onClick={() => void validate()}>Dry-run validation</button><button className="cz-btn cz-btn-primary" disabled={!ready} onClick={() => setConfirm(true)}>Apply validated import</button></div>
          {report && <div role="status"><p>{report.applied ? "Applied" : "Preview only — no database changes have been made"}: {report.rows} rows · {report.planned} planned · {report.skipped.length} already imported</p>{report.reconciliationCandidates?.slice(0, 100).map(candidate => <p key={candidate.name}>Possible repeat: {candidate.name} · {candidate.sourceIds.join(", ")}. Review required; no automatic merge.</p>)}{report.errors.slice(0, 100).map((e, i) => <p key={i} className="text-[var(--cz-danger)]"><button className="underline" onClick={() => { const row = rows.find(r => r.source.sourceId === e.sourceId); if (row) reviewRow(row.key); }}>{e.sourceId}: {e.message}</button></p>)}</div>}
        </>}
        <div className="flex flex-wrap gap-3">{step > (file.manifest ? 2 : 1) && <button className="cz-btn" onClick={() => go(step - 1)}>Back</button>}{step === 2 && <button className="cz-btn cz-btn-primary" disabled={!built.summary.selected} onClick={() => go(3)}>Reconcile canonical products</button>}{step === 3 && <button className="cz-btn cz-btn-primary" onClick={() => go(4)}>Review import summary</button>}</div>
      </>}
      <details><summary>Advanced JSON Manifest</summary><p className="text-sm">Load or edit an existing manifest. Loading replaces the current worksheet, rows and decisions and requires a new dry-run. Edited JSON must be loaded before validation or apply.</p><textarea aria-label="Catalog import manifest" className={input + " min-h-48 font-mono text-xs"} value={advanced ?? (file ? JSON.stringify(built.manifest, null, 2) : "")} onChange={e => { invalidate(); setAdvanced(e.target.value); }} /><div className="flex gap-3"><button className="cz-btn" onClick={() => { try { const manifest = readManifest(advanced ?? JSON.stringify(built.manifest)); install({ name: "advanced.json", size: new TextEncoder().encode(advanced ?? JSON.stringify(built.manifest)).length, format: "json", sheets: [], defaultSheet: 0, manifest }); } catch (e) { setError(errorText(e)); } }}>Load JSON into wizard</button>{file && <button className="cz-btn" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(built.manifest, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = "catalog-manifest.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download prepared manifest</button>}</div></details>
    </fieldset>
    {confirm && <div role="dialog" aria-modal="true" aria-labelledby="confirm-import-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onKeyDown={e => { if (e.key === "Escape") setConfirm(false); if (e.key === "Tab") { const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button")); const first = buttons[0], last = buttons.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } }}><div className="cz-surface max-w-lg space-y-4 p-6"><h3 id="confirm-import-title" className="font-bold">Confirm catalog import</h3><p>You are about to import {report?.planned} manufacturing batches, {plannedUnits} physical manufactured units and {plannedNew} new canonical catalog products, including accessories/incomplete drafts where present.</p><p>Existing production ownership and claims will not be deleted. No per-unit manufacturing rows will be created.</p><div className="flex gap-3"><button autoFocus className="cz-btn" onClick={() => setConfirm(false)}>Cancel</button><button className="cz-btn cz-btn-primary" disabled={!ready || busy} onClick={() => void apply()}>Apply Import</button></div></div></div>}
  </section>;
}
