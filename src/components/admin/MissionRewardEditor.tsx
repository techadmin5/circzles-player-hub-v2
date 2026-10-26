"use client";
import { useState } from "react";
import type { AdminMissionDto, AdminMissionRewardsInput } from "@/types/adminMissions";

function explicitAmount(data: FormData, field: string): number {
  const text = String(data.get(field) ?? "").trim();
  const amount = Number(text);
  if (!text || !Number.isInteger(amount) || amount < 1 || amount > 2147483647) throw new Error("Enter each selected reward explicitly as a positive whole amount from 1 to 2147483647. Zero is not a reward amount.");
  return amount;
}

export function MissionRewardEditor({ mission, busy, onSave }: { mission: AdminMissionDto; busy: boolean; onSave: (input: AdminMissionRewardsInput) => void }) {
  const [open, setOpen] = useState(false), [includeXp, setIncludeXp] = useState(false), [includeSp, setIncludeSp] = useState(false), [error, setError] = useState("");
  const unsupported = mission.rewards.some(reward => reward.rewardType !== "XP" && reward.rewardType !== "SYNAPSE_POINTS");
  return <section className="cz-inset space-y-3 p-4" aria-label="Mission reward configuration">
    <button className="cz-btn" type="button" disabled={busy || mission.active} onClick={() => { setOpen(value => !value); setIncludeXp(false); setIncludeSp(false); setError(""); }}>{open ? "Close reward editor" : "Configure rewards"}</button>
    <p>Reward configuration is available only while inactive. Saving cannot activate a mission or pay rewards.</p>
    {open && (unsupported ? <p>This definition contains reward types outside this editor and remains read-only. No rewards will be overwritten.</p> : <form aria-label="Configure mission rewards" className="space-y-3" onSubmit={event => {
      event.preventDefault(); setError("");
      if (busy || mission.active) return;
      try {
        if (!includeXp && !includeSp) throw new Error("Choose at least one currency and enter its amount. M1 does not support an empty or all-zero payable reward.");
        const data = new FormData(event.currentTarget);
        onSave({ xp: includeXp ? explicitAmount(data, "xp") : null, synapsePoints: includeSp ? explicitAmount(data, "synapsePoints") : null, expectedUpdatedAt: mission.updatedAt });
      } catch (error) { setError(error instanceof Error ? error.message : "Invalid reward configuration."); }
    }}>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy || mission.active} className="space-y-3">
        <legend className="cz-display text-lg">Inactive mission XP/SP rewards</legend>
        <p>Enter every selected amount for this replacement explicitly. Existing values are shown above; no amounts are copied into this form.</p>
        <label className="block"><input type="checkbox" name="includeXp" checked={includeXp} onChange={event => setIncludeXp(event.target.checked)} /> Include XP</label>
        {includeXp && <label className="block">XP amount<input className="cz-inset ml-3 p-2" type="number" name="xp" required min={1} max={2147483647} step={1} /></label>}
        <label className="block"><input type="checkbox" name="includeSp" checked={includeSp} onChange={event => setIncludeSp(event.target.checked)} /> Include Synapse Points</label>
        {includeSp && <label className="block">Synapse Points amount<input className="cz-inset ml-3 p-2" type="number" name="synapsePoints" required min={1} max={2147483647} step={1} /></label>}
        <p>Each included amount must be a whole number from 1 to 2147483647. Unselected currencies are omitted, not stored as zero. At least one currency is required to save; a new draft may remain unconfigured instead.</p>
        <p>Previously earned reward snapshots and claims keep their original amounts. This form does not change player balances, XP/SP ledgers, chest rewards or inventory rewards.</p>
        <button className="cz-btn" type="submit">Save inactive rewards</button>
      </fieldset>
    </form>)}
  </section>;
}
