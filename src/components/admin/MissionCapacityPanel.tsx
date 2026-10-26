"use client";
import { useRef, useState } from "react";
import { request } from "@/lib/apiClient";

import type { MissionCapacityDto } from "@/types/adminMissions";
export function MissionCapacityPanel({ missionId, busy, onBusy }: { missionId: string; busy: boolean; onBusy: (busy: boolean) => void }) {
  const [page, setPage] = useState<{ entries: MissionCapacityDto[]; hasMore: boolean } | null>(null), [offset, setOffset] = useState(0), [error, setError] = useState("");
  const [loading, setLoading] = useState(false); const pending = useRef(false);
  async function load(next = offset) {
    if (pending.current || busy) return;
    pending.current = true; setLoading(true); setError("");
    try { setPage(await request(`/api/admin/missions/${missionId}/capacity-exceptions?limit=25&offset=${next}`)); setOffset(next); }
    catch (e) { setPage(null); setError(e instanceof Error ? e.message : "Exceptions could not be loaded."); }
    finally { pending.current = false; setLoading(false); }
  }
  return <section aria-label="Mission capacity exceptions" className="cz-inset space-y-3 p-4">
    <h3 className="cz-display text-lg">Reward capacity exceptions</h3>
    <p>On-time individual mission claims only. Recovery is an explicit SUPER_ADMIN action for the original XP/SP amounts. Original deadlines are unchanged; permanently blocked exceptions remain pending. Chest exceptions are not supported.</p>
    <button className="cz-btn" type="button" disabled={busy || loading} onClick={() => void load()}>Inspect capacity exceptions</button>
    {error && <p role="alert">{error}</p>}{loading && <p role="status">Loading capacity exceptions...</p>}
    {page && !page.entries.length && <p>No recorded capacity exceptions.</p>}
    {page?.entries.map(row => <CapacityRecovery key={`${row.exceptionId}:${row.revision}`} row={row} busy={busy || loading} onBusy={onBusy} onSaved={saved => setPage(current => current && ({ ...current, entries: current.entries.map(item => item.exceptionId === saved.exceptionId ? saved : item) }))} />)}
    {page && <div className="flex gap-3"><button className="cz-btn" disabled={busy || loading || !offset} onClick={() => void load(Math.max(0, offset - 25))}>Previous exceptions</button><button className="cz-btn" disabled={busy || loading || !page.hasMore} onClick={() => void load(offset + 25)}>Next exceptions</button></div>}
  </section>;
}
function CapacityRecovery({ row, busy, onBusy, onSaved }: { row: MissionCapacityDto; busy: boolean; onBusy: (busy: boolean) => void; onSaved: (row: MissionCapacityDto) => void }) {
  const [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false), [error, setError] = useState(""); const pending = useRef(false);
  return <article className="space-y-3 border-t pt-3">
    <p>{row.status} · {row.exceptionId} · Player {row.playerId} · Period {row.periodKey}</p>
    <p>Frozen reward: {row.xp} XP / {row.synapsePoints} SP. Arrival: {row.arrivedAt} UTC. Original deadline: {row.claimDeadline ?? "None"}. Revision: {row.revision}.</p>
    <ol>{row.history.map(e => <li key={e.eventId}>{e.action} · {e.occurredAt} UTC · {e.actorAdminUserId ?? "Authenticated player claim"} · {e.reason} {e.errorCode}</li>)}</ol>
    {error && <p role="alert">{error}</p>}
    {row.status === "PENDING" && <form onSubmit={event => {
      event.preventDefault(); if (busy || pending.current || !confirmed || !reason.trim()) return;
      pending.current = true; onBusy(true); setError("");
      void request<MissionCapacityDto>(`/api/admin/mission-capacity-exceptions/${row.exceptionId}/recover`, { method: "POST", body: JSON.stringify({ expectedEventId: row.revision, digest: row.digest, reason: reason.trim(), idempotencyKey: crypto.randomUUID() }) })
        .then(onSaved).catch(e => { setConfirmed(false); setError(`${e instanceof Error ? e.message : "Recovery failed."} Reinspect before retrying; a lost response may have committed.`); }).finally(() => { pending.current = false; onBusy(false); });
    }}>
      <label className="block">Recovery reason<textarea className="cz-inset block w-full p-2" required maxLength={2000} disabled={busy} value={reason} onInput={e => setReason(e.currentTarget.value)} /></label>
      <label className="block"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I authorize an exact frozen reward recovery attempt for this entitlement.</label>
      <button className="cz-btn" disabled={busy || !confirmed || !reason.trim()}>Authorize exact recovery</button>
    </form>}
  </article>;
}
