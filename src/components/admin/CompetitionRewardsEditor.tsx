"use client";
import { useEffect, useRef, useState } from "react";
import { catalogAdmin, type CatalogDetail, type CompetitionSettings } from "@/lib/catalogAdmin";
import { parseCatalogTime } from "@/lib/catalogTiming";
const inputClass = "mt-1 min-h-11 w-full rounded-lg border border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] p-2";
export function CompetitionRewardsEditor({ detail, onSaved }: { detail: CatalogDetail; onSaved: () => Promise<void> }) {
  const [settings, setSettings] = useState<CompetitionSettings | null>(null), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const operation = useRef(false);
  const playable = detail.productType === "CIRCZLES" && !!detail.puzzleId && detail.status === "ACTIVE";
  useEffect(() => {
    if (!playable) return;
    const controller = new AbortController();
    catalogAdmin.competition(detail.catalogVariantId, controller.signal).then(value => { if (!controller.signal.aborted) { setSettings(value); setLoaded(true); } }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [detail.catalogVariantId, playable]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (operation.current || !loaded) return;
    const data = new FormData(event.currentTarget);
    operation.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const integer = (key: string) => { const raw = String(data.get(key) ?? ""); if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > 2147483647) throw new Error("Display order and reward amounts must be nonnegative whole numbers."); return Number(raw); };
      const minutes = String(data.get("timeMinutes") ?? ""), seconds = String(data.get("timeSeconds") ?? "");
      const oldMinutes = value.maxLeaderboardTimeMs == null ? "" : String(Math.floor(value.maxLeaderboardTimeMs / 60000));
      const oldSeconds = value.maxLeaderboardTimeMs == null ? "" : String(Math.floor(value.maxLeaderboardTimeMs / 1000) % 60);
      const body = { active: data.has("active"), leaderboardEnabled: data.has("leaderboardEnabled"), category: data.get("category") as CompetitionSettings["category"], displayOrder: integer("displayOrder"),
        rewardEnabled: data.has("rewardEnabled"), xpReward: integer("xpReward"), synapseReward: integer("synapseReward"),
        ...(minutes !== oldMinutes || seconds !== oldSeconds ? { maxLeaderboardTimeMs: parseCatalogTime(minutes, seconds) } : {}) };
      const saved = await catalogAdmin.saveCompetition(detail.catalogVariantId, body);
      setSettings(saved); await onSaved(); setNotice("Competition and completion rewards saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Settings could not be saved."); }
    finally { operation.current = false; setBusy(false); }
  }
  const value = settings ?? { active: false, leaderboardEnabled: false, category: "MAIN_LEVEL", displayOrder: 0, rewardEnabled: false, xpReward: 0, synapseReward: 0, maxLeaderboardTimeMs: detail.maxLeaderboardTimeMs };
  return <section className="space-y-3"><h3 className="cz-display text-xl">Competition &amp; Completion Rewards</h3>
    <p className="text-sm">XP and Synapse Points are awarded only on the player&apos;s first approved completion of this playable CircZles, when rewards are enabled.</p>
    <p className="text-sm">Settings apply to the canonical playable CircZles and all its manufacturing batches. Saving amounts does not grant rewards or change past transactions.</p>
    {!playable ? <p>Activate a complete playable CircZles to configure competition and rewards. Accessories, archived entries and incomplete drafts are excluded.</p> : <>
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{!loaded ? <p role="status">{error ? "Reopen this entry to retry loading settings." : "Loading competition settings..."}</p> :
      <form onSubmit={save} key={JSON.stringify(value)} className="grid gap-3 sm:grid-cols-2" aria-label="Competition and completion rewards">
        <fieldset disabled={busy} className="contents"><label><input type="checkbox" name="active" defaultChecked={value.active} /> Competition active</label><label><input type="checkbox" name="leaderboardEnabled" defaultChecked={value.leaderboardEnabled} /> Leaderboard enabled</label>
          <label>Leaderboard category<select className={inputClass} name="category" defaultValue={value.category}><option value="MAIN_LEVEL">Main Level</option><option value="SIDE_QUEST">Side Quest</option></select></label>
          <label>Leaderboard display order<input name="displayOrder" className={inputClass} type="number" min="0" step="1" required defaultValue={value.displayOrder} /></label>
          <p className="sm:col-span-2">Maximum eligible completion time applies to reported solve time. Recording length is checked manually by a reviewer.</p>
          <label>Minutes<input className={inputClass} name="timeMinutes" type="number" min="0" step="1" defaultValue={value.maxLeaderboardTimeMs == null ? "" : Math.floor(value.maxLeaderboardTimeMs / 60000)} /></label>
          <label>Seconds<input className={inputClass} name="timeSeconds" type="number" min="0" max="59" step="1" defaultValue={value.maxLeaderboardTimeMs == null ? "" : Math.floor(value.maxLeaderboardTimeMs / 1000) % 60} /></label>
          <button type="button" className="cz-btn" onClick={event => { const form = event.currentTarget.form!; (form.elements.namedItem("timeMinutes") as HTMLInputElement).value = ""; (form.elements.namedItem("timeSeconds") as HTMLInputElement).value = ""; }}>Clear / Not configured</button>
          <label className="sm:col-span-2"><input type="checkbox" name="rewardEnabled" defaultChecked={value.rewardEnabled} /> First-approved-completion rewards enabled</label>
          <label>Synapse Points reward<input className={inputClass} name="synapseReward" type="number" min="0" step="1" required defaultValue={value.synapseReward} /></label>
          <label>XP reward<input className={inputClass} name="xpReward" type="number" min="0" step="1" required defaultValue={value.xpReward} /></label>
          <p className="text-sm sm:col-span-2">Inactive competition hides its leaderboard and disables completion rewards. Active leaderboards or rewards require a configured positive maximum.</p>
          <button className="cz-btn cz-btn-primary" disabled={busy}>{busy ? "Saving settings..." : "Save Competition & Rewards"}</button>
        </fieldset>
      </form>}
    </>}
  </section>;
}
