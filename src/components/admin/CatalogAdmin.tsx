"use client";
import { useEffect, useState } from "react";
import { parseCatalogTime, formatCatalogTime } from "@/lib/catalogTiming";
import { CatalogImportWizard } from "./catalog-import/CatalogImportWizard";
import { catalogAdmin, type CatalogDetail, type CatalogVariant, type ManufacturingBatch } from "@/lib/catalogAdmin";
import type { IdentityContext } from "../../../backend/src/domain/catalogIdentity";

const inputClass = "mt-1 min-h-11 w-full rounded-lg border border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] p-2";
function Field({ label, name, value, type = "text", required = false, disabled = false }: { label: string; name: string; value?: string | number | null; type?: string; required?: boolean; disabled?: boolean }) {
  return <label className="block text-sm">{label}<input className={inputClass} name={name} type={type} defaultValue={value ?? ""} required={required} disabled={disabled} step={type === "number" ? name === "pieceCount" ? "1" : "0.1" : undefined} /></label>;
}
function Status({ value = "DRAFT" }: { value?: string }) { return <label className="block text-sm">Status<select className={inputClass} name="status" defaultValue={value}><option>DRAFT</option><option>ACTIVE</option><option>ARCHIVED</option></select></label>; }
function formData(form: HTMLFormElement) { return Object.fromEntries(new FormData(form).entries()) as Record<string, string>; }
function message(error: unknown) { return error instanceof Error ? error.message : "Catalog request failed. Try again."; }

export function CatalogAdmin() {
  const [rows, setRows] = useState<CatalogVariant[]>([]), [detail, setDetail] = useState<CatalogDetail | null>(null);
  const [creating, setCreating] = useState(false), [search, setSearch] = useState(""), [status, setStatus] = useState("ACTIVE"), [productType, setType] = useState("");
  const [page, setPage] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [families, setFamilies] = useState<IdentityContext["designs"]>([]);
  useEffect(() => { const controller = new AbortController(); catalogAdmin.designs(controller.signal).then(context => { if (Array.isArray(context.designs)) setFamilies(context.designs); }).catch(() => {}); return () => controller.abort(); }, [revision]);
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
      const wasCreating = creating;
      const timing = !creating && detail?.productType === "CIRCZLES" && detail.puzzleId ? { maxLeaderboardTimeMs: parseCatalogTime(fields.timeMinutes, fields.timeSeconds) } : {};
      const saved = creating ? await catalogAdmin.create({ ...body, productType: fields.productType, ...(fields.puzzleDesignId ? { puzzleDesignId: fields.puzzleDesignId } : {}) }) : await catalogAdmin.update(detail!.catalogVariantId, { ...body, ...timing });
      setDetail(await catalogAdmin.detail(saved.catalogVariantId)); setCreating(false); setNotice(saved.existingCanonical ? "This playable CircZles already exists. Add a Manufacturing Batch instead." : !wasCreating ? "CircZles updated successfully." : "CircZles catalog entry saved. Add or activate a verified manufacturing batch to enable physical claims.");
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
    <div className="overflow-x-auto cz-surface"><table className="w-full text-left text-sm"><thead><tr>{["CircZles", "Brand", "Type", "Size", "Level", "Max Leaderboard Time", "Status", "Actions"].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.catalogVariantId}><td className="p-3"><button className="underline" disabled={busy} onClick={() => void open(row.catalogVariantId)}>{row.displayName}</button></td>{[row.brand, row.productType, row.sizeLabel ?? "—", row.levelId ?? "Incomplete", formatCatalogTime(row.maxLeaderboardTimeMs), row.status].map((v, i) => <td className="p-3" key={i}>{v}</td>)}<td className="p-3"><button className="cz-btn" disabled={busy} onClick={() => void open(row.catalogVariantId)}>Edit</button></td></tr>)}</tbody></table>{!rows.length && <p className="p-4">No matching catalog entries.</p>}</div>
    <div className="flex gap-3"><button className="cz-btn" disabled={!page || busy} onClick={() => setPage(p => p - 1)}>Previous</button><span className="self-center">Page {page + 1}</span><button className="cz-btn" disabled={rows.length < 50 || busy} onClick={() => setPage(p => p + 1)}>Next</button></div>
    {(creating || detail) && <section className="cz-surface space-y-4 p-5" key={creating ? "new" : detail!.catalogVariantId + ":" + detail!.status + ":" + revision}>
      <h2 className="cz-display text-xl">{creating ? "Create New CircZles" : "CircZles Details"}</h2><p className="text-sm">Display metadata can change without changing manufacturing identity. Use a separate variant for a different size or gameplay configuration.</p>
      <form onSubmit={saveVariant} className="grid gap-3 sm:grid-cols-2">
        <h3 className="font-bold sm:col-span-2">Basic Information</h3>
        <Field label="Display Name" name="displayName" value={detail?.displayName} required /><Field label="Brand" name="brand" value={detail?.brand ?? "CircZles"} required />
        {creating && <><label>Product Type<select className={inputClass} name="productType"><option>CIRCZLES</option><option>ACCESSORY</option></select></label><label>1. Choose Design Family<select className={inputClass} name="puzzleDesignId"><option value="">Create a new design family (name below)</option>{families.map(design => <option key={design.puzzleDesignId} value={design.puzzleDesignId}>{design.name}</option>)}</select></label></>}
        <Field label="Design Name (optional)" name="designName" /><Field label="Size" name="sizeLabel" value={detail?.sizeLabel} /><Field label="Piece Count" name="pieceCount" type="number" value={detail?.pieceCount} /><Field label="Level (leave blank for incomplete draft)" name="levelId" type="number" value={detail?.levelId} />
        <Field label="Image URL" name="image" value={detail?.image} /><Status value={detail?.status} /><label>Description<textarea name="description" className={inputClass} defaultValue={detail?.description ?? ""} /></label><label>Marketing metadata (JSON object)<textarea name="marketingMetadata" className={inputClass} defaultValue={JSON.stringify(detail?.marketingMetadata ?? {})} /></label>
        {!creating && <fieldset className="space-y-3 sm:col-span-2"><legend className="font-bold">Leaderboard Configuration</legend>{detail?.productType === "CIRCZLES" && detail.puzzleId ? <><p className="font-medium">Maximum Leaderboard Time</p><p className="text-sm">Maximum completion time eligible for this CircZles leaderboard. This value is stored now; leaderboard enforcement will be added separately.</p><div className="grid gap-3 sm:grid-cols-2"><label>Minutes<input className={inputClass} name="timeMinutes" type="number" min="0" step="1" defaultValue={detail.maxLeaderboardTimeMs == null ? "" : Math.floor(detail.maxLeaderboardTimeMs / 60000)} /></label><label>Seconds<input className={inputClass} name="timeSeconds" type="number" min="0" max="59" step="1" defaultValue={detail.maxLeaderboardTimeMs == null ? "" : Math.floor(detail.maxLeaderboardTimeMs / 1000) % 60} /></label></div><button type="button" className="cz-btn" disabled={busy} onClick={event => { const form = event.currentTarget.form!; (form.elements.namedItem("timeMinutes") as HTMLInputElement).value = ""; (form.elements.namedItem("timeSeconds") as HTMLInputElement).value = ""; }}>Clear / Not configured</button></> : <p>Leaderboard timing becomes available when this is a playable CircZles.</p>}</fieldset>}
        <button className="cz-btn cz-btn-primary" disabled={busy}>{busy ? "Saving…" : creating ? "Save CircZles" : "Save Changes"}</button>
      </form>
      {detail && <><h2 className="cz-display pt-4 text-xl">Manufacturing Batches</h2><form className="flex gap-3 items-end" onSubmit={event => { event.preventDefault(); const fields = formData(event.currentTarget); void run(async () => { await catalogAdmin.alias(detail.puzzleDesignId, fields.alias); setNotice("Design alias confirmed for future imports."); }); }}><Field label="Confirm spelling/rename alias for this design family" name="alias" required /><button className="cz-btn" disabled={busy}>Confirm design alias</button></form><h2 className="cz-display pt-4 text-xl">Add Manufacturing Batch to Existing CircZles</h2><p className="text-sm">This batch will use the selected canonical CircZles. Active batches require complete gameplay and verified ranges.</p><BatchForm onSubmit={saveBatch} busy={busy} />
        <h2 className="cz-display pt-4 text-xl">Manufacturing History</h2>{detail.batches.map(batch => <article key={batch.manufacturingBatchId} className="space-y-3 rounded-xl border border-[var(--cz-hairline-strong)] p-4"><h3 className="font-bold">{batch.skuPrefix} · {batch.status}</h3><p className="text-sm">Manufactured: {batch.unitsManufactured} · Claimed: {batch.claimedUnits} · Remaining: {batch.remainingUnits}</p><p className="text-sm">Verified ranges: {batch.ranges.map(r => r.serialStart + "–" + r.serialEnd).join(", ")}</p><div className="flex flex-wrap gap-2">{["DRAFT", "ACTIVE", "ARCHIVED"].map(s => <button className="cz-btn" key={s} disabled={busy || batch.status === s} onClick={() => void run(async () => { await catalogAdmin.editBatch(batch.manufacturingBatchId, { status: s }); setDetail(await catalogAdmin.detail(detail.catalogVariantId)); setNotice("Batch status updated."); })}>{s === "ACTIVE" ? "Activate" : s === "ARCHIVED" ? "Archive" : "Set draft"}</button>)}</div>
          {batch.claimedUnits === "0" && batch.ranges.length === 1 && <details><summary>Correct unclaimed manufacturing setup</summary><BatchForm batch={batch} variantId={detail.catalogVariantId} busy={busy} onSubmit={saveBatch} /></details>}
          {batch.status !== "ARCHIVED" && <form className="grid gap-3 sm:grid-cols-3" onSubmit={event => { event.preventDefault(); const fields = formData(event.currentTarget); void run(async () => { await catalogAdmin.range(batch.manufacturingBatchId, fields); setDetail(await catalogAdmin.detail(detail.catalogVariantId)); setNotice("Verified production range added."); }); }}><Field label="Additional Serial Start" name="serialStart" required /><Field label="Additional Serial End" name="serialEnd" required /><button className="cz-btn self-end" disabled={busy}>Add verified range</button></form>}
        </article>)}</>}
    </section>}
    <CatalogImportWizard onApplied={() => setRevision(v => v + 1)} />
  </main>;
}
function BatchForm({ batch, variantId, busy, onSubmit }: { batch?: ManufacturingBatch; variantId?: string; busy: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>, batch?: ManufacturingBatch) => Promise<void> }) {
  return <form className="grid gap-3 sm:grid-cols-2" onSubmit={event => void onSubmit(event, batch)}>{batch && <Field label="Canonical CircZles ID (explicit unclaimed correction)" name="catalogVariantId" value={variantId} required />}<Field label="Number Identifier" name="numberIdentifier" value={batch?.numberIdentifier} required /><Field label="Manufacturing Run" name="manufacturingCode" value={batch?.manufacturingCode} required /><Field label="SKU Prefix (e.g. CC-29-R2-01)" name="skuPrefix" value={batch?.skuPrefix} required /><Field label="First Full SKU (optional)" name="firstFullSku" value={batch?.firstFullSku} /><Field label="Serial Start" name="serialStart" value={batch?.serialStart ?? "1"} required /><Field label="Serial End" name="serialEnd" value={batch?.serialEnd} required /><Field label="Units Manufactured" name="unitsManufactured" value={batch?.unitsManufactured} required /><Status value={batch?.status} /><button className="cz-btn cz-btn-primary" disabled={busy}>{busy ? "Saving…" : batch ? "Save manufacturing correction" : "Add Manufacturing Batch"}</button></form>;
}
