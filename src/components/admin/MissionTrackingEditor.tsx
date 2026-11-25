"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { request } from "@/lib/apiClient";
import type { AdminMissionDto } from "@/types/adminMissions";
import { trackingLabels, type MissionCollectible, type MissionTrackingDto } from "./missionManagerModel";
export function MissionTrackingEditor({ mission, missions = [], catalog = [], busy, onSave }: { mission: AdminMissionDto; missions?: AdminMissionDto[]; catalog?: MissionCollectible[]; busy: boolean; onSave: (input: MissionTrackingDto & { expectedUpdatedAt: string }) => void }) {
  const [tracking, setTracking] = useState<MissionTrackingDto | null>(null), [selected, setSelected] = useState<string[]>([]), [error, setError] = useState("");
  const [open, setOpen] = useState(false), [loaded, setLoaded] = useState(false), [mode, setMode] = useState<MissionTrackingDto["mode"]>("EVENT_COUNT");
  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    request<MissionTrackingDto | null>("/api/admin/missions/" + mission.missionId + "/tracking", { signal: c.signal, cache: "no-store" }).then(row => { if (!c.signal.aborted) { setTracking(row); setMode(row?.mode ?? "EVENT_COUNT"); setSelected(row?.eligibleMissionIds ?? []); setLoaded(true); } }).catch(e => { if (!c.signal.aborted) setError(e instanceof Error ? e.message : "Tracking could not be loaded."); });
    return () => c.abort();
  }, [mission.missionId, mission.updatedAt, open]);
  const eligible = missions.filter(m => m.missionId !== mission.missionId && ["DAILY", "WEEKLY"].includes(m.periodType) && m.rule && !m.rule.eventType.startsWith("mission."));
  const unavailableIds = selected.filter(id => !eligible.some(m => m.missionId === id));
  const selectedCollectibleMissing = !!tracking?.collectibleId && !catalog.some(c => c.rewardDefinitionId === tracking.collectibleId);
  return <section className="cz-inset space-y-3 p-4" aria-label="Mission tracking"><h3>Counting and collectible reward</h3><button type="button" disabled={busy} onClick={() => setOpen(v => !v)}>{open ? "Close tracking editor" : mission.active ? "Inspect tracking" : "Edit tracking & collectible"}</button>
    <p>Choose how qualifying activities count. Only supported counting methods and existing collectible definitions can be saved.</p>{error && <p role="alert">{error}</p>}
    {open && !loaded && !error && <p role="status">Loading tracking?</p>}
    {open && loaded && <form key={JSON.stringify(tracking)} aria-label="Configure mission tracking" onSubmit={e => {
      e.preventDefault(); if (busy || mission.active || !mission.rule) return;
      if (unavailableIds.length || selectedCollectibleMissing) { setError("Some saved references are unavailable. Refresh the library and collectible catalog before editing; existing references have been preserved."); return; }
      const data = new FormData(e.currentTarget);
      onSave({ mode, firstEver: data.get("firstEver") === "on", eligibleMissionIds: mode === "DISTINCT_MISSIONS" ? selected : [], collectibleId: String(data.get("collectible") ?? "") || null, expectedUpdatedAt: mission.updatedAt });
    }}><fieldset disabled={busy || mission.active || !mission.rule}>
      <label>How progress is counted<select name="mode" value={mode} onChange={e => setMode(e.target.value as MissionTrackingDto["mode"])}>{Object.entries(trackingLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label className="mm-confirm"><input type="checkbox" name="firstEver" defaultChecked={tracking?.firstEver ?? false} />Only the player&apos;s first qualifying action counts (supported lifetime achievements only)</label>
      {mode === "DISTINCT_MISSIONS" && <fieldset><legend>Eligible missions</legend><p>Select enough different missions for the required completion count. Claims do not count as completions.</p><div className="mm-choice-list">{eligible.map(m => <label key={m.missionId}><input type="checkbox" checked={selected.includes(m.missionId)} onChange={e => setSelected(ids => e.target.checked ? [...ids, m.missionId] : ids.filter(id => id !== m.missionId))} />{m.title} <span className="mm-muted">({m.active ? "active" : "inactive"})</span></label>)}</div>{unavailableIds.length > 0 && <p role="alert">Saved eligible missions are unavailable in the current library. They will not be silently removed.</p>}</fieldset>}
      <label>Collectible reward<select name="collectible" defaultValue={tracking?.collectibleId ?? ""} disabled={mission.periodType !== "LIFETIME"}><option value="">No collectible reward</option>{selectedCollectibleMissing && <option value={tracking!.collectibleId!}>Current collectible ? catalog unavailable</option>}{catalog.map(c => <option key={c.rewardDefinitionId} value={c.rewardDefinitionId} disabled={!c.active}>{c.name} ? {c.rewardType === "FRAME" ? "Profile frame" : "Badge"}{!c.active && " (unavailable)"}</option>)}</select></label>
      {mission.periodType==="LIFETIME"&&<div className="mm-asset-grid" aria-label="Available collectibles">{catalog.filter(c=>c.active).map(c=><figure key={c.rewardDefinitionId}>{c.imageUrl&&/^\/(?!\/)/.test(c.imageUrl)&&<Image unoptimized src={c.imageUrl} width={48} height={48} alt={c.name}/>}<figcaption>{c.name}<br/>{c.rewardType==="FRAME"?"Profile frame":"Badge"}</figcaption></figure>)}</div>}
      {selectedCollectibleMissing && <p role="alert">The saved collectible is unavailable in this catalog response. Refresh before editing; its existing association is preserved.</p>}
      <p>Badge and frame rewards are available for lifetime achievements. This links a catalog reward; it does not grant an item.</p><button className="mm-primary" type="submit" disabled={!!unavailableIds.length || selectedCollectibleMissing}>Save inactive tracking</button>
    </fieldset></form>}
  </section>;
}
