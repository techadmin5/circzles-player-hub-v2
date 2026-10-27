"use client";

import { useEffect, useRef, useState } from "react";
import type { DataMode } from "@/config/dataMode";
import { apiClient, ApiClientError } from "@/lib/apiClient";
import type { PlayerMissionHistoryEntry, PlayerMissionHistoryPage } from "@/types/missionHistory";
import { usePlayerUiState } from "@/stores/playerUiState";

const descriptions: Record<PlayerMissionHistoryEntry["state"], string> = {
  IN_PROGRESS: "In progress — no earned reward recorded yet.",
  UNCLAIMED: "Earned, not paid. Use the active missions section to claim an eligible reward.",
  EXPIRED: "Original claim deadline passed. No payout is recorded.",
  CAPACITY_PENDING: "On-time claim recorded. No payout yet; administrator recovery is required, even after the original deadline.",
  CAPACITY_BLOCKED: "Last recovery attempt was blocked by reward capacity. No payout is recorded; administrator review is required.",
  RECOVERED: "Paid through authorized recovery using the original frozen reward.",
  PAID: "Reward paid. No further claim is needed.",
  REVIEW_REQUIRED: "Historical payment evidence is incomplete. Contact support; this history does not authorize a payout.",
};

export function MissionHistory({ mode }: { mode: DataMode }) {
  const version = usePlayerUiState(state => state.sessionVersion);
  const playerId = usePlayerUiState(state => state.player?.internalId);
  const owner = `${version}:${playerId ?? "session"}`;
  return <MissionHistoryFeed key={`${mode}:${owner}`} mode={mode} />;
}

function MissionHistoryFeed({ mode }: { mode: DataMode }) {
  const [page, setPage] = useState<PlayerMissionHistoryPage | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const visible = page;
  function refresh() {
    if (pending.current) return;
    setPage(null); setError(null); setLoading(true); setAttempt(value => value + 1);
  }
  useEffect(() => {
    if (mode !== "api") return;
    const controller = new AbortController(); request.current = controller; pending.current = true;
    apiClient.getMissionHistory(undefined, controller.signal).then(result => {
      if (!controller.signal.aborted) setPage(result);
    }).catch((failure: unknown) => { if (!controller.signal.aborted) setError(historyError(failure)); })
      .finally(() => { if (!controller.signal.aborted) { setLoading(false); pending.current = false; } });
    return () => { controller.abort(); request.current?.abort(); };
  }, [mode, attempt]);
  async function more() {
    if (pending.current || !visible?.nextCursor) return;
    pending.current = true; setLoading(true); setError(null);
    const controller = new AbortController(); request.current = controller;
    try {
      const next = await apiClient.getMissionHistory(visible.nextCursor, controller.signal);
      if (!controller.signal.aborted) setPage(current => current ? { entries: [...current.entries, ...next.entries], nextCursor: next.nextCursor } : current);
    } catch (failure) { if (!controller.signal.aborted) setError(historyError(failure)); }
    finally { if (!controller.signal.aborted) { pending.current = false; setLoading(false); } }
  }
  return <section aria-label="Mission History" className="mt-8 grid gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="cz-display text-xl font-bold">Mission History</h2>
      {mode === "api" && <button type="button" className="cz-btn cz-btn-ghost cz-btn-sm" disabled={loading} onClick={refresh}>Refresh history</button>}
    </div>
    {mode !== "api" ? <p>Mission history is available for signed-in player accounts in API mode.</p> : <>
      <p className="text-sm text-[var(--cz-text-secondary)]">Your recorded progress and rewards, including inactive missions. Names reflect current definitions; reward amounts use saved historical evidence. All dates are UTC.</p>
      {loading && <p role="status">Loading mission history…</p>}
      {error && <p role="alert">{error} {!visible && <button type="button" className="cz-btn cz-btn-ghost cz-btn-sm" disabled={loading} onClick={refresh}>Retry history</button>}</p>}
      {visible?.entries.length === 0 && !loading && <p>No mission history recorded yet.</p>}
      {visible?.entries.map(entry => <article key={entry.entitlementId} className="cz-surface grid gap-2 p-4">
        <h3 className="cz-display font-bold">{entry.title}</h3>
        <p>Period: {entry.periodKey} · Progress: {entry.progress.current} / {entry.progress.target}</p>
        <p>{descriptions[entry.state]}</p>
        <p>{entry.rewards ? `${entry.rewards.xp} XP / ${entry.rewards.synapsePoints} SP (${entry.rewardSource === "CLAIM_SNAPSHOT" ? "paid snapshot" : "earned snapshot"})` : "Historical reward amounts unavailable. Current reward settings are not substituted."}</p>
        <dl className="grid gap-1 text-xs text-[var(--cz-text-secondary)]">
          <HistoryDate label="Recorded" value={entry.recordedAt} />
          <HistoryDate label="Period starts" value={entry.periodStartsAt} />
          <HistoryDate label="Period ends" value={entry.periodEndsAt} />
          <HistoryDate label="Completed" value={entry.completedAt} />
          <HistoryDate label="Original claim deadline" value={entry.claimDeadline} />
          <HistoryDate label="Claim recorded" value={entry.claimedAt} />
          {entry.capacity && <><HistoryDate label="On-time claim received" value={entry.capacity.arrivedAt} /><HistoryDate label="Capacity exception recorded" value={entry.capacity.recordedAt} /><HistoryDate label="Recovery status updated" value={entry.capacity.updatedAt} /></>}
        </dl>
      </article>)}
      {visible?.nextCursor && <button type="button" className="cz-btn cz-btn-ghost" disabled={loading} onClick={() => void more()}>{loading ? "Loading…" : "Load older history"}</button>}
    </>}
  </section>;
}
function HistoryDate({ label, value }: { label: string; value: string | null }) {
  return <div className="flex flex-wrap gap-x-2"><dt>{label}:</dt><dd>{value ? <time dateTime={value}>{value} (UTC)</time> : "Not recorded"}</dd></div>;
}
function historyError(error: unknown) {
  return error instanceof ApiClientError && error.status === 401 ? "Your session has expired. Sign in again to view history." : "Mission history could not be loaded. Try again.";
}
