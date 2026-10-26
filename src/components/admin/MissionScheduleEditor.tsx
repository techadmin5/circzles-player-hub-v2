"use client";
import { useState } from "react";
import type { AdminMissionDto, AdminMissionScheduleInput } from "@/types/adminMissions";

function utcInput(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const date = new Date(text);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text) || text.startsWith("0000-") || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== text.slice(0, 19)) throw new Error("Use real ISO UTC dates ending in Z, with seconds and at most three fractional digits. Local times and UTC offsets are not accepted.");
  return date.toISOString();
}

export function MissionScheduleEditor({ mission, busy, onSave }: { mission: AdminMissionDto; busy: boolean; onSave: (input: AdminMissionScheduleInput) => void }) {
  const [open, setOpen] = useState(false), [error, setError] = useState("");
  const recurring = mission.periodType === "DAILY" || mission.periodType === "WEEKLY";
  const fixed = mission.periodType === "FIXED";
  return <section className="cz-inset space-y-3 p-4" aria-label="Mission scheduling">
    <button className="cz-btn" type="button" disabled={busy || mission.active} onClick={() => setOpen(value => !value)}>{open ? "Close schedule editor" : "Configure schedule"}</button>
    <p>All dates use UTC. A configured future start never activates a mission automatically; the definition stays inactive.</p>
    {open && <form aria-label="Configure mission schedule" className="space-y-3" onSubmit={event => {
      event.preventDefault(); setError("");
      if (busy || mission.active) return;
      try {
        const data = new FormData(event.currentTarget);
        const startsAt = utcInput(data.get("startsAt")), endsAt = utcInput(data.get("endsAt")), claimDeadline = recurring ? null : utcInput(data.get("claimDeadline"));
        if (fixed && (!startsAt || !endsAt)) throw new Error("Fixed campaigns require both availability start and end in UTC.");
        if (startsAt && endsAt && endsAt <= startsAt) throw new Error("Availability end must be after start.");
        if (endsAt && new Date(endsAt).getTime() <= new Date(mission.activationEffectiveAt).getTime()) throw new Error("Availability must end after the existing event cutoff.");
        if (claimDeadline && endsAt && claimDeadline < endsAt) throw new Error("The explicit claim deadline cannot be before availability end.");
        const earliest = Math.max(new Date(mission.activationEffectiveAt).getTime(), startsAt ? new Date(startsAt).getTime() : -Infinity);
        if (claimDeadline && new Date(claimDeadline).getTime() <= earliest) throw new Error("The claim deadline must be after the earliest eligible event time.");
        onSave({ startsAt, endsAt, claimDeadline, expectedUpdatedAt: mission.updatedAt });
      } catch (error) { setError(error instanceof Error ? error.message : "Invalid mission schedule."); }
    }}>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy || mission.active} className="space-y-3">
        <legend className="cz-display text-lg">Inactive mission schedule (UTC)</legend>
        <p>Availability includes the start and excludes the end. Use YYYY-MM-DDTHH:mm:ss.sssZ; optional blank fields mean no limit.</p>
        <label className="block">Availability start (UTC){fixed ? " - required" : " - optional"}<input className="cz-inset block w-full p-2" name="startsAt" type="text" autoComplete="off" spellCheck={false} maxLength={24} required={fixed} placeholder="2030-02-10T00:00:00.000Z" defaultValue={mission.startsAt ?? ""} /></label>
        <label className="block">Availability end (UTC){fixed ? " - required" : " - optional"}<input className="cz-inset block w-full p-2" name="endsAt" type="text" autoComplete="off" spellCheck={false} maxLength={24} required={fixed} placeholder="2030-02-11T00:00:00.000Z" defaultValue={mission.endsAt ?? ""} /></label>
        <p>Existing event cutoff (read-only): {mission.activationEffectiveAt}. This is an event eligibility cutoff, not an automatic activation time.</p>
        <p>{mission.periodType === "DAILY" ? "Period boundaries: midnight UTC to the next midnight UTC." : mission.periodType === "WEEKLY" ? "Period boundaries: ISO weeks, Monday 00:00 UTC to the following Monday 00:00 UTC." : fixed ? "One fixed period uses the required availability window." : "One lifetime period; availability dates are optional."} Availability does not shift daily or weekly period boundaries.</p>
        <label className="block">Explicit reward claim deadline (UTC) - optional<input className="cz-inset block w-full p-2" name="claimDeadline" type="text" autoComplete="off" spellCheck={false} maxLength={24} disabled={recurring} placeholder={recurring ? "Derived per UTC period" : "Blank means no explicit claim expiry"} defaultValue={mission.claimDeadline ?? ""} /></label>
        <p>{recurring ? "Daily/weekly rewards expire 24 hours after their UTC period ends. An explicit deadline is not supported; saving leaves it empty." : "Fixed/lifetime rewards use the optional explicit claim deadline, with no automatic 24-hour grace. A deadline equal to availability end is allowed."} Claims expire at the deadline itself. Existing earned snapshots keep their recorded deadlines.</p>
        <p>Chest grace is separate: daily/weekly chest claims use 24 hours after their own period end. This form does not change chests, eligibility or earned chest deadlines.</p>
        <button className="cz-btn" type="submit">Save inactive schedule</button>
      </fieldset>
    </form>}
  </section>;
}
