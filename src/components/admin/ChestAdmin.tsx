"use client";
import { useEffect, useRef, useState } from "react";
import { request } from "@/lib/apiClient";
import { chestTotals, type AdminChest, type ChestProductPolicy } from "@/types/missionChests";
import type { AdminMissionDto, AdminMissionPage } from "@/types/adminMissions";
import { ChestCapacityPanel } from "./ChestCapacityPanel";

const base="/api/admin/mission-chests";
type Audit={eventId:string;action:string;actorAdminUserId:string;occurredAt:string;before:unknown;after:unknown};
export function ChestAdmin(){
  const [rows,setRows]=useState<AdminChest[]>([]),[detail,setDetail]=useState<AdminChest|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[offset,setOffset]=useState(0),[hasMore,setHasMore]=useState(false),[revision,setRevision]=useState(0);
  const pending=useRef(false),mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{const c=new AbortController();request<{chests:AdminChest[];hasMore:boolean}>(`${base}?limit=25&offset=${offset}`,{signal:c.signal,cache:"no-store"}).then(p=>{if(!c.signal.aborted){setRows(p.chests);setHasMore(p.hasMore);}}).catch(e=>{if(!c.signal.aborted)setError(e instanceof Error?e.message:"Chests unavailable.");});return()=>c.abort();},[offset,revision]);
  async function run(work:()=>Promise<AdminChest>){if(pending.current)return;pending.current=true;setBusy(true);setError("");try{const d=await work();if(mounted.current){setDetail(d);setRevision(n=>n+1);}}catch(e){if(mounted.current)setError(`${e instanceof Error?e.message:"Chest request failed."} Reload details before retrying; a lost response may have committed.`);}finally{pending.current=false;if(mounted.current)setBusy(false);}}
  return <section aria-label="Admin Chests" className="mx-auto max-w-7xl space-y-4 p-6">
    <h2 className="cz-display text-2xl">Daily and Weekly Chest Builder</h2>
    <p>Inactive drafts have no default rewards. Explicit product and exact XP/SP budget approvals are required. The approved initial-release reward template can be applied explicitly; each chest still needs both recorded approvals. All dates use UTC.</p>
    {error&&<p role="alert">{error}</p>}
    <form aria-label="Create chest draft" className="cz-surface space-y-3 p-4" onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void run(()=>request<AdminChest>(base,{method:"POST",body:JSON.stringify({title:data.get("title"),periodType:data.get("periodType")})}));}}>
      <label>Chest title<input className="cz-inset m-2 p-2" name="title" required maxLength={200} disabled={busy}/></label>
      <label>Chest period<select className="cz-inset m-2 p-2" name="periodType" disabled={busy}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option></select></label>
      <button className="cz-btn" disabled={busy}>Create inactive chest</button>
    </form>
    <ul>{rows.map(r=><li key={r.chestId}><button className="cz-btn cz-btn-ghost" disabled={busy} onClick={()=>void run(()=>request(`${base}/${r.chestId}`,{cache:"no-store"}))}>View chest {r.title}</button> {r.periodType} · {r.active?"ACTIVE":"INACTIVE"}</li>)}</ul>
    <div className="flex gap-3"><button className="cz-btn" disabled={busy||!offset} onClick={()=>setOffset(n=>Math.max(0,n-25))}>Previous chests</button><button className="cz-btn" disabled={busy||!hasMore} onClick={()=>setOffset(n=>n+25)}>Next chests</button></div>
    {detail&&<ChestDetail key={`${detail.chestId}:${detail.revision}:${revision}`} row={detail} busy={busy} run={run}/>}
  </section>;
}
function ChestDetail({row,busy:outerBusy,run}:{row:AdminChest;busy:boolean;run:(action:()=>Promise<AdminChest>)=>Promise<void>}){
  const [missions,setMissions]=useState<AdminMissionDto[]>([]),[loadError,setLoadError]=useState(""),[loading,setLoading]=useState(true),[selected,setSelected]=useState(row.missions.map(m=>m.missionId)),[action,setAction]=useState<string|null>(null),[confirmed,setConfirmed]=useState(false),[history,setHistory]=useState<Audit[]>([]),[historyOffset,setHistoryOffset]=useState(0),[historyMore,setHistoryMore]=useState(false);
  const [capacityBusy,setCapacityBusy]=useState(false);const busy=outerBusy||capacityBusy;
  const totals=chestTotals(row.rewards);
  const [policy,setPolicy]=useState<ChestProductPolicy|null>(null),[xp,setXp]=useState(totals?.xp?String(totals.xp):""),[sp,setSp]=useState(totals?.sp?String(totals.sp):"");
  const template=policy?.periods?.[row.periodType as "DAILY"|"WEEKLY"];
  useEffect(()=>{const c=new AbortController();request<ChestProductPolicy>(`${base}/product-policy`,{signal:c.signal,cache:"no-store"}).then(p=>{if(!c.signal.aborted)setPolicy(p);}).catch(()=>{/* Existing explicit editing remains available; never invent a template. */});return()=>c.abort();},[]);
  useEffect(()=>{const c=new AbortController();void(async()=>{const all:AdminMissionDto[]=[];for(let offset=0;;offset+=50){const p=await request<AdminMissionPage>(`/api/admin/missions?limit=50&offset=${offset}`,{signal:c.signal,cache:"no-store"});all.push(...p.missions.filter(m=>m.periodType===row.periodType&&m.category===row.periodType));if(!p.hasMore)break;}if(!c.signal.aborted)setMissions(all);})().catch(e=>{if(!c.signal.aborted)setLoadError(e instanceof Error?e.message:"Eligible missions unavailable.");}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();},[row.periodType]);
  useEffect(()=>{const c=new AbortController();request<{entries:Audit[];hasMore:boolean}>(`${base}/${row.chestId}/history?limit=25&offset=${historyOffset}`,{signal:c.signal,cache:"no-store"}).then(p=>{if(!c.signal.aborted){setHistory(p.entries);setHistoryMore(p.hasMore);}}).catch(e=>{if(!c.signal.aborted)setLoadError(e instanceof Error?e.message:"History unavailable.");});return()=>c.abort();},[row.chestId,historyOffset]);
  function operate(){if(!action||!confirmed)return;const category=action.endsWith("reward-budget")?"REWARD_BUDGET":"PRODUCT",approval=row.approvals.find(a=>a.category===category);void run(()=>request(`${base}/${row.chestId}/${action}`,{method:"POST",body:JSON.stringify({expectedUpdatedAt:row.revision,configurationDigest:row.configurationDigest,operationKey:crypto.randomUUID(),...(action.startsWith("approve")||action.startsWith("revoke")?{expectedApprovalEventId:approval?.eventId??null}:{})})}));}
  return <article aria-label="Chest details" className="cz-surface space-y-4 p-4">
    <h3 className="cz-display text-xl">{row.title}</h3><p>{row.periodType} · {row.active?"ACTIVE":"INACTIVE"} · Revision {row.revision} · Effective {row.activationEffectiveAt} UTC</p>
    <button className="cz-btn" disabled={busy} onClick={()=>void run(()=>request(`${base}/${row.chestId}`,{cache:"no-store"}))}>Reload chest details</button>
    {loadError&&<p role="alert">{loadError}</p>}
    <form aria-label="Chest configuration" onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);const value=(name:string)=>String(d.get(name)??"").trim();void run(()=>request(`${base}/${row.chestId}`,{method:"PATCH",body:JSON.stringify({title:value("title"),missionIds:selected,xp:value("xp")===""?null:Number(value("xp")),synapsePoints:value("sp")===""?null:Number(value("sp")),startsAt:value("startsAt")||null,endsAt:value("endsAt")||null,expectedUpdatedAt:row.revision})}));}}>
      <fieldset disabled={busy||row.active||loading} className="space-y-3">
        <legend>Inactive chest configuration</legend>
        <label className="block">Configured chest title<input className="cz-inset ml-2 p-2" name="title" required maxLength={200} defaultValue={row.title}/></label>
        <p>Select exactly {row.periodType==="DAILY"?5:6} existing active {row.periodType.toLowerCase()} missions; complete any {row.targetCount} unique missions. Unfinished current-period progress locks eligibility, rewards and windows; use a new draft or wait for UTC reset. Title-only edits remain available. Earned entitlements remain.</p>
        {missions.map(m=><label className="block" key={m.missionId}><input type="checkbox" checked={selected.includes(m.missionId)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,m.missionId]:ids.filter(id=>id!==m.missionId))}/>{m.title} ({m.active?"active":"inactive"})</label>)}
        {template&&<div className="cz-inset space-y-2 p-3"><p>Approved initial release ({policy?.approvedOn}): {template.xp} XP / {template.synapsePoints} SP. This product template is not a recorded approval.</p><button type="button" className="cz-btn cz-btn-ghost" onClick={()=>{setXp(String(template.xp));setSp(String(template.synapsePoints));}}>Use approved initial-release reward template</button></div>}
        <label className="block">Chest XP<input className="cz-inset ml-2 p-2" type="number" min={1} max={2147483647} step={1} name="xp" value={xp} onChange={e=>setXp(e.target.value)}/></label>
        <label className="block">Chest SP<input className="cz-inset ml-2 p-2" type="number" min={1} max={2147483647} step={1} name="sp" value={sp} onChange={e=>setSp(e.target.value)}/></label>
        <p>Enter exact amounts explicitly. Blank means no reward of that currency; both blank leaves the draft incomplete. Storage bounds are not a budget approval.</p>
        <label className="block">Chest available from (UTC ISO)<input className="cz-inset ml-2 p-2" name="startsAt" placeholder="YYYY-MM-DDTHH:mm:ssZ" defaultValue={row.startsAt??""}/></label>
        <label className="block">Chest available until (UTC ISO)<input className="cz-inset ml-2 p-2" name="endsAt" placeholder="YYYY-MM-DDTHH:mm:ssZ" defaultValue={row.endsAt??""}/></label>
        <p>Availability does not change UTC period boundaries or the 24-hour post-period claim grace.</p>
        <button className="cz-btn">Save inactive chest configuration</button>
      </fieldset>
    </form>
    <section aria-label="Chest readiness"><h4>Activation readiness</h4><p>{row.activationReady?"PASS — configuration and both approvals current":"BLOCKED or already active"}</p><ul>{row.blockers.map(code=><li key={code}>{code.replaceAll("_"," ")}</li>)}</ul></section>
    {row.approvals.map(a=><div key={a.category}><p>{a.category} approval: {a.status}</p><button className="cz-btn" disabled={busy||row.active||a.status==="APPROVED"} onClick={()=>{setConfirmed(false);setAction(`approve-${a.category.toLowerCase().replaceAll("_","-")}`);}}>Review {a.category} approval</button><button className="cz-btn" disabled={busy||!a.eventId||a.status==="REVOKED"} onClick={()=>{setConfirmed(false);setAction(`revoke-${a.category.toLowerCase().replaceAll("_","-")}`);}}>Review {a.category} revocation</button></div>)}
    <button className="cz-btn" disabled={busy||(!row.active&&!row.activationReady)} onClick={()=>{setConfirmed(false);setAction(row.active?"deactivate":"activate");}}>Review chest {row.active?"deactivation":"activation"}</button>
    {action&&<dialog open aria-label="Confirm chest operation" className="cz-surface fixed inset-0 z-50 m-auto max-w-xl space-y-3 p-6"><h4>Confirm {action}</h4><p>{row.title}: {totals?.xp??0} XP / {totals?.sp??0} SP. Approvals bind this exact configuration. Deactivation preserves earned rewards, original deadlines and history. Activation starts prospective completion tracking.</p><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I explicitly authorize this operation.</label><button className="cz-btn" disabled={busy||!confirmed} onClick={operate}>Confirm chest operation</button><button className="cz-btn" disabled={busy} onClick={()=>setAction(null)}>Cancel chest operation</button></dialog>}
    <ChestCapacityPanel missionId={row.chestId} busy={busy} onBusy={setCapacityBusy}/>
    <h4>Chest administrator history (UTC)</h4><ol>{history.map(e=><li key={e.eventId}>{e.action} · {e.occurredAt} UTC · {e.actorAdminUserId}<details><summary>Before / after</summary><pre className="overflow-x-auto">{JSON.stringify({before:e.before,after:e.after},null,2)}</pre></details></li>)}</ol>
    <button className="cz-btn" disabled={busy||!historyOffset} onClick={()=>setHistoryOffset(n=>Math.max(0,n-25))}>Previous chest history</button><button className="cz-btn" disabled={busy||!historyMore} onClick={()=>setHistoryOffset(n=>n+25)}>Next chest history</button>
  </article>;
}
