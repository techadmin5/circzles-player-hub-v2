"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { request } from "@/lib/apiClient";
import { adminMissionCategories, type AdminMissionDto } from "@/types/adminMissions";
import { ChestAdmin } from "./ChestAdmin";
import { MissionDetailPanel } from "./MissionDetailPanel";
import { MissionManagerTabs } from "./MissionManagerTabs";
import { MissionRewardPreview } from "./MissionRewardPreview";
import { categoryLabel, errorMessage, filterMissions, fresh, groupLabels, inspectMission, loadMissionLibrary, missionGroup, nextActions, objective, type MissionCollectible, type MissionInspection } from "./missionManagerModel";

export function MissionAdmin() {
  const [rows, setRows] = useState<AdminMissionDto[]>([]), [inspections, setInspections] = useState<Record<string, MissionInspection>>({}), [catalog, setCatalog] = useState<MissionCollectible[]>([]);
  const [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0), [error, setError] = useState<ReturnType<typeof errorMessage> | null>(null), [reviewErrors, setReviewErrors] = useState(0);
  const [workspace, setWorkspace] = useState("Mission library"), [search, setSearch] = useState(""), [category, setCategory] = useState(""), [status, setStatus] = useState(""), [sort, setSort] = useState("order"), [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null), [creating, setCreating] = useState(false), [createBusy, setCreateBusy] = useState(false), [notice, setNotice] = useState("");
  const [detailBusy, setDetailBusy] = useState(false);
  const pendingCreate = useRef(false), generation = useRef(0), currentRevisions = useRef<Record<string, string>>({});
  useEffect(() => {
    const c = new AbortController(), current = ++generation.current;
    async function load() {
      setLoading(true); setError(null); setInspections({}); setReviewErrors(0);
      const access = await request<{ allowed: boolean }>("/api/admin/missions/access", { signal: c.signal, cache: "no-store" });
      if (!access.allowed) throw new Error("SUPER_ADMIN access is required.");
      const all = await loadMissionLibrary(c.signal);
      if (c.signal.aborted) return;
      currentRevisions.current = Object.fromEntries(all.map(m=>[m.missionId,m.updatedAt])); setRows(all); setLoading(false);
      void (async () => {
        const assets: MissionCollectible[] = [];
        for (let offset = 0;; offset += 100) {
          const p = await request<{ collectibles: MissionCollectible[]; hasMore: boolean }>("/api/admin/missions/collectibles?limit=100&offset=" + offset, { signal: c.signal, cache: "no-store" });
          assets.push(...p.collectibles); if (!p.hasMore) break;
        }
        if (!c.signal.aborted) setCatalog(assets);
      })().catch(() => { if (!c.signal.aborted) setCatalog([]); });
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(3, all.length) }, async () => {
        while (index < all.length && !c.signal.aborted) {
          const mission = all[index++];
          try {
            const inspection = await inspectMission(mission, c.signal);
            if (!c.signal.aborted && current === generation.current && currentRevisions.current[mission.missionId] === mission.updatedAt) setInspections(prev => ({ ...prev, [mission.missionId]: inspection }));
          } catch { if (!c.signal.aborted) setReviewErrors(n => n + 1); }
        }
      }));
    }
    void load().catch(e => { if (!c.signal.aborted) { setError(errorMessage(e)); setRows([]); setLoading(false); } });
    return () => c.abort();
  }, [refresh]);
  function chooseFilter(value: string) { setStatus(value); setPage(0); setSelected(null); setCreating(false); }
  const changed = useCallback((m: AdminMissionDto) => { currentRevisions.current[m.missionId] = m.updatedAt; setRows(prev => prev.some(r => r.missionId === m.missionId) ? prev.map(r => r.missionId === m.missionId ? m : r) : [...prev, m]); setInspections(prev => { const next = { ...prev }; delete next[m.missionId]; return next; }); }, []);
  const inspected = useCallback((id: string, value: MissionInspection) => { setInspections(prev => ({ ...prev, [id]: value })); }, []);
  const checked = rows.filter(m => fresh(m, inspections[m.missionId])).length, summariesReady = checked === rows.length;
  const summary = [
    ["Total missions", rows.length, ""], ["Active missions", rows.filter(m => m.active).length, "active"], ["Inactive missions", rows.filter(m => !m.active).length, "inactive"],
    ["Awaiting approval", summariesReady ? rows.filter(m => missionGroup(m, inspections[m.missionId]) === "approval").length : null, "approval"],
    ["Configuration incomplete", summariesReady ? rows.filter(m => missionGroup(m, inspections[m.missionId]) === "incomplete").length : null, "incomplete"],
    ["Ready to activate", summariesReady ? rows.filter(m => missionGroup(m, inspections[m.missionId]) === "ready").length : null, "ready"],
  ] as const;
  const visible = filterMissions(rows, inspections, search, category, workspace === "Review queue" ? "approval" : status, sort);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visible.length / 9) - 1)), selectedRow = rows.find(m => m.missionId === selected);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pendingCreate.current) return; pendingCreate.current = true; setCreateBusy(true); setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const saved = await request<AdminMissionDto>("/api/admin/missions", { method: "POST", body: JSON.stringify({ title: String(form.get("title") ?? ""), description: String(form.get("description") ?? ""), category: String(form.get("category") ?? ""), displayOrder: Number(form.get("displayOrder")) }) });
      changed(saved); setCreating(false); setSelected(saved.missionId); setNotice("Inactive draft created. Configure its objective and rewards before review.");
    } catch (e) { setError(errorMessage(e)); } finally { pendingCreate.current = false; setCreateBusy(false); }
  }
  return <main className="mission-console">
    <header className="mm-header"><div><p className="mm-eyebrow">CIRCZLES / ADMINISTRATION</p><h1>Mission Manager</h1><p className="mm-muted">Shape the challenge. Review the rewards. Publish with confidence.</p></div><div className="mm-actions"><Link className="mm-secondary" href="/missions">View Player Missions</Link><button className="mm-primary" disabled={loading || !!error || createBusy || detailBusy} onClick={() => { setCreating(true); setSelected(null); setWorkspace("Mission library"); }}>Create New Mission</button></div></header>
    <section className="mm-summary" aria-label="Mission overview">{summary.map(([label, count, filter]) => <button key={label} disabled={loading || !!error || count === null} onClick={() => { setWorkspace("Mission library"); chooseFilter(filter); }} aria-label={label + ": " + (loading || error || count === null ? "not loaded" : count)}><span>{label}</span><strong>{loading || error || count === null ? "?" : count}</strong><small>{count === null ? "Checking server reports" : filter === "ready" ? "Reviewed and approved" : "Open mission library"}</small></button>)}</section>
    <div className="mm-workflow" aria-label="Publishing workflow">{["Configure", "Review", "Approve", "Activate", "Monitor"].map((step, i) => <span key={step}><b>{i + 1}</b>{step}{i < 4 && <span aria-hidden="true"> &rarr; </span>}</span>)}<p>Approvals are individual. Publishing always requires your confirmation.</p></div>
    <MissionManagerTabs label="Management workspace" disabled={detailBusy || !!error || loading} tabs={["Mission library", "Review queue", "Activation center", "Daily / Weekly chests"]} value={workspace} onChange={tab => { setWorkspace(tab); setSelected(null); setCreating(false); setPage(0); }} />
    {notice && <p className="mm-success" role="status">{notice}</p>}
    {error && <div className="mm-error" role="alert"><p>{error.message}</p><details><summary>Technical details</summary>{error.code}</details><button onClick={() => setRefresh(n => n + 1)}>Reload missions</button></div>}
    {workspace === "Daily / Weekly chests" ? <ChestAdmin /> : <>
      {!loading && !summariesReady && <p className="mm-muted" role="status">Reviewed {checked} of {rows.length} mission configurations. {reviewErrors ? reviewErrors + " review reports could not load. Refresh to retry; unknown results are never counted as approved." : "Summaries appear when all current reports are available."}</p>}
      <div className="mm-toolbar"><div><h2>{workspace === "Review queue" ? "Pending individual reviews" : workspace === "Activation center" ? "Activation center" : "Your mission library"}</h2><p className="mm-muted">{workspace === "Activation center" ? "Ready, awaiting approval, incomplete and active missions / grounded in server checks." : "A clear view of every challenge and the next action it needs."}</p></div><div className="mm-actions"><button className="mm-secondary" disabled={loading || createBusy || detailBusy} onClick={() => { setSelected(null); setRefresh(n => n + 1); }}>Refresh statuses</button><button className="mm-secondary" disabled={detailBusy || !!error || loading} onClick={() => { setWorkspace("Review queue"); setSelected(null); setPage(0); }}>Review Pending Missions</button><button className="mm-secondary" disabled={detailBusy || !!error || loading} onClick={() => { setWorkspace("Daily / Weekly chests"); setSelected(null); }}>Manage Daily/Weekly Chests</button></div></div>
      {creating && <section className="mm-panel" aria-label="New mission"><h2>Create an inactive mission</h2><p className="mm-muted">No activity, reward or schedule is assumed. A new draft never assigns itself to players.</p><form aria-label="Create mission draft" onSubmit={event => void create(event)}><fieldset disabled={createBusy} className="mm-form-grid"><label>Mission title<input required maxLength={200} name="title" /></label><label>Category<select name="category" required defaultValue=""><option value="" disabled>Choose a category</option>{adminMissionCategories.map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}</select></label><label className="mm-span">Player-facing description<textarea name="description" maxLength={4000} /></label><label>Display order<input name="displayOrder" type="number" required min={0} step={1} max={2147483647} defaultValue={0} /></label></fieldset><div className="mm-actions"><button className="mm-primary" disabled={createBusy}>{createBusy ? "Creating..." : "Create inactive draft"}</button><button type="button" disabled={createBusy} onClick={() => setCreating(false)}>Cancel</button></div></form></section>}
      {selectedRow ? <MissionDetailPanel key={selectedRow.missionId} mission={selectedRow} missions={rows} catalog={catalog} onChanged={changed} onInspection={inspected} onBusyChanged={setDetailBusy} onBack={() => { setSelected(null); requestAnimationFrame(() => document.getElementById("mission-" + selectedRow.missionId)?.focus()); }} queue={workspace === "Review queue" ? visible : []} onSelect={setSelected} /> : <>
        {workspace === "Activation center" && <nav className="mm-actions" aria-label="Activation stages">{[["ready","Ready to activate"],["approval","Needs approval"],["incomplete","Needs configuration"],["active","Active"],["deactivated","Deactivated"],["inactive","All inactive"]].map(([value,label]) => <button key={value} aria-pressed={status===value} onClick={()=>chooseFilter(value)}>{label}</button>)}</nav>}
        <div className="mm-filters"><label>Search missions<input type="search" placeholder="Search by mission name..." value={search} onInput={e => { setSearch(e.currentTarget.value); setPage(0); }} /></label><label>Category<select value={category} onChange={e => { setCategory(e.target.value); setPage(0); }}><option value="">All categories</option>{adminMissionCategories.map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}</select></label><label>Status<select value={workspace === "Review queue" ? "approval" : status} disabled={workspace === "Review queue"} onChange={e => chooseFilter(e.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="approval">Needs approval</option><option value="incomplete">Incomplete configuration</option><option value="ready">Ready to activate</option><option value="blocked">Readiness blocked</option><option value="deactivated">Confirmed deactivated</option><option value="unchecked">Review not loaded</option></select></label><label>Sort by<select value={sort} onChange={e => { setSort(e.target.value); setPage(0); }}><option value="order">Display order</option><option value="name">Name A?Z</option><option value="updated">Recently updated</option></select></label></div>
        {loading ? <div className="mm-grid" role="status" aria-label="Loading missions">{[1, 2, 3].map(n => <div className="mm-skeleton" key={n}>Loading mission...</div>)}</div> : !error && !visible.length ? <div className="mm-empty"><h3>No missions match this view</h3><p>Try another category or clear the search. Unloaded review reports never appear as approved.</p><button onClick={() => { setSearch(""); setCategory(""); chooseFilter(""); setWorkspace("Mission library"); }}>Clear filters</button></div> : <section className="mm-grid" aria-label="Mission definitions">{visible.slice(currentPage * 9, currentPage * 9 + 9).map(m => {
          const inspection = inspections[m.missionId], group = missionGroup(m, inspection);
          return <article className="mm-card" key={m.missionId}><div className="mm-card-top"><span className="mm-category">{categoryLabel(m.category)}</span><span className={"mm-badge mm-" + group}>{groupLabels[group]}</span></div><h3>{m.title}</h3><p className="mm-description">{m.description || "Add a description to explain this challenge to players."}</p><div className="mm-objective"><small>PLAYER OBJECTIVE</small><p>{objective(m, inspection?.tracking)}</p></div><MissionRewardPreview mission={m} tracking={inspection?.tracking} catalog={catalog} /><div className="mm-card-meta"><span>Lifecycle <b>{categoryLabel(m.lifecycle)}</b></span><span>Product <b>{fresh(m, inspection) ? inspection.approval.categories.find(c=>c.category==="PRODUCT")?.status.toLowerCase() ?? "Not checked" : "Not checked"}</b></span><span>Reward budget <b>{fresh(m, inspection) ? inspection.approval.categories.find(c=>c.category==="REWARD_BUDGET")?.status.toLowerCase() ?? "Not checked" : "Not checked"}</b></span></div><button className="mm-card-action" id={"mission-" + m.missionId} onClick={() => setSelected(m.missionId)} aria-label={"Open " + m.title}>{nextActions[group]} <span aria-hidden="true">?</span></button></article>;
        })}</section>}
        {!loading && !error && <nav aria-label="Mission pages" className="mm-pagination"><span>{visible.length ? currentPage * 9 + 1 : 0}?{Math.min((currentPage + 1) * 9, visible.length)} of {visible.length} missions</span><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><button disabled={(currentPage + 1) * 9 >= visible.length} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
      </>}
    </>}
  </main>;
}
