"use client";
import { useEffect, useRef, useState } from "react";
import { request } from "@/lib/apiClient";
import type { AdminMissionReadinessDto } from "@/types/adminMissions";

export function MissionReadiness({ missionId, revision, busy }: { missionId: string; revision: string; busy: boolean }) {
  const [result, setResult] = useState<AdminMissionReadinessDto | null>(null), [error, setError] = useState(""), [checking, setChecking] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function check() {
    if (pending.current || busy) return;
    const controller = new AbortController(); pending.current = controller;
    setChecking(true); setError(""); setResult(null);
    try {
      const response = await request<AdminMissionReadinessDto>(`/api/admin/missions/${missionId}/readiness`, { signal: controller.signal });
      if (!controller.signal.aborted) setResult(response);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Readiness could not be evaluated."); }
    finally { if (!controller.signal.aborted) setChecking(false); if (pending.current === controller) pending.current = null; }
  }
  const stale = result && (result.missionId !== missionId || result.missionRevision !== revision);
  return <section className="cz-inset space-y-3 p-4" aria-label="Activation Readiness">
    <h3 className="cz-display text-lg">Activation Readiness</h3>
    <p>Read-only preview of persisted configuration. Configuration validity does not establish product approval or authorize activation.</p>
    <button className="cz-btn" type="button" disabled={busy || checking} onClick={() => void check()}>{checking ? "Checking readiness..." : "Check readiness"}</button>
    {busy ? <p role="status">Readiness is unavailable while a mission request is pending. Recheck after saving.</p> : error ? <p role="alert">Readiness: {error}</p> : checking ? <p role="status">Evaluating stored configuration...</p> : !result ? <p>No preview calculated. Check readiness to inspect the current stored configuration.</p> : stale ? <p role="alert">Readiness revision differs from the displayed mission. Reload details and check again; this result is stale for this screen.</p> : <>
      <p>Overall: {result.overallStatus}. Configuration: {result.configurationStatus}. Product approval: {result.productApproval === "APPROVED" ? "approved" : "not recorded"}.</p>
      <p>Evaluated {result.evaluatedAt} (UTC). Mission revision: {result.missionRevision}.</p>
      <p>PASS validates the named check only. BLOCKED requires resolution; WARNING is advisory. Use controlled lifecycle review for activation; this checklist never changes mission state.</p>
      <p>Player balances were not inspected. Unsafe grants are rejected atomically without partial awards. Storage limits are not approved reward budgets; future claims may require review if headroom is exhausted.</p>
      <ul className="space-y-3" aria-label="Readiness checklist">{result.checks.map(check => <li className="border-t border-[var(--cz-hairline)] pt-3" key={check.code}>
        <p><strong>{check.status}</strong> · {check.category} · {check.code}</p>
        <p>Field: {check.field}</p><p>{check.message}</p>
      </li>)}</ul>
    </>}
  </section>;
}
