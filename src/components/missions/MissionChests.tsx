"use client";
import { useEffect, useRef, useState } from "react";
import { apiClient, request } from "@/lib/apiClient";
import { ProgressBar } from "@/components/ui/kit";
import { usePlayerUiState } from "@/stores/playerUiState";
import type { DataMode } from "@/config/dataMode";
import { chestTotals, type PlayerChest, type ChestHistory } from "@/types/missionChests";

const explanations: Record<string,string> = { IN_PROGRESS:"Complete unique eligible missions to unlock this chest.", CLAIMABLE:"Unlocked. Claim manually before the UTC deadline.", CLAIMED:"Paid. No further claim is needed.", EXPIRED:"Original deadline passed; no ordinary claim is available.", CAPACITY_PENDING:"Your on-time claim is saved. Administrator recovery is required; no payout yet.", CAPACITY_BLOCKED:"Recovery remains blocked by capacity. Your original entitlement is retained for administrator review.", RECOVERED:"Paid through explicitly authorized recovery.", PERIOD_RESERVED:"A chest reward or recorded capacity exception already occupies this Daily/Weekly period." };
export function MissionChests({mode}:{mode:DataMode}) {
  const owner=usePlayerUiState(s=>`${s.sessionVersion}:${s.player?.internalId??"session"}`);
  return <ChestFeed key={`${mode}:${owner}`} mode={mode}/>;
}
function ChestFeed({mode}:{mode:DataMode}){
  const [rows,setRows]=useState<PlayerChest[]>([]),[history,setHistory]=useState<ChestHistory|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(true),[generation,setGeneration]=useState(0);
  const keys=useRef(new Map<string,string>()),pending=useRef(false),mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    if(mode!=="api")return;
    const c=new AbortController();
    Promise.all([request<{chests:PlayerChest[]}>("/api/mission-chests",{signal:c.signal,cache:"no-store"}),request<ChestHistory>("/api/mission-chests/history",{signal:c.signal,cache:"no-store"})]).then(([a,b])=>{if(!c.signal.aborted){setRows(a.chests);setHistory(b);}}).catch(e=>{if(!c.signal.aborted)setError(e instanceof Error?e.message:"Could not load chests.");}).finally(()=>{if(!c.signal.aborted)setBusy(false);});
    return()=>c.abort();
  },[generation,mode]);
  async function claim(row:PlayerChest){
    if(pending.current)return;pending.current=true;setBusy(true);setError("");setNotice("");
    const id=`${row.chestId}:${row.periodKey}`,key=keys.current.get(id)??crypto.randomUUID();keys.current.set(id,key);
    try{await apiClient.claimChest(row.chestId,row.periodKey,key);if(mounted.current)setNotice("Chest reward claimed. Player balances refreshed.");}
    catch(e){if(mounted.current)setError(e instanceof Error?e.message:"Claim failed. Refresh before retrying with the same claim key.");}
    finally{pending.current=false;if(mounted.current){setBusy(true);setGeneration(n=>n+1);}}
  }
  async function more(){
    if(pending.current||!history?.nextCursor)return;pending.current=true;setBusy(true);
    try{const p=await request<ChestHistory>(`/api/mission-chests/history?cursor=${encodeURIComponent(history.nextCursor)}`,{cache:"no-store"});if(mounted.current)setHistory(h=>h?{entries:[...h.entries,...p.entries],nextCursor:p.nextCursor}:p);}
    catch(e){if(mounted.current)setError(e instanceof Error?e.message:"History unavailable.");}finally{pending.current=false;if(mounted.current)setBusy(false);}
  }
  return <section aria-label="Daily and Weekly chests" className="mt-8 grid gap-4">
    <h2 className="cz-display text-2xl">Daily and Weekly Chests</h2>
    <p>Daily: complete any 3 of 5 unique missions. Weekly: any 4 of 6. Completion counts; individual reward claims do not. Daily reset 00:00 UTC; weekly reset Monday 00:00 UTC. Manual claims have 24 hours after period end.</p>
    {mode!=="api"?<p>Chests are available for signed-in accounts in API mode.</p>:<>
      <button className="cz-btn" disabled={busy} onClick={()=>{setBusy(true);setError("");setGeneration(n=>n+1);}}>Refresh chests</button>
      {busy&&<p role="status">Loading chests...</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
      {!busy&&!rows.length&&<p>No active or claimable chests are available.</p>}
      <div className="grid gap-4 md:grid-cols-2">{rows.map(row=><ChestCard key={`${row.chestId}:${row.periodKey}`} row={row} busy={busy} claim={()=>void claim(row)}/>)}</div>
      <h3 className="cz-display text-xl">Chest History</h3><p>Names and eligible mission labels reflect current definitions. Historical rewards are shown only when frozen evidence exists. All times are UTC.</p>
      {history&&!history.entries.length&&<p>No recorded chest periods.</p>}
      {history?.entries.map(row=><ChestCard key={`${row.chestId}:${row.periodKey}`} row={row} busy={busy}/>)}
      {history?.nextCursor&&<button className="cz-btn" disabled={busy} onClick={()=>void more()}>Load older chest history</button>}
    </>}
  </section>;
}
function ChestCard({row,busy,claim}:{row:PlayerChest;busy:boolean;claim?:()=>void}){
  const totals=chestTotals(row.rewards);
  return <article className="cz-surface space-y-2 p-4" aria-label={`${row.periodType} chest ${row.periodKey}`}>
    <h3 className="cz-display text-lg">{row.title}</h3><p>{row.periodType} · {row.periodKey} · {row.status}</p>
    <p>{row.progress.current} / {row.progress.target} unique missions completed</p><ProgressBar value={row.progress.target?row.progress.current/row.progress.target*100:0}/><p>{totals?`${totals.xp} XP / ${totals.sp} SP`:"Historical reward amounts not recorded"}</p>
    <p>{explanations[row.status]??"Chest status requires review."}</p><p>Period ends: {row.periodEndsAt??"Not recorded"} (UTC). Claim deadline: {row.claimDeadline} (UTC).</p>
    {claim&&<><ul>{row.missions.map(m=><li key={m.missionId}>{m.completed?"✓":"○"} {m.title}</li>)}</ul>{row.claimable&&<button className="cz-btn cz-btn-primary" disabled={busy} onClick={claim}>Claim {row.periodType.toLowerCase()} chest</button>}</>}
  </article>;
}
