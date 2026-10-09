"use client";
import { useEffect, useState } from "react";
import { catalogAdmin, type CatalogDetail, type CatalogVariant, type ManufacturingBatch, type ImportReport } from "@/lib/catalogAdmin";

const inputClass = "mt-1 min-h-11 w-full rounded-lg border border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] p-2";
function Field({ label, name, value, type = "text", required = false, disabled = false }: { label: string; name: string; value?: string | number | null; type?: string; required?: boolean; disabled?: boolean }) {
  return <label className="block text-sm">{label}<input className={inputClass} name={name} type={type} defaultValue={value ?? ""} required={required} disabled={disabled} step={type === "number" ? name === "pieceCount" ? "1" : "0.1" : undefined} /></label>;
}
function Status({ value = "DRAFT" }: { value?: string }) { return <label className="block text-sm">Status<select className={inputClass} name="status" defaultValue={value}><option>DRAFT</option><option>ACTIVE</option><option>ARCHIVED</option></select></label>; }
function formData(form: HTMLFormElement) { return Object.fromEntries(new FormData(form).entries()) as Record<string, string>; }
function message(error: unknown) { return error instanceof Error ? error.message : "Catalog request failed. Try again."; }

export function CatalogAdmin() {
  const [rows, setRows] = useState<CatalogVariant[]>([]), [detail, setDetail] = useState<CatalogDetail | null>(null);
  const [creating, setCreating] = useState(false), [search, setSearch] = useState(""), [status, setStatus] = useState(""), [productType, setType] = useState("");
  const [page, setPage] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [manifest, setManifest] = useState(""), [report, setReport] = useState<ImportReport | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ search, limit: "50", offset: String(page * 50), ...(status ? { status } : {}), ...(productType ? { productType } : {}) });
    catalogAdmin.list(query, controller.signal).then(setRows).catch(e => { if (!controller.signal.aborted) setError(message(e)); });
    return () => controller.abort();
  }, [search, status, productType, page, revision]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); setRevision(v => v + 1); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function open(id: string) { await run(async () => { setDetail(await catalogAdmin.detail(id)); setCreating(false); }); }
  async function saveVariant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const fields = formData(event.currentTarget);
    await run(async () => {
      const body = { displayName: fields.displayName, brand: fields.brand, sizeLabel: fields.sizeLabel || null, pieceCount: fields.pieceCount ? Number(fields.pieceCount) : null, levelId: fields.levelId ? Number(fields.levelId) : null, image: fields.image, description: fields.description, status: fields.status, marketingMetadata: JSON.parse(fields.marketingMetadata || "{}"), ...(fields.designName ? { designName: fields.designName } : {}) };
      const saved = creating ? await catalogAdmin.create({ ...body, productType: fields.productType, ...(fields.puzzleDesignId ? { puzzleDesignId: fields.puzzleDesignId } : {}) }) : await catalogAdmin.update(detail!.catalogVariantId, body);
      setDetail(await catalogAdmin.detail(saved.catalogVariantId)); setCreating(false); setNotice("CircZles catalog entry saved. Add or activate a verified manufacturing batch to enable physical claims.");
    });
  }
  async function saveBatch(event: React.FormEvent<HTMLFormElement>, batch?: ManufacturingBatch) {
    event.preventDefault(); const fields = formData(event.currentTarget);
    await run(async () => {
      const body = { ...fields, ...(fields.firstFullSku ? {} : { firstFullSku: undefined }) };
      if (batch) await catalogAdmin.editBatch(batch.manufacturingBatchId, body);
      else await catalogAdmin.batch(detail!.catalogVariantId, body);
      setDetail(await catalogAdmin.detail(detail!.catalogVariantId)); setNotice("Manufacturing batch saved.");
    });
  }
  return <main className="mx-auto max-w-7xl space-y-6 p-5 md:p-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="cz-display text-3xl">CircZles Catalog</h1><button className="cz-btn cz-btn-primary" onClick={() => { setCreating(true); setDetail(null); }} disabled={busy}>+ Add CircZles</button></div>
    {error && <p role="alert" className="cz-surface p-4 text-[var(--cz-danger)]">{error}</p>}{notice && <p role="status" className="cz-surface p-4">{notice}</p>}
    <div className="grid gap-3 sm:grid-cols-3"><label>Search by display name or SKU prefix<input aria-label="Search CircZles" className={inputClass} value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} /></label><label>Status<select className={inputClass} value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}><option value="">All statuses</option><option>DRAFT</option><option>ACTIVE</option><option>ARCHIVED</option></select></label><label>Product type<select className={inputClass} value={productType} onChange={e => { setType(e.target.value); setPage(0); }}><option value="">All products</option><option>CIRCZLES</option><option>ACCESSORY</option></select></label></div>
    <div className="overflow-x-auto cz-surface"><table className="w-full text-left text-sm"><thead><tr>{["CircZles", "Brand", "Type", "Size", "Level", "Status"].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.catalogVariantId}><td className="p-3"><button className="underline" disabled={busy} onClick={() => void open(row.catalogVariantId)}>{row.displayName}</button></td>{[row.brand, row.productType, row.sizeLabel ?? "—", row.levelId ?? "Incomplete", row.status].map((v, i) => <td className="p-3" key={i}>{v}</td>)}</tr>)}</tbody></table>{!rows.length && <p className="p-4">No matching catalog entries.</p>}</div>
    <div className="flex gap-3"><button className="cz-btn" disabled={!page || busy} onClick={() => setPage(p => p - 1)}>Previous</button><span className="self-center">Page {page + 1}</span><button className="cz-btn" disabled={rows.length < 50 || busy} onClick={() => setPage(p => p + 1)}>Next</button></div>
    {(creating || detail) && <section className="cz-surface space-y-4 p-5" key={creating ? "new" : detail!.catalogVariantId + ":" + detail!.status + ":" + revision}>
      <h2 className="cz-display text-xl">{creating ? "Create New CircZles" : "CircZles Details"}</h2><p className="text-sm">Display metadata can change without changing manufacturing identity. Use a separate variant for a different size or gameplay configuration.</p>
      <form onSubmit={saveVariant} className="grid gap-3 sm:grid-cols-2">
        <Field label="Display Name" name="displayName" value={detail?.displayName} required /><Field label="Brand" name="brand" value={detail?.brand ?? "CircZles"} required />
        {creating && <><label>Product Type<select className={inputClass} name="productType"><option>CIRCZLES</option><option>ACCESSORY</option></select></label><label>Design family<select className={inputClass} name="puzzleDesignId"><option value="">Create a new design</option>{Array.from(new Map(rows.map(row => [row.puzzleDesignId, row])).values()).map(row => <option key={row.puzzleDesignId} value={row.puzzleDesignId}>{row.displayName} · {row.puzzleDesignId}</option>)}</select></label></>}
        <Field label="Design Name (optional)" name="designName" /><Field label="Size" name="sizeLabel" value={detail?.sizeLabel} /><Field label="Piece Count" name="pieceCount" type="number" value={detail?.pieceCount} /><Field label="Level (leave blank for incomplete draft)" name="levelId" type="number" value={detail?.levelId} />
        <Field label="Image URL" name="image" value={detail?.image} /><Status value={detail?.status} /><label>Description<textarea name="description" className={inputClass} defaultValue={detail?.description ?? ""} /></label><label>Marketing metadata (JSON object)<textarea name="marketingMetadata" className={inputClass} defaultValue={JSON.stringify(detail?.marketingMetadata ?? {})} /></label>
        <button className="cz-btn cz-btn-primary" disabled={busy}>{busy ? "Saving…" : "Save CircZles"}</button>
      </form>
      {detail && <><h2 className="cz-display pt-4 text-xl">Add Manufacturing Batch to Existing CircZles</h2><p className="text-sm">This batch will use the selected canonical CircZles. Names never determine a match. Active batches require complete gameplay and verified ranges.</p><BatchForm onSubmit={saveBatch} busy={busy} />
        <h2 className="cz-display pt-4 text-xl">Manufacturing History</h2>{detail.batches.map(batch => <article key={batch.manufacturingBatchId} className="space-y-3 rounded-xl border border-[var(--cz-hairline-strong)] p-4"><h3 className="font-bold">{batch.skuPrefix} · {batch.status}</h3><p className="text-sm">Manufactured: {batch.unitsManufactured} · Claimed: {batch.claimedUnits} · Remaining: {batch.remainingUnits}</p><p className="text-sm">Verified ranges: {batch.ranges.map(r => r.serialStart + "–" + r.serialEnd).join(", ")}</p><div className="flex flex-wrap gap-2">{["DRAFT", "ACTIVE", "ARCHIVED"].map(s => <button className="cz-btn" key={s} disabled={busy || batch.status === s} onClick={() => void run(async () => { await catalogAdmin.editBatch(batch.manufacturingBatchId, { status: s }); setDetail(await catalogAdmin.detail(detail.catalogVariantId)); setNotice("Batch status updated."); })}>{s === "ACTIVE" ? "Activate" : s === "ARCHIVED" ? "Archive" : "Set draft"}</button>)}</div>
          {batch.claimedUnits === "0" && batch.ranges.length === 1 && <details><summary>Correct unclaimed manufacturing setup</summary><BatchForm batch={batch} variantId={detail.catalogVariantId} busy={busy} onSubmit={saveBatch} /></details>}
          {batch.status !== "ARCHIVED" && <form className="grid gap-3 sm:grid-cols-3" onSubmit={event => { event.preventDefault(); const fields = formData(event.currentTarget); void run(async () => { await catalogAdmin.range(batch.manufacturingBatchId, fields); setDetail(await catalogAdmin.detail(detail.catalogVariantId)); setNotice("Verified production range added."); }); }}><Field label="Additional Serial Start" name="serialStart" required /><Field label="Additional Serial End" name="serialEnd" required /><button className="cz-btn self-end" disabled={busy}>Add verified range</button></form>}
        </article>)}</>}
    </section>}
    <section className="cz-surface space-y-3 p-5"><h2 className="cz-display text-xl">Catalog Import & Reconciliation</h2><p className="text-sm">Load a source manifest, then explicitly map every row to an existing canonical variant ID or a new variant key. Shared keys are your explicit choice to share one variant. Preview performs no writes.</p>
      <label>Source manifest file<input type="file" accept="application/json,.json" className={inputClass} onChange={event => { const file = event.target.files?.[0]; if (file) void file.text().then(text => { setManifest(text); setReport(null); }).catch(e => setError(message(e))); }} /></label>
      <label className="block">Manifest and explicit mappings<textarea aria-label="Catalog import manifest" className={inputClass + " min-h-48 font-mono text-xs"} value={manifest} onChange={event => { setManifest(event.target.value); setReport(null); }} /></label>
      <div className="flex gap-3"><button className="cz-btn" disabled={busy || !manifest} onClick={() => void run(async () => setReport(await catalogAdmin.import(JSON.parse(manifest))))}>Dry-run validation</button><button className="cz-btn cz-btn-primary" disabled={busy || !report?.ready || report.applied} onClick={() => void run(async () => { setReport(await catalogAdmin.import(JSON.parse(manifest), true)); setNotice("Catalog import applied atomically."); })}>Apply validated import</button></div>
      {report && <div role="status"><p>{report.applied ? "Applied" : "Preview"}: {report.rows} rows · {report.planned} planned · {report.skipped.length} already imported</p>{report.reconciliationCandidates?.map(candidate => <p className="mt-2" key={candidate.name}>{candidate.name}: {candidate.sourceIds.join(", ")} ? Explicit canonical mapping required.</p>)}{report.errors.map((e, i) => <p className="mt-2 text-[var(--cz-danger)]" key={i}>{e.sourceId}: {e.message}</p>)}</div>}
    </section>
  </main>;
}
function BatchForm({ batch, variantId, busy, onSubmit }: { batch?: ManufacturingBatch; variantId?: string; busy: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>, batch?: ManufacturingBatch) => Promise<void> }) {
  return <form className="grid gap-3 sm:grid-cols-2" onSubmit={event => void onSubmit(event, batch)}>{batch && <Field label="Canonical CircZles ID (explicit unclaimed correction)" name="catalogVariantId" value={variantId} required />}<Field label="Number Identifier" name="numberIdentifier" value={batch?.numberIdentifier} required /><Field label="Manufacturing Run" name="manufacturingCode" value={batch?.manufacturingCode} required /><Field label="SKU Prefix (e.g. CC-29-R2-01)" name="skuPrefix" value={batch?.skuPrefix} required /><Field label="First Full SKU (optional)" name="firstFullSku" value={batch?.firstFullSku} /><Field label="Serial Start" name="serialStart" value={batch?.serialStart ?? "1"} required /><Field label="Serial End" name="serialEnd" value={batch?.serialEnd} required /><Field label="Units Manufactured" name="unitsManufactured" value={batch?.unitsManufactured} required /><Status value={batch?.status} /><button className="cz-btn cz-btn-primary" disabled={busy}>{busy ? "Saving…" : batch ? "Save manufacturing correction" : "Add Manufacturing Batch"}</button></form>;
}
