"use client";
import { useEffect, useRef, useState } from "react";
import { request } from "@/lib/apiClient";
import type { AdminMissionDto, AdminMissionReadinessDto, MissionApprovalContractDto, MissionLifecycleResult } from "@/types/adminMissions";

export function MissionLifecycleControls({ mission, busy, onBusy, onChanged }: { mission: AdminMissionDto; busy: boolean; onBusy: (value: boolean) => void; onChanged: () => Promise<void> }) {
  const [review, setReview] = useState<{ contract: MissionApprovalContractDto; readiness: AdminMissionReadinessDto | null; key: string } | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(""), [confirmed, setConfirmed] = useState(false);
  const pending = useRef<AbortController | null>(null), dialog = useRef<HTMLDialogElement | null>(null), trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!review || !dialog.current) return;
    const returnFocus = trigger.current;
    if (dialog.current.showModal) dialog.current.showModal();
    else dialog.current.open = true;
    return () => returnFocus?.focus();
  }, [review]);
  const stale = review && (review.contract.binding.missionId !== mission.missionId || review.contract.binding.approvedConfigurationRevision !== mission.updatedAt || (review.readiness && review.readiness.missionRevision !== mission.updatedAt));
  const allowed = !!review && !stale && (mission.active || (review.readiness?.activationReady === true && review.contract.categories.every(category => category.status === "APPROVED")));
  async function inspect() {
    if (busy || pending.current) return;
    const controller = new AbortController(); pending.current = controller; setLoading(true); setError(""); setConfirmed(false);
    try {
      const [contract, readiness] = await Promise.all([
        request<MissionApprovalContractDto>(`/api/admin/missions/${mission.missionId}/approval-contract`, { signal: controller.signal }),
        mission.active ? Promise.resolve(null) : request<AdminMissionReadinessDto>(`/api/admin/missions/${mission.missionId}/readiness`, { signal: controller.signal }),
      ]);
      if (!controller.signal.aborted) setReview({ contract, readiness, key: crypto.randomUUID() });
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Lifecycle review could not be loaded."); }
    finally { if (!controller.signal.aborted) setLoading(false); if (pending.current === controller) pending.current = null; }
  }
  async function submit() {
    if (!allowed || !review || !confirmed || busy || pending.current) return;
    const controller = new AbortController(); pending.current = controller; setLoading(true); onBusy(true); setError("");
    try {
      await request<MissionLifecycleResult>(`/api/admin/missions/${mission.missionId}/${mission.active ? "deactivate" : "activate"}`, { method: "POST", signal: controller.signal, body: JSON.stringify({ expectedUpdatedAt: review.contract.binding.approvedConfigurationRevision, configurationDigest: review.contract.binding.configurationDigest, idempotencyKey: review.key }) });
      if (!controller.signal.aborted) { setReview(null); await onChanged(); }
    } catch (error) { if (!controller.signal.aborted) { setReview(null); setError(`${error instanceof Error ? error.message : "Lifecycle request failed."} Reload details and review again. A failed response does not prove the operation was not committed.`); } }
    finally { onBusy(false); if (!controller.signal.aborted) setLoading(false); if (pending.current === controller) pending.current = null; }
  }
  return <section className="cz-inset space-y-3 p-4" aria-label="Mission lifecycle controls">
    <h3 className="cz-display text-lg">Controlled mission lifecycle</h3>
    <p>Status: {mission.lifecycle}. Activation requires both current approvals and all server readiness checks. Mission capacity exceptions require explicit SUPER_ADMIN recovery; chest-linked activation remains blocked. Scheduling and approvals never activate missions automatically.</p>
    <button ref={trigger} className="cz-btn" type="button" disabled={busy || loading} onClick={() => void inspect()}>{mission.active ? "Review deactivation" : "Review activation"}</button>
    {loading && <p role="status">Checking mission lifecycle...</p>}{error && <p role="alert">{error}</p>}
    {review && <dialog ref={dialog} aria-labelledby="mission-lifecycle-confirmation" className="cz-surface max-w-xl space-y-4 p-6 backdrop:bg-black/70" onCancel={event => { event.preventDefault(); if (!loading) setReview(null); }}>
      <h4 id="mission-lifecycle-confirmation" className="cz-display text-xl">{mission.active ? "Confirm mission deactivation" : "Confirm mission activation"}</h4>
      <p>{mission.title} · {mission.missionId}</p>
      <p>Reviewed revision: {review.contract.binding.approvedConfigurationRevision} (UTC).</p>
      {stale ? <p role="alert">The reviewed revision is stale. Reload details before continuing.</p> : mission.active ? <p>Stop new mission processing after in-flight work releases its lock. Earned progress, frozen rewards, claim history and existing claim deadlines are preserved. Deactivation does not revoke rewards or extend deadlines.</p> : <>
        <p>Activation requires both current approvals and every server readiness check. The event cutoff can only move forward to activation time; earlier events are not backfilled.</p>
        <ul>{review.readiness?.checks.filter(check => check.status !== "PASS").map(check => <li key={check.code}>{check.status}: {check.message} ({check.code})</li>)}</ul>
      </>}
      <label className="block"><input type="checkbox" checked={confirmed} disabled={!allowed || loading} onChange={event => setConfirmed(event.target.checked)} /> I have reviewed this exact mission and understand the consequences.</label>
      <div className="flex gap-3"><button className="cz-btn" type="button" disabled={busy || loading || !allowed || !confirmed} onClick={() => void submit()}>{mission.active ? "Confirm deactivation" : "Confirm activation"}</button><button className="cz-btn" type="button" disabled={loading} onClick={() => setReview(null)}>Cancel lifecycle change</button></div>
    </dialog>}
  </section>;
}
