"use client";
import { MissionCapacityPanel } from "./MissionCapacityPanel";
import { useEffect, useRef, useState } from "react";
import { request } from "@/lib/apiClient";
import type { AdminMissionDto, AdminMissionPage } from "@/types/adminMissions";
import { adminMissionCategories } from "@/types/adminMissions";
import { MissionLifecycleControls } from "./MissionLifecycleControls";
import { MissionHistory } from "./MissionHistory";
import { MissionRuleEditor } from "./MissionRuleEditor";
import { MissionScheduleEditor } from "./MissionScheduleEditor";
import { MissionRewardEditor } from "./MissionRewardEditor";
import { MissionReadiness } from "./MissionReadiness";
import { MissionApprovalContract } from "./MissionApprovalContract";

const utc = (value: string | null) => value ? new Date(value).toISOString().replace("T", " ").replace("Z", " UTC") : "Not set";
export function MissionAdmin() {
  const [page, setPage] = useState<AdminMissionPage | null>(null);
  const [detail, setDetail] = useState<AdminMissionDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [offset, setOffset] = useState(0), [search, setSearch] = useState("");
  const [approvalChange, setApprovalChange] = useState(0);
  const [editorRevision, setEditorRevision] = useState(0);
  const [readinessGeneration, setReadinessGeneration] = useState(0);
  const [filter, setFilter] = useState(""), [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const operation = useRef(false), mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    request<AdminMissionPage>(`/api/admin/missions?limit=25&offset=${offset}&search=${encodeURIComponent(filter)}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setPage(result); })
      .catch(error => { if (!controller.signal.aborted) { setPage(null); setError(error instanceof Error ? error.message : "Could not load missions."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [offset, filter, revision]);
  async function run(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setReadinessGeneration(value => value + 1); setError(""); setNotice("");
    try { await action(); } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : "Mission request failed."); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  function reload() { setLoading(true); setRevision(value => value + 1); }
  return <main className="mx-auto max-w-7xl space-y-5 p-6">
    <h1 className="cz-display text-3xl">Admin Missions</h1>
    <p>Inspect mission definitions and configure inactive mission labels, display order, supported event rules, UTC schedules and XP/SP rewards.</p>
    <button className="cz-btn" disabled={busy} onClick={() => { setCreating(true); setDetail(null); setError(""); setNotice(""); }}>Create Mission Draft</button>
    {creating && <form className="cz-surface space-y-3 p-5" aria-label="Create mission draft" onSubmit={event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const body = { title: String(form.get("title") ?? ""), description: String(form.get("description") ?? ""), category: String(form.get("category") ?? ""), displayOrder: Number(form.get("displayOrder")) };
      void run(async () => {
        const created = await request<AdminMissionDto>("/api/admin/missions", { method: "POST", body: JSON.stringify(body) });
        if (!mounted.current) return;
        setCreating(false); setDetail(created); setOffset(0); setSearch(""); setFilter("");
        setNotice("Inactive draft created. No rules or rewards are configured."); reload();
      });
    }}>
      <h2 className="cz-display text-xl">Create inactive mission draft</h2>
      <p>Choose an existing category. Its period follows M1. Windows, rules and rewards remain unconfigured; this draft cannot progress or pay rewards.</p>
      <fieldset disabled={busy} className="space-y-3">
        <legend>Draft details</legend>
        <label className="block">Title<input className="cz-inset block w-full p-3" name="title" required maxLength={200} /></label>
        <label className="block">Description<textarea className="cz-inset block w-full p-3" name="description" maxLength={4000} defaultValue="" /></label>
        <label className="block">Category<select className="cz-inset ml-3 p-2" name="category" required defaultValue=""><option value="" disabled>Choose a category</option>{adminMissionCategories.map(category => <option key={category} value={category}>{category}</option>)}</select></label>
        <label className="block">Display order<input className="cz-inset ml-3 p-2" name="displayOrder" type="number" required min={0} max={2147483647} step={1} defaultValue={0} /></label>
        <button className="cz-btn" type="submit">Save inactive draft</button>
      </fieldset>
      <button className="cz-btn" type="button" disabled={busy} onClick={() => setCreating(false)}>Cancel draft</button>
    </form>}
    <form className="flex flex-wrap gap-3" onSubmit={event => { event.preventDefault(); setError(""); setDetail(null); setOffset(0); setFilter(search.trim()); reload(); }}>
      <label>Search missions<input className="cz-inset ml-3 p-2" value={search} maxLength={200} disabled={busy} onChange={event => setSearch(event.target.value)} /></label>
      <button className="cz-btn" disabled={busy}>Search</button>
      <button className="cz-btn" type="button" disabled={busy || loading} onClick={() => { setDetail(null); setError(""); reload(); }}>Refresh</button>
    </form>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">Loading missions...</p> : page && (!page.missions.length ? <p>No missions found.</p> : <section aria-label="Mission definitions" className="space-y-3">{page.missions.map(mission => <article key={mission.missionId} className="cz-surface p-4">
      <h2 className="cz-display text-xl">{mission.title}</h2>
      <p>{mission.category} · {mission.periodType} · {mission.lifecycle}{mission.configurationIssues.length ? " · Configuration incomplete" : " · Configuration valid"}</p>
      <button className="cz-btn mt-2" disabled={busy} onClick={() => void run(async () => { setCreating(false); setDetail(null); const result = await request<AdminMissionDto>(`/api/admin/missions/${mission.missionId}`); if (mounted.current) setDetail(result); })}>View {mission.title}</button>
    </article>)}</section>)}
    <nav aria-label="Mission pages" className="flex gap-3">
      <button className="cz-btn" disabled={busy || loading || offset === 0} onClick={() => { setDetail(null); setOffset(value => Math.max(0, value - 25)); setLoading(true); }}>Previous</button>
      <button className="cz-btn" disabled={busy || loading || !page?.hasMore} onClick={() => { setDetail(null); setOffset(value => value + 25); setLoading(true); }}>Next</button>
    </nav>
    {detail && <section className="cz-surface space-y-4 p-5" aria-label="Mission details">
      <h2 className="cz-display text-2xl">{detail.title}</h2>
      <p>Definition status: {detail.lifecycle}. {detail.active ? "Metadata editing is locked while this definition is active." : "Inactive metadata can be edited."}</p>
      <p>Category: {detail.category} · Period: {detail.periodType} · Mission ID: {detail.missionId}</p>
      <p>Starts: {utc(detail.startsAt)} · Ends: {utc(detail.endsAt)} · Activation effective: {utc(detail.activationEffectiveAt)}</p>
      <p>Explicit claim deadline: {utc(detail.claimDeadline)}. Daily and weekly earned claims use the existing 24-hour period-end grace; earned snapshots retain their own deadlines.</p>
      <MissionReadiness key={`readiness:${detail.missionId}:${detail.updatedAt}:${editorRevision}:${readinessGeneration}:${approvalChange}`} missionId={detail.missionId} revision={detail.updatedAt} busy={busy} />
      <MissionApprovalContract onChanged={() => setApprovalChange(value => value + 1)} onBusy={setBusy} key={`approval:${detail.missionId}:${detail.updatedAt}:${editorRevision}:${readinessGeneration}`} missionId={detail.missionId} revision={detail.updatedAt} busy={busy} />
      <MissionCapacityPanel key={`capacity:${detail.missionId}:${detail.updatedAt}:${editorRevision}`} missionId={detail.missionId} busy={busy} onBusy={setBusy} />
      <h3 className="cz-display text-lg">Configuration checks</h3>
      {detail.configurationIssues.length ? <ul className="list-disc pl-5">{detail.configurationIssues.map((issue, i) => <li key={i}>{issue}</li>)}</ul> : <p>Valid under current M1 validators. This does not activate the mission.</p>}
      <h3 className="cz-display text-lg">Rule</h3>
      {detail.rule ? <><p>{detail.rule.eventType} · Target {detail.rule.targetCount} · {detail.rule.active ? "Enabled rule" : "Disabled rule"}</p><p>Source: {detail.rule.sourceType ?? "Any"} · Puzzle: {detail.rule.puzzleId ?? "Any"} · Level: {detail.rule.levelId ?? "Any"}</p><pre className="overflow-auto whitespace-pre-wrap">{JSON.stringify(detail.rule.conditions, null, 2)}</pre></> : <p>No rule configured.</p>}
      <h3 className="cz-display text-lg">Configured rewards</h3>
      {detail.rewards.length ? <ul>{detail.rewards.map((reward, i) => <li key={i}>{reward.amount} {reward.rewardType} · {reward.active ? "Enabled" : "Disabled"}</li>)}</ul> : <p>No rewards configured.</p>}
      <MissionRuleEditor key={`rule:${detail.missionId}:${detail.updatedAt}:${editorRevision}`} mission={detail} busy={busy} onSave={input => void run(async () => {
        const saved = await request<AdminMissionDto>(`/api/admin/missions/${detail.missionId}/rule`, { method: "PATCH", body: JSON.stringify(input) });
        if (!mounted.current) return;
        setDetail(saved); setNotice("Mission rule configuration saved. Mission remains inactive."); reload();
      })} />
      <MissionScheduleEditor key={`schedule:${detail.missionId}:${detail.updatedAt}:${editorRevision}`} mission={detail} busy={busy} onSave={input => void run(async () => {
        const saved = await request<AdminMissionDto>(`/api/admin/missions/${detail.missionId}/schedule`, { method: "PATCH", body: JSON.stringify(input) });
        if (!mounted.current) return;
        setDetail(saved); setNotice("Mission schedule saved. Mission remains inactive."); reload();
      })} />
      <MissionRewardEditor key={`rewards:${detail.missionId}:${detail.updatedAt}:${editorRevision}`} mission={detail} busy={busy} onSave={input => void run(async () => {
        const saved = await request<AdminMissionDto>(`/api/admin/missions/${detail.missionId}/rewards`, { method: "PATCH", body: JSON.stringify(input) });
        if (!mounted.current) return;
        setDetail(saved); setNotice("Mission reward configuration saved. Mission remains inactive."); reload();
      })} />
      <MissionLifecycleControls key={`lifecycle:${detail.missionId}:${detail.updatedAt}:${editorRevision}:${readinessGeneration}:${approvalChange}`} mission={detail} busy={busy} onBusy={setBusy} onChanged={async () => {
        const saved = await request<AdminMissionDto>(`/api/admin/missions/${detail.missionId}`);
        if (mounted.current) { setDetail(saved); setEditorRevision(value => value + 1); setNotice("Mission lifecycle updated. Earned records and deadlines are preserved."); reload(); }
      }} />
      <form key={`${detail.missionId}:${detail.updatedAt}:${editorRevision}`} className="space-y-3" onSubmit={event => {
        event.preventDefault();
        if (detail.active) return;
        const form = new FormData(event.currentTarget);
        const body = { title: String(form.get("title") ?? ""), description: String(form.get("description") ?? ""), displayOrder: Number(form.get("displayOrder")), expectedUpdatedAt: detail.updatedAt };
        void run(async () => {
          const saved = await request<AdminMissionDto>(`/api/admin/missions/${detail.missionId}`, { method: "PATCH", body: JSON.stringify(body) });
          if (!mounted.current) return;
          setDetail(saved); setNotice("Mission metadata saved."); reload();
        });
      }}>
        <fieldset disabled={busy || detail.active} className="space-y-3">
          <legend className="cz-display text-lg">Mission metadata</legend>
          <label className="block">Title<input name="title" className="cz-inset block w-full p-3" defaultValue={detail.title} required maxLength={200} /></label>
          <label className="block">Description<textarea name="description" className="cz-inset block w-full p-3" defaultValue={detail.description} maxLength={4000} /></label>
          <label className="block">Display order<input name="displayOrder" className="cz-inset ml-3 p-2" type="number" required min={0} max={2147483647} step={1} defaultValue={detail.displayOrder} /></label>
          <button className="cz-btn" type="submit">Save metadata</button>
        </fieldset>
      </form>
      <button className="cz-btn" disabled={busy} onClick={() => void run(async () => { const result = await request<AdminMissionDto>(`/api/admin/missions/${detail.missionId}`); if (mounted.current) { setDetail(result); setEditorRevision(value => value + 1); } })}>Reload details</button>
      <MissionHistory key={`history:${detail.missionId}:${detail.updatedAt}:${editorRevision}:${approvalChange}`} missionId={detail.missionId} />
    </section>}
  </main>;
}
