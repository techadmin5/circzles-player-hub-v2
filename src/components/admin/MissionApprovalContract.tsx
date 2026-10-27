"use client";
import { useEffect, useRef, useState } from "react";
import { request } from "@/lib/apiClient";
import type { MissionApprovalContractDto } from "@/types/adminMissions";

export function MissionApprovalContract({ missionId, revision, busy, onChanged, onBusy }: { missionId: string; revision: string; busy: boolean; onChanged?: () => void; onBusy?: (value: boolean) => void }) {
  const [report, setReport] = useState<MissionApprovalContractDto | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function inspect() {
    if (pending.current || busy) return;
    const controller = new AbortController(); pending.current = controller; setLoading(true); setReport(null); setError(""); setConfirmed({});
    try {
      const result = await request<MissionApprovalContractDto>(`/api/admin/missions/${missionId}/approval-contract`, { signal: controller.signal });
      if (!controller.signal.aborted) setReport(result);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Approval contract could not be loaded."); }
    finally { if (!controller.signal.aborted) setLoading(false); if (pending.current === controller) pending.current = null; }
  }
  const stale = report && (report.binding.missionId !== missionId || report.binding.approvedConfigurationRevision !== revision);
  async function mutate(category: MissionApprovalContractDto["categories"][number], revoke: boolean) {
    if (!report || stale || pending.current || busy || !confirmed[category.category]) return;
    const controller = new AbortController(); pending.current = controller; setLoading(true); setError(""); onBusy?.(true);
    try {
      const result = await request<MissionApprovalContractDto>(`/api/admin/missions/${missionId}/approvals/${category.category}${revoke ? "/revoke" : ""}`, {
        method: "POST", signal: controller.signal, body: JSON.stringify({ expectedUpdatedAt: report.binding.approvedConfigurationRevision, configurationDigest: report.binding.configurationDigest, expectedApprovalId: category.recordedApproval?.approvalId ?? null, expectedRevocationId: category.recordedApproval?.revocationId ?? null }),
      });
      if (!controller.signal.aborted) { setReport(result); setConfirmed({}); onChanged?.(); }
    } catch (error) { if (!controller.signal.aborted) { setReport(null); setConfirmed({}); setError(error instanceof Error ? error.message : "Approval change failed. Reload and inspect again."); onChanged?.(); } }
    finally { onBusy?.(false); if (!controller.signal.aborted) setLoading(false); if (pending.current === controller) pending.current = null; }
  }
  return <section className="cz-inset space-y-3 p-4" aria-label="Mission approval contract">
    <h3 className="cz-display text-lg">Mission approvals</h3>
    <p>SUPER_ADMIN product and reward-budget approvals are independent. Both are required for future activation. Approval never activates a mission or awards rewards.</p>
    <button className="cz-btn" type="button" disabled={busy || loading} onClick={() => void inspect()}>{loading ? "Loading approval contract..." : "Inspect approval contract"}</button>
    {loading ? <p role="status">Reading or saving approval configuration...</p> : busy ? <p role="status">Reinspect the contract after the pending mission request.</p> : error ? <p role="alert">{error}</p> : !report ? <p>No contract inspected. Inspect persisted approvals before continuing.</p> : stale ? <p role="alert">Contract revision differs from displayed details. Reload details and inspect again.</p> : <>
      <p>Approval actions do not activate missions. {report.missionInactive ? "The mission remains inactive." : "This mission is active; inspection and revocation do not change it."}</p>
      <p>Configuration revision: {report.binding.approvedConfigurationRevision}. Inspected {report.evaluatedAt} (UTC).</p>
      <p className="break-all">Configuration SHA-256: {report.binding.configurationDigest}</p>
      <p>Configured reward: {report.rewards.xp ?? "Incomplete"} XP / {report.rewards.synapsePoints ?? "Incomplete"} SP. Budget approval covers these exact amounts; no global cap is implied.</p>
      {report.categories.map(category => {
        const label = category.category === "PRODUCT" ? "product" : "reward-budget", record = category.recordedApproval;
        const revoke = !!record && !record.revocationId;
        const actionable = revoke || (report.recordingEnabled && category.status !== "APPROVED");
        return <article className="space-y-2" key={category.category}>
          <h4>{label === "product" ? "Product approval" : "Reward-budget approval"}: {category.status}</h4>
          {record ? <><p>Approval #{record.approvalId} by administrator {record.approverAdminUserId} at {record.approvedAt} (UTC). Approved amounts: {record.xp} XP / {record.synapsePoints} SP.</p><p>Approved revision: {record.approvedConfigurationRevision}. Digest: {record.configurationDigest}.</p>{record.revokedAt && <p>Revoked by administrator {record.revokedByAdminUserId} at {record.revokedAt} (UTC).</p>}</> : <p>No recorded approval.</p>}
          {actionable && <><label className="block"><input type="checkbox" checked={!!confirmed[category.category]} onChange={event => setConfirmed(values => ({ ...values, [category.category]: event.target.checked }))} aria-label={`Confirm ${label} ${revoke ? "revocation" : "approval"}`} /> I confirm {revoke ? "revocation of this recorded approval" : "review of this exact configuration, schedule, claim windows and XP/SP amounts"}.</label><button className="cz-btn" type="button" disabled={!confirmed[category.category] || loading || busy} onClick={() => void mutate(category, revoke)}>{revoke ? "Revoke" : "Grant"} {label} approval</button></>}
        </article>;
      })}
      <p>Approvals do not expire automatically. Configuration changes invalidate them, including later revisions that revert earlier values. History remains append-only.</p>
      <p>Unsafe payouts fail atomically and preserve earned eligibility and original deadlines. No automatic compensation or deadline extension is provided.</p>
    </>}
  </section>;
}
