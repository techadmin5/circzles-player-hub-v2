import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act,createElement } from "react";
import { createRoot } from "react-dom/client";
process.env.NEXT_PUBLIC_DATA_MODE="api";process.env.NEXT_PUBLIC_API_BASE_URL="https://hub.example.test";
const {MissionChests}=await import("./MissionChests.tsx");
const {ChestAdmin}=await import("../admin/ChestAdmin.tsx");
const {usePlayerUiState}=await import("../../stores/playerUiState.ts");
const chest={chestId:"10000000-0000-4000-8000-000000000001",title:"Synthetic Daily",periodType:"DAILY",periodKey:"2030-01-07",progress:{current:3,target:3},periodStartsAt:"2030-01-07T00:00:00Z",periodEndsAt:"2030-01-08T00:00:00Z",claimDeadline:"2030-01-09T00:00:00Z",status:"CLAIMABLE",claimable:true,rewards:{version:1,rewards:[{type:"XP",amount:1},{type:"SYNAPSE_POINTS",amount:1}]},missions:[{missionId:"a",title:"Synthetic mission",completed:true}],capacityException:null};
async function setup(t){
 const dom=new JSDOM('<div id="root"></div>',{url:"https://hub.example.test/missions"});
 const keys=["window","self","document","HTMLElement","FormData","IS_REACT_ACT_ENVIRONMENT"],saved=keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]);
 for(const k of keys)Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:k==="IS_REACT_ACT_ENVIRONMENT"?true:dom.window[k]});
 usePlayerUiState.getState().clear();usePlayerUiState.setState({player:{internalId:"synthetic-player",displayName:"Synthetic"}});const root=createRoot(document.getElementById("root"));
 t.after(async()=>{await act(async()=>root.unmount());usePlayerUiState.getState().clear();dom.window.close();for(const[k,d]of saved){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}});
 return root;
}
async function click(text){const button=[...document.querySelectorAll("button")].find(b=>b.textContent===text);assert.ok(button,text);await act(async()=>button.click());}
test("Daily/Weekly cards show unique progress, exact rewards, UTC resets and manual claims without automatic payout",async t=>{
 const root=await setup(t),calls=[];t.mock.method(globalThis,"fetch",async(url,init)=>{calls.push([url,init]);return Response.json(String(url).includes("history")?{entries:[],nextCursor:null}:{chests:[chest,{...chest,chestId:"weekly",periodType:"WEEKLY",title:"Synthetic Weekly",progress:{current:2,target:4},status:"IN_PROGRESS",claimable:false}]});});
 await act(async()=>root.render(createElement(MissionChests,{mode:"api"})));
 assert.match(document.body.textContent,/3 \/ 3 unique/);assert.match(document.body.textContent,/2 \/ 4 unique/);assert.match(document.body.textContent,/1 XP \/ 1 SP/);assert.match(document.body.textContent,/Monday 00:00 UTC/);assert.match(document.body.textContent,/2030-01-09T00:00:00Z/);
 assert.ok(calls.every(([,i])=>!i.method));assert.equal([...document.querySelectorAll("button")].filter(b=>b.textContent.startsWith("Claim ")).length,1);
});
test("capacity and expired history preserves visibility without internal notes or claim controls",async t=>{
 const root=await setup(t);t.mock.method(globalThis,"fetch",async url=>Response.json(String(url).includes("history")?{entries:["CAPACITY_PENDING","CAPACITY_BLOCKED","RECOVERED","EXPIRED","CLAIMED"].map((status,n)=>({...chest,chestId:String(n),status,claimable:false,reason:"PRIVATE_ADMIN_NOTE"})),nextCursor:null}:{chests:[]}));
 await act(async()=>root.render(createElement(MissionChests,{mode:"api"})));assert.match(document.body.textContent,/original entitlement is retained/);assert.match(document.body.textContent,/Paid through explicitly authorized recovery/);assert.doesNotMatch(document.body.textContent,/PRIVATE_ADMIN_NOTE/);assert.equal([...document.querySelectorAll("button")].some(b=>b.textContent.startsWith("Claim ")),false);
});
test("legacy history without frozen rewards reports missing evidence rather than inventing amounts",async t=>{
 const root=await setup(t);t.mock.method(globalThis,"fetch",async url=>Response.json(String(url).includes("history")?{entries:[{...chest,rewards:null,status:"IN_PROGRESS"}],nextCursor:null}:{chests:[]}));await act(async()=>root.render(createElement(MissionChests,{mode:"api"})));assert.match(document.body.textContent,/Historical reward amounts not recorded/);assert.doesNotMatch(document.body.textContent,/0 XP/);
});
test("manual claim retries reuse the entitlement key, then refresh cards/history without duplicating requests",async t=>{
 const root=await setup(t),writes=[];let paid=false;
 t.mock.method(globalThis,"fetch",async(url,init={})=>{
  if(init.method==="POST"){writes.push([url,init]);if(writes.length===1)return Response.json({code:"NETWORK_RETRY",message:"Retry synthetic claim"},{status:503});paid=true;return Response.json({status:"CLAIMED"});}
  if(String(url).endsWith("/api/me"))return Response.json({internalId:"synthetic-player",publicPlayerId:"CZ-1",displayName:"Synthetic",synapsePoints:1,totalXp:1});
  return Response.json(String(url).includes("history")?{entries:[],nextCursor:null}:{chests:[{...chest,status:paid?"CLAIMED":"CLAIMABLE",claimable:!paid}]});
 });await act(async()=>root.render(createElement(MissionChests,{mode:"api"})));await click("Claim daily chest");await click("Claim daily chest");assert.equal(writes.length,2);assert.equal(writes[0][1].headers["Idempotency-Key"],writes[1][1].headers["Idempotency-Key"]);assert.match(document.body.textContent,/Chest reward claimed/);assert.equal(document.body.textContent.includes("Claim daily chest"),false);
});
test("history cursor uses authenticated no-store GET and appends older periods",async t=>{
 const root=await setup(t),urls=[];t.mock.method(globalThis,"fetch",async(url,init)=>{urls.push([url,init]);return Response.json(String(url).includes("history")?{entries:[{...chest,periodKey:String(url).includes("cursor")?"older":"current"}],nextCursor:String(url).includes("cursor")?null:"opaque"}:{chests:[]});});await act(async()=>root.render(createElement(MissionChests,{mode:"api"})));await click("Load older chest history");assert.equal(document.querySelectorAll("article").length,2);const [,init]=urls.find(([u])=>String(u).includes("cursor=opaque"));assert.equal(init.credentials,"include");assert.equal(init.cache,"no-store");
});
test("API failures are visible and mock mode never requests or invents rewards",async t=>{
 const root=await setup(t);let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({code:"UNAUTHENTICATED",message:"Sign in"},{status:401});});await act(async()=>root.render(createElement(MissionChests,{mode:"api"})));assert.match(document.body.textContent,/Sign in/);await act(async()=>root.render(createElement(MissionChests,{mode:"mock"})));const previous=calls;await act(async()=>Promise.resolve());assert.equal(calls,previous);assert.match(document.body.textContent,/signed-in accounts/);
});
test("admin chest draft creation has no default rewards or implicit approval and uses an inactive create contract",async t=>{
 const root=await setup(t),writes=[];const draft={...chest,active:false,revision:"2030-01-07T00:00:00Z",configurationDigest:"a".repeat(64),targetCount:3,rewards:null,missions:[],approvals:["PRODUCT","REWARD_BUDGET"].map(category=>({category,eventId:null,status:"MISSING"})),blockers:["CHEST_APPROVALS_REQUIRED"],activationReady:false,activationEffectiveAt:"2030-01-07T00:00:00Z",startsAt:null,endsAt:null};
 t.mock.method(globalThis,"fetch",async(url,init={})=>{if(init.method==="POST"){writes.push(JSON.parse(init.body));return Response.json(draft);}return Response.json(String(url).includes("/history")?{entries:[],hasMore:false}:String(url).includes("/api/admin/missions?")?{missions:[],hasMore:false}:{chests:[],hasMore:false});});await act(async()=>root.render(createElement(ChestAdmin)));
 await act(async()=>{const input=document.querySelector('input[name="title"]');Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set.call(input,"Synthetic draft");document.querySelector('form[aria-label="Create chest draft"]').dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true}));});
 assert.deepEqual(writes,[{title:"Synthetic draft",periodType:"DAILY"}]);assert.match(document.body.textContent,/Storage bounds are not a budget approval/);assert.equal(document.querySelector('input[name="xp"]').value,"");assert.equal([...document.querySelectorAll("button")].find(b=>b.textContent==="Review chest activation").disabled,true);
});
for(const [periodType,xp,sp]of [["DAILY",50,100],["WEEKLY",200,250]])test(`${periodType} approved product template is explicit, saves exact amounts inactive and records no approvals`,async t=>{
 const root=await setup(t),writes=[];
 const draft={...chest,periodType,active:false,revision:"2030-01-07T00:00:00Z",configurationDigest:"a".repeat(64),targetCount:periodType==="DAILY"?3:4,rewards:null,missions:[],approvals:["PRODUCT","REWARD_BUDGET"].map(category=>({category,eventId:null,status:"MISSING"})),blockers:["CHEST_APPROVALS_REQUIRED"],activationReady:false,activationEffectiveAt:"2030-01-07T00:00:00Z",startsAt:null,endsAt:null};
 const policy={version:"initial-release-2026-10-24",approvedOn:"2026-10-24",scope:"PRODUCT_TEMPLATE_ONLY",periods:{DAILY:{xp:50,synapsePoints:100},WEEKLY:{xp:200,synapsePoints:250}}};
 t.mock.method(globalThis,"fetch",async(url,init={})=>{
  const path=new URL(url).pathname;
  if(init.method==="PATCH"){writes.push(JSON.parse(init.body));return Response.json({...draft,revision:"2030-01-07T00:00:01Z",rewards:{version:1,rewards:[{type:"XP",amount:xp},{type:"SYNAPSE_POINTS",amount:sp}]}});}
  if(init.method==="POST")throw Error("Template must not approve or activate");
  return Response.json(path.endsWith("/product-policy")?policy:path.endsWith("/history")?{entries:[],hasMore:false}:path==="/api/admin/missions"?{missions:[],hasMore:false}:path.endsWith(draft.chestId)?draft:{chests:[draft],hasMore:false});
 });
 await act(async()=>root.render(createElement(ChestAdmin)));await click("View chest Synthetic Daily");
 assert.equal(document.querySelector('input[name="xp"]').value,"");assert.equal(document.querySelector('input[name="sp"]').value,"");assert.equal(writes.length,0);
 await click("Use approved initial-release reward template");assert.equal(document.querySelector('input[name="xp"]').value,String(xp));assert.equal(document.querySelector('input[name="sp"]').value,String(sp));assert.equal(writes.length,0);
 await act(async()=>document.querySelector('form[aria-label="Chest configuration"]').dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true})));
 assert.equal(writes.length,1);assert.equal(writes[0].xp,xp);assert.equal(writes[0].synapsePoints,sp);assert.equal(writes[0].expectedUpdatedAt,draft.revision);assert.ok(!("active"in writes[0]));
 assert.match(document.body.textContent,/PRODUCT approval: MISSING/);assert.equal([...document.querySelectorAll("button")].find(b=>b.textContent==="Review chest activation").disabled,true);
});
