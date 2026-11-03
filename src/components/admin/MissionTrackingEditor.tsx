"use client";
import { useEffect, useState } from "react";
import { request } from "@/lib/apiClient";
import type { AdminMissionDto } from "@/types/adminMissions";

type Tracking = { mode: "EVENT_COUNT" | "DISTINCT_UTC_DAYS" | "DISTINCT_MISSIONS"; firstEver: boolean; eligibleMissionIds: string[]; collectibleId: string | null };
export function MissionTrackingEditor({ mission, busy, onSave }: { mission: AdminMissionDto; busy: boolean; onSave: (input: Tracking & { expectedUpdatedAt: string }) => void }) {
  const [tracking, setTracking] = useState<Tracking | null>(null), [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    request<Tracking | null>(`/api/admin/missions/${mission.missionId}/tracking`, { signal: controller.signal })
      .then(row => { if (!controller.signal.aborted) { setTracking(row); setLoaded(true); } })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Tracking could not be loaded."); });
    return () => controller.abort();
  }, [mission.missionId, mission.updatedAt, open]);
  return <section className="cz-inset space-y-3 p-4" aria-label="Mission tracking">
    <h3 className="cz-display text-lg">Tracking and collectible</h3>
    <button type="button" className="cz-btn" disabled={busy} onClick={() => setOpen(value => !value)}>{open ? "Close tracking" : "Inspect tracking"}</button>
    <p>Distinct dates use UTC. Eligible mission IDs must reference different, nonaggregate Daily or Weekly missions. First-ever actions exclude prior ownership, submissions and approvals.</p>
    {error && <p role="alert">{error}</p>}
    {open && loaded && <form key={JSON.stringify(tracking)} className="space-y-3" onSubmit={event => {
      event.preventDefault(); if (busy || mission.active || !mission.rule) return; const form = new FormData(event.currentTarget);
      const mode = String(form.get("mode")) as Tracking["mode"];
      const ids = String(form.get("eligible") ?? "").split(/[\s,]+/).filter(Boolean);
      const collectibleId = String(form.get("collectible") ?? "").trim() || null;
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (ids.some(id => !uuid.test(id)) || (collectibleId && !uuid.test(collectibleId))) { setError("Use valid catalog and mission UUIDs."); return; }
      setError(""); onSave({ mode, firstEver: form.get("firstEver") === "on", eligibleMissionIds: ids, collectibleId, expectedUpdatedAt: mission.updatedAt });
    }}><fieldset disabled={busy || mission.active || !mission.rule} className="space-y-3">
      <label className="block">Counting method <select className="cz-input" name="mode" defaultValue={tracking?.mode ?? "EVENT_COUNT"}><option value="EVENT_COUNT">Unique recorded events</option><option value="DISTINCT_UTC_DAYS">Distinct UTC dates</option><option value="DISTINCT_MISSIONS">Distinct eligible mission definitions</option></select></label>
      <label className="block"><input type="checkbox" name="firstEver" defaultChecked={tracking?.firstEver ?? false} /> First-ever action (lifetime, target 1 only)</label>
      <label className="block">Eligible mission IDs <textarea className="cz-input" name="eligible" defaultValue={tracking?.eligibleMissionIds.join("\n") ?? ""} /></label>
      <label className="block">Collectible catalog ID (optional lifetime badge/frame) <input className="cz-input" name="collectible" defaultValue={tracking?.collectibleId ?? ""} /></label>
      <button className="cz-btn" type="submit">Save inactive tracking</button>
    </fieldset></form>}
  </section>;
}
