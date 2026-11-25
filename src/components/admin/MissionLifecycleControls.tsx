"use client";
import { useEffect, useRef, useState } from "react";
import { request } from "@/lib/apiClient";
import type { AdminMissionDto, AdminMissionReadinessDto, MissionApprovalContractDto, MissionLifecycleResult } from "@/types/adminMissions";
import { MissionRewardPreview } from "./MissionRewardPreview";
import { activationAllowed, approvalBindingMatches, readinessBindingMatches, categoryLabel, errorMessage, friendlyIssue, objective, utc, type MissionCollectible, type MissionTrackingDto } from "./missionManagerModel";
export function MissionLifecycleControls({ mission, busy, onBusy, onChanged, tracking, catalog = [] }: { mission: AdminMissionDto; busy: boolean; onBusy: (value: boolean) => void; onChanged: () => Promise<void>; tracking?: MissionTrackingDto | null; catalog?: MissionCollectible[] }) {
  const [review, setReview] = useState<{ contract: MissionApprovalContractDto; readiness: AdminMissionReadinessDto | null; key: string } | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState<ReturnType<typeof errorMessage> | null>(null), [confirmed, setConfirmed] = useState(false);
  const pending = useRef<AbortController | null>(null), dialog = useRef<HTMLDialogElement | null>(null), trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!review || !dialog.current) return;
    const el = dialog.current, returnFocus = trigger.current;
    if (el.showModal) el.showModal(); else el.open = true;
    el.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
    return () => returnFocus?.focus();
  }, [review]);
  const stale = !!review && (!approvalBindingMatches(mission, review.contract) || (!mission.active && !readinessBindingMatches(mission, review.readiness)));
  const allowed = !!review && !stale && (mission.active || activationAllowed(mission, review.readiness, review.contract));
  async function inspect() {
    if (busy || pending.current) return;
    const c = new AbortController(); pending.current = c; setLoading(true); setError(null); setConfirmed(false);
    try {
      const [contract, readiness] = await Promise.all([request<MissionApprovalContractDto>("/api/admin/missions/" + mission.missionId + "/approval-contract", { signal: c.signal, cache: "no-store" }), mission.active ? Promise.resolve(null) : request<AdminMissionReadinessDto>("/api/admin/missions/" + mission.missionId + "/readiness", { signal: c.signal, cache: "no-store" })]);
      if (!contract?.binding || !contract.rewards || !Array.isArray(contract.categories)) throw new Error("The approval report is incomplete. Reload before reviewing activation.");
      if (!mission.active && (!readiness || !Array.isArray(readiness.checks))) throw new Error("The readiness report is incomplete. Reload before reviewing activation.");
      if (!c.signal.aborted) setReview({ contract, readiness, key: crypto.randomUUID() });
    } catch (e) { if (!c.signal.aborted) setError(errorMessage(e)); }
    finally { if (!c.signal.aborted) setLoading(false); pending.current = null; }
  }
  async function submit() {
    if (!allowed || !review || !confirmed || busy || pending.current) return;
    const c = new AbortController(); pending.current = c; setLoading(true); onBusy(true); setError(null);
    try {
      await request<MissionLifecycleResult>("/api/admin/missions/" + mission.missionId + (mission.active ? "/deactivate" : "/activate"), { method: "POST", signal: c.signal, body: JSON.stringify({ expectedUpdatedAt: review.contract.binding.approvedConfigurationRevision, configurationDigest: review.contract.binding.configurationDigest, idempotencyKey: review.key }) });
      if (!c.signal.aborted) { setReview(null); await onChanged(); }
    } catch (e) { if (!c.signal.aborted) { setReview(null); setError(errorMessage(e)); } }
    finally { onBusy(false); if (!c.signal.aborted) setLoading(false); pending.current = null; }
  }
  return <section className="mm-lifecycle" aria-label="Mission lifecycle controls"><h3>{mission.active ? "Deactivate this mission" : "Publish only when ready"}</h3>
    <p>{mission.active ? "Deactivation stops new mission processing. Earned records, rewards, claims and original deadlines remain." : "Both current approvals and every server readiness requirement must pass. No earlier player activity is backfilled."}</p>
    <button ref={trigger} className="mm-primary" disabled={busy || loading} onClick={() => void inspect()}>{mission.active ? "Review deactivation" : "Review activation"}</button>
    {loading && <p role="status">Checking the current approval and readiness reports?</p>}{error && <div className="mm-error" role="alert">{error.message}<p>Reload before retrying. A lost response may have committed.</p><details><summary>Technical details</summary>{error.code}</details></div>}
    {review && <dialog ref={dialog} aria-labelledby="mission-lifecycle-confirmation" className="mm-modal" onCancel={event => { event.preventDefault(); if (!loading) setReview(null); }} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')];
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <p className="mm-eyebrow">EXPLICIT LIFECYCLE CONFIRMATION</p><h4 id="mission-lifecycle-confirmation">{mission.active ? "Deactivate mission?" : "Activate mission?"}</h4><h3>{mission.title}</h3><p>{categoryLabel(mission.category)} - {objective(mission, tracking)}</p><MissionRewardPreview mission={mission} tracking={tracking} catalog={catalog} /><dl className="mm-facts"><dt>Availability</dt><dd>{utc(mission.startsAt)} to {utc(mission.endsAt)}</dd><dt>Claim deadline</dt><dd>{["DAILY", "WEEKLY"].includes(mission.periodType) ? "24 hours after the UTC period ends" : utc(mission.claimDeadline)}</dd><dt>Reviewed configuration revision</dt><dd>{review.contract.binding.approvedConfigurationRevision}</dd></dl>
      {stale ? <p role="alert" className="mm-error">This review is stale. Reload the mission before continuing.</p> : mission.active ? <p>Earned progress, frozen rewards and claim history are retained. Existing claim deadlines are not extended.</p> : <><p>Activation enables future eligible activity from the server&apos;s activation cutoff. The backend revalidates the current configuration inside the activation transaction.</p><ul>{review.readiness?.checks.filter(c => c.status !== "PASS").map(c => <li key={c.code}>{c.status}: {friendlyIssue(c.code, c.message)}</li>)}</ul>{!allowed && <p role="alert" className="mm-error">This mission cannot go live until all listed requirements and both current approvals pass.</p>}</>}
      <label className="mm-confirm"><input type="checkbox" checked={confirmed} disabled={!allowed || loading} onChange={e => setConfirmed(e.target.checked)} />I reviewed this exact mission, rewards and schedule and understand the consequences.</label><div className="mm-actions"><button data-cancel type="button" disabled={loading} onClick={() => setReview(null)}>Cancel</button><button className={mission.active ? "mm-danger" : "mm-primary"} disabled={busy || loading || !allowed || !confirmed} onClick={() => void submit()}>{mission.active ? "Deactivate mission" : "Activate mission"}</button></div>
    </dialog>}
  </section>;
}
