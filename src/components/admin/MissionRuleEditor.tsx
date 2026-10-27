"use client";
import { useEffect, useState } from "react";
import { request } from "@/lib/apiClient";
import type { AdminMissionDto, AdminMissionRuleInput, AdminMissionRuleOptions } from "@/types/adminMissions";

export function MissionRuleEditor({ mission, busy, onSave }: { mission: AdminMissionDto; busy: boolean; onSave: (input: AdminMissionRuleInput) => void }) {
  const [open, setOpen] = useState(false), [options, setOptions] = useState<AdminMissionRuleOptions | null>(null);
  const [eventType, setEventType] = useState(mission.rule?.eventType ?? "");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    request<AdminMissionRuleOptions>("/api/admin/missions/rule-options", { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setOptions(result); setLoadError(""); } })
      .catch(error => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Rule options could not be loaded."); });
    return () => controller.abort();
  }, [open]);
  const option = options?.options.find(option => option.eventType === eventType);
  const unsupported = !!mission.rule && (!!Object.keys(mission.rule.conditions).length || (!!options && (!options.options.some(option => option.eventType === mission.rule?.eventType && (!mission.rule.sourceType || option.sourceType === mission.rule.sourceType)))));
  return <section className="cz-inset space-y-3 p-4" aria-label="Rule configuration">
    <button className="cz-btn" type="button" disabled={busy || mission.active} onClick={() => setOpen(value => !value)}>{open ? "Close rule editor" : "Configure rule"}</button>
    <p>Rule configuration is available only while the mission is inactive. Saving cannot activate it or configure rewards.</p>
    {open && (loadError ? <p role="alert">{loadError}</p> : !options ? <p role="status">Loading supported rules...</p> : unsupported ? <p>This existing rule uses parameters outside this builder. It remains read-only; its configuration will not be overwritten.</p> : <form aria-label="Configure mission rule" className="space-y-3" onSubmit={event => {
      event.preventDefault(); setError("");
      if (busy || mission.active || !option) return;
      const form = new FormData(event.currentTarget);
      const targetCount = Number(form.get("targetCount"));
      const level = String(form.get("levelId") ?? "").trim();
      const levelId = level ? Number(level) : null;
      const puzzleId = String(form.get("puzzleId") ?? "").trim() || null;
      if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 2147483647 || (levelId !== null && (!Number.isFinite(levelId) || levelId <= 0 || levelId > 999.9 || Math.abs(levelId * 10 - Math.round(levelId * 10)) > Number.EPSILON * 10)) || (puzzleId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(puzzleId))) {
        setError("Enter a positive whole event count, a valid optional CircZles ID and a positive level with at most one decimal place."); return;
      }
      onSave({ eventType, targetCount, sourceType: form.get("filterSource") === "on" ? option.sourceType : null, puzzleId, levelId, conditions: {}, active: form.get("active") === "on", expectedUpdatedAt: mission.updatedAt });
    }}>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy || mission.active} className="space-y-3">
        <legend className="cz-display text-lg">Matching event rule</legend>
        <label className="block">Event<select name="eventType" className="cz-inset ml-3 p-2" required value={eventType} onChange={event => setEventType(event.target.value)}><option value="" disabled>Choose an event</option>{options.options.map(option => <option value={option.eventType} key={option.eventType}>{option.label}</option>)}</select></label>
        <label className="block">Number of matching events<input className="cz-inset ml-3 p-2" name="targetCount" type="number" min={1} max={2147483647} step={1} required defaultValue={mission.rule?.targetCount ?? 1} /></label>
        <p>Each matching event adds one. This does not sum XP, points or time, or count distinct CircZles. Rejected and resubmission events follow their existing review semantics.</p>
        <label className="block">Canonical CircZles ID (optional)<input className="cz-inset block w-full p-2" name="puzzleId" defaultValue={mission.rule?.puzzleId ?? ""} maxLength={36} pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" /></label>
        <label className="block">Exact level (optional)<input className="cz-inset ml-3 p-2" name="levelId" type="number" min={0.1} max={999.9} step={0.1} defaultValue={mission.rule?.levelId ?? ""} /></label>
        <label className="block"><input name="filterSource" type="checkbox" defaultChecked={!!mission.rule?.sourceType} /> Restrict to this event&apos;s source{option ? ` (${option.sourceType})` : ""}</label>
        <label className="block"><input name="active" type="checkbox" defaultChecked={mission.rule?.active ?? false} /> Enable this rule for future mission activation</label>
        <p>The mission stays inactive. Advanced equality conditions and other M1 event types are read-only in this slice.</p>
        <button className="cz-btn" type="submit" disabled={!option}>Save rule configuration</button>
      </fieldset>
    </form>)}
  </section>;
}
