"use client";
import { useEffect, useState } from "react";
import { request } from "@/lib/apiClient";
import type { AdminMissionHistoryPage } from "@/types/adminMissions";

export function MissionHistory({ missionId }: { missionId: string }) {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<AdminMissionHistoryPage | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    request<AdminMissionHistoryPage>(`/api/admin/missions/${missionId}/history?limit=25&offset=${offset}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setPage(result); })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Change history could not be loaded."); });
    return () => controller.abort();
  }, [missionId, offset]);
  function changePage(next: number) { setError(""); setPage(null); setOffset(next); }
  return <section className="cz-inset space-y-3 p-4" aria-label="Administrator change history">
    <h3 className="cz-display text-lg">Administrator change history</h3>
    {error ? <p role="alert">Change history: {error}</p> : !page ? <p role="status">Loading change history...</p> : !page.entries.length ? <p>No recorded administrator changes. Earlier changes are not backfilled.</p> : page.entries.map(entry => <article className="border-t border-[var(--cz-hairline)] pt-3" key={entry.historyId}>
      <h4>{entry.action === "MISSION_ACTIVATED" ? "Mission activated" : entry.action === "MISSION_DEACTIVATED" ? "Mission deactivated" : entry.action === "APPROVAL_GRANTED" ? "Approval granted" : entry.action === "APPROVAL_REVOKED" ? "Approval revoked" : entry.action === "DRAFT_CREATED" ? "Draft created" : entry.action === "RULE_CONFIGURED" ? "Rule configured" : entry.action === "SCHEDULE_CONFIGURED" ? "Schedule configured" : entry.action === "REWARDS_CONFIGURED" ? "Rewards configured" : "Metadata updated"}</h4>
      <p>{new Date(entry.occurredAt).toISOString()} (UTC) · Administrator {entry.actorAdminUserId}</p>
      <p>Mission {entry.missionId} · History #{entry.historyId}</p>
      {entry.before && <><h5>Before</h5><pre className="overflow-auto whitespace-pre-wrap">{JSON.stringify(entry.before, null, 2)}</pre></>}
      <h5>After</h5><pre className="overflow-auto whitespace-pre-wrap">{JSON.stringify(entry.after, null, 2)}</pre>
    </article>)}
    <div className="flex gap-3">
      <button className="cz-btn" disabled={!page || offset === 0} onClick={() => changePage(Math.max(0, offset - 25))}>Earlier history page</button>
      <button className="cz-btn" disabled={!page?.hasMore} onClick={() => changePage(offset + 25)}>Older changes</button>
    </div>
  </section>;
}
