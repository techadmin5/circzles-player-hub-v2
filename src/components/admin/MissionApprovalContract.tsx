"use client";
import { useEffect, useRef, useState } from "react";
import { request } from "@/lib/apiClient";
import type { MissionApprovalContractDto } from "@/types/adminMissions";
import { errorMessage, utc } from "./missionManagerModel";
export function MissionApprovalContract({ missionId, revision, initialReport, busy, onChanged, onBusy }: { missionId: string; revision: string; initialReport?: MissionApprovalContractDto; busy: boolean; onChanged?: (saved?: boolean) => void; onBusy?: (value: boolean) => void }) {
  const [report, setReport] = useState<MissionApprovalContractDto | null>(initialReport ?? null), [error, setError] = useState<ReturnType<typeof errorMessage> | null>(null), [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function inspect() {
    if (pending.current || busy) return;
    const c = new AbortController(); pending.current = c; setLoading(true); setReport(null); setError(null); setConfirmed({});
    try { const r = await request<MissionApprovalContractDto>("/api/admin/missions/" + missionId + "/approval-contract", { signal: c.signal, cache: "no-store" }); if (!c.signal.aborted) setReport(r); }
    catch (e) { if (!c.signal.aborted) setError(errorMessage(e)); }
    finally { if (!c.signal.aborted) setLoading(false); pending.current = null; }
  }
  const stale = report && (report.binding.missionId !== missionId || report.binding.approvedConfigurationRevision !== revision);
  async function mutate(category: MissionApprovalContractDto["categories"][number], revoke: boolean) {
    if (!report || stale || pending.current || busy || !confirmed[category.category]) return;
    const c = new AbortController(); pending.current = c; setLoading(true); setError(null); onBusy?.(true);
    try {
      const r = await request<MissionApprovalContractDto>("/api/admin/missions/" + missionId + "/approvals/" + category.category + (revoke ? "/revoke" : ""), { method: "POST", signal: c.signal, body: JSON.stringify({ expectedUpdatedAt: report.binding.approvedConfigurationRevision, configurationDigest: report.binding.configurationDigest, expectedApprovalId: category.recordedApproval?.approvalId ?? null, expectedRevocationId: category.recordedApproval?.revocationId ?? null }) });
      if (!c.signal.aborted) { setReport(r); setConfirmed({}); onChanged?.(true); }
    } catch (e) { if (!c.signal.aborted) { setReport(null); setConfirmed({}); setError(errorMessage(e)); onChanged?.(false); } }
    finally { onBusy?.(false); if (!c.signal.aborted) setLoading(false); pending.current = null; }
  }
  return <section className="mm-approval-center" aria-label="Mission approval contract">
    <div className="mm-toolbar"><div><h3>Two independent approvals</h3><p>Review the product and exact reward amounts separately. Neither action publishes the mission.</p></div><button type="button" disabled={busy || loading} onClick={() => void inspect()}>Refresh approvals</button></div>
    {error && <div role="alert" className="mm-error">{error.message}<details><summary>Technical details</summary>{error.code}</details></div>}
    {loading ? <p role="status">Checking or saving this approval?</p> : !report ? <p>Load the current approval report to continue.</p> : stale ? <p role="alert">This mission has changed since review. Reload details before approving.</p> : <>
      <div className="mm-approval-grid">{report.categories.map(category => {
        const record = category.recordedApproval, revoke = !!record && !record.revocationId;
        const actionable = revoke || (report.recordingEnabled && category.status !== "APPROVED");
        const label = category.category === "PRODUCT" ? "Product" : "Reward budget";
        return <article className="mm-panel" key={category.category}><span className="mm-eyebrow">{category.category === "PRODUCT" ? "STEP 3" : "STEP 4"}</span><h4>{label} approval</h4><span className={"mm-badge " + (category.status === "APPROVED" ? "mm-ready" : "mm-approval")}>{category.status === "MISSING" ? "Awaiting approval" : category.status === "INVALIDATED" ? "Review changed configuration" : category.status}</span>
          <p>{category.category === "PRODUCT" ? "Review the objective, activity threshold, eligibility and schedule." : "Authorize exactly " + (report.rewards.xp ?? "unset") + " XP and " + (report.rewards.synapsePoints ?? "unset") + " Synapse Points. Storage limits are not a reward budget."}</p>
          {record && <p>Recorded {utc(record.approvedAt)}{record.revokedAt && " ? Revoked " + utc(record.revokedAt)}</p>}
          {actionable && <><label className="mm-confirm"><input type="checkbox" checked={!!confirmed[category.category]} onChange={e => setConfirmed(v => ({ ...v, [category.category]: e.target.checked }))} aria-label={"Confirm " + label.toLowerCase() + (revoke ? " revocation" : " approval")} />{revoke ? "I authorize revoking this recorded approval." : "I have reviewed this exact mission configuration and reward amounts."}</label><button className={revoke ? "mm-secondary" : "mm-primary"} disabled={!confirmed[category.category] || busy || loading} onClick={() => void mutate(category, revoke)}>{revoke ? "Revoke " : "Approve "}{label.toLowerCase()}</button></>}
          <details><summary>Approval record details</summary><p>Revision: {report.binding.approvedConfigurationRevision}</p><p className="mm-break">Digest: {report.binding.configurationDigest}</p>{record && <p>Record {record.approvalId} / Administrator {record.approverAdminUserId}</p>}</details>
        </article>;
      })}</div><p className="mm-muted">Configuration changes invalidate approvals. Reverting fields does not revive an old approval. No approval expires automatically.</p>
    </>}
  </section>;
}
