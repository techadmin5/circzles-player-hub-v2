"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminMissionDto } from "@/types/adminMissions";
import { request } from "@/lib/apiClient";
import { MissionApprovalContract } from "./MissionApprovalContract";
import { MissionLifecycleControls } from "./MissionLifecycleControls";
import { MissionHistory } from "./MissionHistory";
import { MissionCapacityPanel } from "./MissionCapacityPanel";
import { MissionRuleEditor } from "./MissionRuleEditor";
import { MissionTrackingEditor } from "./MissionTrackingEditor";
import { MissionScheduleEditor } from "./MissionScheduleEditor";
import { MissionRewardEditor } from "./MissionRewardEditor";
import { MissionRewardPreview } from "./MissionRewardPreview";
import { MissionManagerTabs } from "./MissionManagerTabs";
import { categoryLabel, errorMessage, fresh, readinessMessage, groupLabels, inspectMission, missionGroup, objective, totals, trackingLabels, utc, type MissionCollectible, type MissionInspection } from "./missionManagerModel";
const tabs = ["Overview", "Objective & Tracking", "Rewards", "Schedule", "Approvals", "Activation Readiness", "History & Advanced"];
export function MissionDetailPanel({ mission, missions, catalog, queue, onSelect, onChanged, onInspection, onBack, onBusyChanged }: {
  mission: AdminMissionDto; missions: AdminMissionDto[]; catalog: MissionCollectible[]; queue: AdminMissionDto[];
  onSelect: (id: string) => void; onChanged: (m: AdminMissionDto) => void; onInspection: (id: string, i: MissionInspection) => void; onBack: () => void; onBusyChanged?: (busy: boolean) => void;
}) {
  const [detail, setDetail] = useState(mission), [inspection, setInspection] = useState<MissionInspection | undefined>(), [tab, setTab] = useState("Overview");
  const [serial, setSerial] = useState(0), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [notice, setNotice] = useState(""), [error, setError] = useState<ReturnType<typeof errorMessage> | null>(null);
  const operation = useRef(false), heading = useRef<HTMLHeadingElement>(null), mounted = useRef(false);
  useEffect(() => { mounted.current = true; heading.current?.focus(); return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const c = new AbortController();
    void (async () => {
      const m = await request<AdminMissionDto>("/api/admin/missions/" + mission.missionId, { signal: c.signal, cache: "no-store" });
      if (!c.signal.aborted) { setDetail(m); onChanged(m); }
      const i = await inspectMission(m, c.signal);
      if (!c.signal.aborted) { setInspection(i); onInspection(m.missionId, i); setError(null); }
    })().catch(e => { if (!c.signal.aborted) setError(errorMessage(e)); }).finally(() => { if (!c.signal.aborted) setLoading(false); });
    return () => c.abort();
  }, [mission.missionId, serial, onChanged, onInspection]);
  const setOperationBusy = useCallback((value: boolean) => { operation.current = value; setBusy(value); onBusyChanged?.(value); }, [onBusyChanged]);
  async function save(suffix: string, input: unknown) {
    if (operation.current || loading || detail.active) return;
    setOperationBusy(true); setError(null);
    try {
      const saved = await request<AdminMissionDto>("/api/admin/missions/" + detail.missionId + suffix, { method: "PATCH", body: JSON.stringify(input) });
      if (mounted.current) { setDetail(saved); onChanged(saved); setNotice("Changes saved. The mission remains inactive; review the current configuration before approval."); reloadDetails(); }
    } catch (e) { if (mounted.current) setError(errorMessage(e)); } finally { if (mounted.current) setOperationBusy(false); }
  }
  const valid = fresh(detail, inspection), group = missionGroup(detail, inspection), reward = totals(detail), index = queue.findIndex(m => m.missionId === detail.missionId);
  const approval = inspection?.approval;
  function reloadDetails() { setLoading(true); setInspection(undefined); setSerial(n => n + 1); }
  function reviewed(saved = true) { setNotice(saved ? "Approval updated. No mission has been activated." : "Approval response was not confirmed. The refreshed server report is authoritative; review it before retrying."); reloadDetails(); }
  return <section className="mm-detail mm-panel" aria-label="Mission details">
    <div className="mm-detail-heading"><div><button className="mm-back" disabled={busy} onClick={onBack}>Back to library</button><h2 ref={heading} tabIndex={-1}>{detail.title}</h2><div className="mm-actions"><span className="mm-category">{categoryLabel(detail.category)}</span><span className={"mm-badge mm-" + group}>{groupLabels[group]}</span></div></div><div className="mm-actions"><button disabled={busy || loading} onClick={() => setSerial(n => n + 1)}>Reload details</button>{queue.length > 1 && <><button disabled={busy || index <= 0} onClick={() => onSelect(queue[index - 1].missionId)}>Previous review</button><button disabled={busy || index < 0 || index >= queue.length - 1} onClick={() => onSelect(queue[index + 1].missionId)}>Next review</button></>}</div></div>
    {busy && <p role="status">Saving your explicit action. Please wait before navigating.</p>}{loading && <p role="status">Reading the current configuration, approvals and readiness...</p>}
    {notice && <p className={notice.startsWith("Approval response") ? "mm-error" : "mm-success"} role="status">{notice}</p>}
    {error && <div className="mm-error" role="alert"><p>{error.message}</p><p>A lost response may have saved the operation. Reload before deciding whether to retry.</p><details><summary>Technical details</summary>{error.code}</details></div>}
    {detail.active && <p className="mm-muted">This mission is active. Configuration is read-only until deliberate deactivation. Earned records and original claim deadlines remain unchanged.</p>}
    <MissionManagerTabs tabs={tabs} label="Mission detail sections" value={tab} onChange={setTab} disabled={busy} />
    <div className="mm-tab-content" role="tabpanel" aria-label={tab}>
      {tab === "Overview" && <div className="mm-detail-grid"><div><h3>Player objective</h3><p>{objective(detail, inspection?.tracking)}</p><p className="mm-muted">{detail.description || "No player-facing description yet."}</p><dl className="mm-facts"><dt>Frequency</dt><dd>{categoryLabel(detail.periodType)}</dd><dt>Lifecycle</dt><dd>{categoryLabel(detail.lifecycle)}</dd><dt>Configuration</dt><dd>{valid ? detail.active ? detail.configurationIssues.length ? "Needs review" : "Valid definition (active)" : inspection!.readiness.configurationStatus === "PASS" ? "Complete" : "Needs configuration" : "Not checked"}</dd><dt>Next action</dt><dd>{groupLabels[group]}</dd></dl><button onClick={() => setTab(group === "incomplete" ? "Rewards" : group === "approval" ? "Approvals" : "Activation Readiness")}>Continue review</button>
        <details className="mm-editor"><summary>Edit mission name and description</summary><form aria-label="Mission metadata" key={detail.updatedAt} onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); void save("", { title: String(form.get("title") ?? ""), description: String(form.get("description") ?? ""), displayOrder: Number(form.get("displayOrder")), expectedUpdatedAt: detail.updatedAt }); }}><fieldset disabled={busy || loading || detail.active}><label>Title<input name="title" required maxLength={200} defaultValue={detail.title} /></label><label>Player-facing description<textarea name="description" maxLength={4000} defaultValue={detail.description} /></label><label>Display order<input name="displayOrder" type="number" min={0} max={2147483647} step={1} required defaultValue={detail.displayOrder} /></label><button className="mm-primary">Save metadata</button></fieldset></form></details></div><aside className="mm-player-preview"><p className="mm-eyebrow">PLAYER CARD PREVIEW</p><h3>{detail.title}</h3><p>{detail.description}</p><p>{objective(detail, inspection?.tracking)}</p><MissionRewardPreview mission={detail} tracking={inspection?.tracking} catalog={catalog} /><p className="mm-muted">Appearance preview only. Rewards are not granted here; inactive missions are not published.</p></aside></div>}
      {tab === "Objective & Tracking" && <><h3>What should the player do?</h3><p>{objective(detail, inspection?.tracking)}</p><p className="mm-muted">{inspection?.tracking ? trackingLabels[inspection.tracking.mode] : "Tracking details not loaded or using the existing event-count behavior."}</p><MissionRuleEditor key={"rule:" + detail.updatedAt} mission={detail} busy={busy || loading} onSave={input => void save("/rule", input)} /><MissionTrackingEditor key={"tracking:" + detail.updatedAt} mission={detail} missions={missions} catalog={catalog} busy={busy || loading} onSave={input => void save("/tracking", input)} /></>}
      {tab === "Rewards" && <><h3>{reward.configured ? "Proposed mission rewards" : "Reward configuration required"}</h3><MissionRewardPreview mission={detail} tracking={inspection?.tracking} catalog={catalog} /><p className="mm-muted">Currency status: {!reward.configured ? "INCOMPLETE" : approval?.categories.find(c => c.category === "REWARD_BUDGET")?.status === "APPROVED" && valid ? "APPROVED ? exact current amounts" : "PROPOSED ? awaiting reward-budget approval"}. Configuring a reward never grants it.</p><MissionRewardEditor key={"reward:" + detail.updatedAt} mission={detail} busy={busy || loading} onSave={input => void save("/rewards", input)} /><p>Badge and frame associations are configured in Objective &amp; Tracking. Collectibles supplement supported currency rewards; they do not replace them.</p><button onClick={() => setTab("Objective & Tracking")}>Manage collectible association</button></>}
      {tab === "Schedule" && <><h3>Availability and claim windows</h3><dl className="mm-facts"><dt>Available from</dt><dd>{utc(detail.startsAt)}</dd><dt>Available until</dt><dd>{utc(detail.endsAt)}</dd><dt>Reward claim deadline</dt><dd>{["DAILY", "WEEKLY"].includes(detail.periodType) ? "24 hours after each UTC period ends" : utc(detail.claimDeadline)}</dd></dl><MissionScheduleEditor key={"schedule:" + detail.updatedAt} mission={detail} busy={busy || loading} onSave={input => void save("/schedule", input)} /></>}
      {tab === "Approvals" && <><div className="mm-review-steps"><h3>Review this mission individually</h3><ol><li>Player objective: {objective(detail, inspection?.tracking)}.</li><li>Frequency: {categoryLabel(detail.periodType)}. Availability: {utc(detail.startsAt)} to {utc(detail.endsAt)}.</li><li>Exact rewards: <MissionRewardPreview mission={detail} tracking={inspection?.tracking} catalog={catalog} /></li></ol></div>{!loading && valid ? <MissionApprovalContract key={detail.updatedAt + ":" + serial} missionId={detail.missionId} revision={detail.updatedAt} initialReport={inspection!.approval} busy={busy} onBusy={setOperationBusy} onChanged={reviewed} /> : <p>Reload the current mission and approval report before taking action.</p>}<button disabled={busy} onClick={() => setTab("Activation Readiness")}>Next: check activation readiness</button></>}
      {tab === "Activation Readiness" && <><h3>{detail.active ? "Active mission safeguards" : "Can this mission go live?"}</h3>{detail.active && <p>This mission is already live. Activation-readiness checks require inactivity and do not indicate that current processing has stopped.</p>}<p className="mm-muted">This checklist is read from the server for the displayed mission revision. The backend checks it again during activation.</p>{valid ? <><div className="mm-checklist">{inspection!.readiness.checks.map(check => <div key={check.code} className={"mm-check mm-" + check.status.toLowerCase()}><span className="mm-badge">{check.status}</span><div><p>{readinessMessage(check)}</p><details><summary>Technical details</summary>{check.code} - {check.field}<p>{check.message}</p></details></div></div>)}</div><p>Product approval: {approval?.categories.find(c => c.category === "PRODUCT")?.status}. Reward budget: {approval?.categories.find(c => c.category === "REWARD_BUDGET")?.status}.</p></> : <p className="mm-error">Readiness is unavailable or stale. Reload details; no activation is permitted from this report.</p>}
        {!loading && <MissionLifecycleControls key={detail.updatedAt + ":" + serial} mission={detail} busy={busy} onBusy={setOperationBusy} tracking={inspection?.tracking} catalog={catalog} onChanged={async () => { setNotice("Lifecycle updated. Earned progress, rewards and original deadlines are preserved."); reloadDetails(); }} />}</>}
      {tab === "History & Advanced" && <><MissionHistory key={detail.updatedAt + ":" + serial} missionId={detail.missionId} /><details className="mm-advanced"><summary>Advanced definition details</summary><dl className="mm-facts"><dt>Mission ID</dt><dd>{detail.missionId}</dd><dt>Configuration revision</dt><dd>{detail.updatedAt}</dd><dt>Configuration digest</dt><dd>{approval?.binding.configurationDigest ?? "Not inspected"}</dd><dt>Event cutoff</dt><dd>{detail.activationEffectiveAt}</dd></dl><pre>{JSON.stringify({ rule: detail.rule, tracking: inspection?.tracking, rewards: detail.rewards }, null, 2)}</pre></details><details><summary>Reward capacity exceptions and authorized recovery</summary><MissionCapacityPanel missionId={detail.missionId} busy={busy} onBusy={setOperationBusy} /></details></>}
    </div>
  </section>;
}
