import { missionChestProductPolicy } from "../../src/config/missionChestProduct.js";
import { it, expect } from "vitest";
import { eq, sql, inArray } from "drizzle-orm";
import type { Database } from "../../src/db/client.js";
import * as s from "../../src/db/schema.js";
import * as c from "../../src/db/missionChestSchema.js";
import { AdminMissionChestService } from "../../src/domain/adminMissionChests.js";
import { ChestCapacityService } from "../../src/domain/chestCapacityExceptions.js";
import { MissionChestService } from "../../src/domain/missionChests.js";
import { DrizzleMissionRepository } from "../../src/domain/missions.js";
import { AdminMissionService } from "../../src/domain/adminMissions.js";
import { DrizzleGameEventRepository } from "../../src/domain/gameEvents.js";
import { periodKeyFor, periodBounds, freezeRewards } from "../../src/domain/missionLifecycle.js";

export async function chestFixture(db:Database,type:"DAILY"|"WEEKLY"="DAILY",balance=0,totalXp=0,reward={xp:1,synapsePoints:1}){
  // Only invoked on owned synthetic databases created by the guarded test harness.
  await db.update(c.missionChests).set({active:false});await db.update(c.missionChestEligibility).set({active:false});await db.update(s.missions).set({active:false});await db.update(s.gameEvents).set({processedAt:new Date()});
  await db.insert(s.progressionLevels).values({progressionLevel:1,rankName:"Synthetic",xpRequired:0,rewards:[]}).onConflictDoNothing();
  const [user]=await db.insert(s.users).values({verifiedEmail:crypto.randomUUID()+"@test.invalid"}).returning();
  const [player]=await db.insert(s.players).values({userId:user.userId,displayName:"Synthetic chest player"}).returning();
  await db.insert(s.wallets).values({playerId:player.playerId,balance});await db.insert(s.playerProgression).values({playerId:player.playerId,totalXp,progressionLevel:1,rankName:"Synthetic"});
  const [actor]=await db.insert(s.adminUsers).values({userId:user.userId,role:"SUPER_ADMIN"}).returning();
  const ids:string[]=[];
  for(let n=0;n<(type==="DAILY"?5:6);n++){
    const [mission]=await db.insert(s.missions).values({title:`Synthetic ${type} ${n}`,description:"",category:type,periodType:type,active:true,activationEffectiveAt:new Date(0)}).returning();ids.push(mission.missionId);
    await db.insert(s.missionRules).values({missionId:mission.missionId,eventType:"puzzle.added",targetCount:1,conditions:{}});
    await db.insert(s.missionRewards).values({missionId:mission.missionId,rewardType:"XP",amount:1});
  }
  const admin=new AdminMissionChestService(db),claims=new MissionChestService(db),capacity=new ChestCapacityService(db);
  const draft=await admin.create({title:`Synthetic ${type} chest`,periodType:type},actor.adminUserId);
  const configured=await admin.configure(draft.chestId,{title:draft.title,missionIds:ids,...reward,startsAt:null,endsAt:null,expectedUpdatedAt:draft.revision},actor.adminUserId);
  return {db,admin,claims,capacity,actor:actor.adminUserId,playerId:player.playerId,ids,configured};
}
type Fixture=Awaited<ReturnType<typeof chestFixture>>;
export function chestOperation(row:Awaited<ReturnType<AdminMissionChestService["detail"]>>,category?:string){return {expectedUpdatedAt:row.revision,configurationDigest:row.configurationDigest,operationKey:crypto.randomUUID(),...(category?{expectedApprovalEventId:row.approvals.find(a=>a.category===category)!.eventId}:{})};}
export async function activateChest(f:Fixture){
  let d=f.configured;for(const category of ["PRODUCT","REWARD_BUDGET"] as const)d=await f.admin.operate(d.chestId,`APPROVE_${category}`,chestOperation(d,category),f.actor);
  expect(d.activationReady).toBe(true);return f.admin.operate(d.chestId,"ACTIVATE",chestOperation(d),f.actor);
}
export async function earnChest(f:Fixture){
  await new DrizzleGameEventRepository(f.db).append({playerId:f.playerId,eventType:"puzzle.added",sourceType:"SYNTHETIC_CHEST_TEST",sourceId:crypto.randomUUID(),idempotencyKey:crypto.randomUUID(),payload:{}});
  for(let n=0;n<4;n++){if(!await new DrizzleMissionRepository(f.db).processBatch(100))break;}
  const [state]=await f.db.select().from(c.playerMissionChests).where(eq(c.playerMissionChests.playerId,f.playerId));expect(state).toBeDefined();return state;
}
export function chestCases(getDb:()=>Database){
  it.each(["DAILY","WEEKLY"] as const)("approved initial-release %s template pays exact amounts once without changing historical snapshots",async type=>{
    const db=getDb(),historical=await chestFixture(db,type),old=await activateChest(historical),earned=await earnChest(historical);
    const frozen=earned.rewardSnapshot;
    await historical.admin.operate(old.chestId,"DEACTIVATE",chestOperation(old),historical.actor);
    const policy=missionChestProductPolicy.periods[type],f=await chestFixture(db,type,0,0,{xp:policy.xp,synapsePoints:policy.synapsePoints});
    expect(f.configured.active).toBe(false);expect(f.configured.activationReady).toBe(false);expect(f.configured.approvals.every(a=>a.status==="MISSING")).toBe(true);
    const active=await activateChest(f),state=await earnChest(f),input={playerId:f.playerId,chestId:active.chestId,periodKey:state.periodKey,idempotencyKey:crypto.randomUUID()};
    const receipt=await f.claims.claim(input);expect(receipt.awarded).toEqual({xp:type==="DAILY"?50:200,synapsePoints:type==="DAILY"?100:250});
    expect((await f.claims.claim(input)).chestClaimId).toBe(receipt.chestClaimId);
    const [wallet]=await db.select().from(s.wallets).where(eq(s.wallets.playerId,f.playerId));const [progress]=await db.select().from(s.playerProgression).where(eq(s.playerProgression.playerId,f.playerId));expect(wallet.balance).toBe(policy.synapsePoints);expect(progress.totalXp).toBe(policy.xp);
    expect(await db.select().from(s.pointTransactions).where(eq(s.pointTransactions.playerId,f.playerId))).toHaveLength(1);expect(await db.select().from(s.xpTransactions).where(eq(s.xpTransactions.playerId,f.playerId))).toHaveLength(1);
    expect((await db.select().from(c.playerMissionChests).where(eq(c.playerMissionChests.playerChestId,earned.playerChestId)))[0].rewardSnapshot).toEqual(frozen);
    const grace=state.claimDeadline.getTime()-state.periodEndsAt.getTime();expect(grace).toBe(missionChestProductPolicy.claimGraceHours*3600000);
  });
  it.each(["DAILY","WEEKLY"] as const)("%s creation, independent approvals, activation, unique completions, frozen reward, manual claim and deactivation",async type=>{
    const f=await chestFixture(getDb(),type),active=await activateChest(f),state=await earnChest(f);
    expect(state.currentCount).toBe(type==="DAILY"?3:4);expect(state.rewardSnapshot).toEqual(freezeRewards([{rewardType:"XP",amount:1},{rewardType:"SYNAPSE_POINTS",amount:1}]));
    const completions=await f.db.select().from(c.missionChestCompletions).where(eq(c.missionChestCompletions.playerChestId,state.playerChestId));expect(new Set(completions.map(c=>c.missionId)).size).toBe(type==="DAILY"?5:6);
    expect(await f.db.select().from(s.missionClaims).where(eq(s.missionClaims.playerId,f.playerId))).toHaveLength(0);
    const input={playerId:f.playerId,chestId:active.chestId,periodKey:state.periodKey,idempotencyKey:crypto.randomUUID()},paid=await f.claims.claim(input);expect(paid.awarded).toEqual({xp:1,synapsePoints:1});expect((await f.claims.claim(input)).idempotent).toBe(true);
    await expect(f.claims.claim({...input,idempotencyKey:crypto.randomUUID()})).rejects.toMatchObject({code:"CHEST_ALREADY_CLAIMED"});
    await f.admin.operate(active.chestId,"DEACTIVATE",chestOperation(active),f.actor);
    const activation=(await f.admin.history(active.chestId)).entries.find(e=>e.action==="ACTIVATE")!;
    expect((await f.admin.operate(active.chestId,"ACTIVATE",activation.request,f.actor)).active).toBe(false);
    expect((await f.claims.history(f.playerId,{})).entries[0]).toMatchObject({status:"CLAIMED",active:false,rewardSource:"FROZEN"});
    expect((await f.claims.history(crypto.randomUUID(),{})).entries).toEqual([]);
  });
  it("incomplete draft is inactive and reward-free, rejects forged actors and malformed/negative/fractional amounts",async()=>{
    const f=await chestFixture(getDb()),d=await f.admin.create({title:"Incomplete",periodType:"WEEKLY"},f.actor);expect(d).toMatchObject({active:false,rewards:null,activationReady:false});
    await expect(f.admin.operate(d.chestId,"ACTIVATE",chestOperation(d),f.actor)).rejects.toMatchObject({code:"CHEST_ACTIVATION_BLOCKED"});
    await expect(f.admin.create({title:"x",periodType:"DAILY",active:true},f.actor)).rejects.toMatchObject({code:"VALIDATION_FAILED"});
    await expect(f.admin.create({title:"x",periodType:"DAILY"},crypto.randomUUID())).rejects.toMatchObject({statusCode:403});
    for(const xp of [-1,0,1.5,2147483648])await expect(f.admin.configure(d.chestId,{title:d.title,missionIds:[],xp,synapsePoints:null,startsAt:null,endsAt:null,expectedUpdatedAt:d.revision},f.actor)).rejects.toMatchObject({code:"VALIDATION_FAILED"});
  });
  it("revisions invalidate approvals permanently; reverting fields cannot revive them",async()=>{
    const f=await chestFixture(getDb());let d=await f.admin.operate(f.configured.chestId,"APPROVE_PRODUCT",chestOperation(f.configured,"PRODUCT"),f.actor);
    const original=chestOperation(d);d=await f.admin.configure(d.chestId,{title:d.title,missionIds:f.ids,xp:1,synapsePoints:1,startsAt:null,endsAt:null,expectedUpdatedAt:d.revision},f.actor);
    expect(d.approvals.find(a=>a.category==="PRODUCT")?.status).toBe("INVALIDATED");await expect(f.admin.operate(d.chestId,"ACTIVATE",original,f.actor)).rejects.toMatchObject({code:"CHEST_REVISION_CONFLICT"});
  });
  it("active chest configuration is locked and linked missions must not be deactivated first",async()=>{
    const f=await chestFixture(getDb()),active=await activateChest(f),missions=new AdminMissionService(f.db);
    await expect(f.admin.configure(active.chestId,{title:active.title,missionIds:f.ids,xp:1,synapsePoints:1,startsAt:null,endsAt:null,expectedUpdatedAt:active.revision},f.actor)).rejects.toMatchObject({code:"CHEST_CONFIGURATION_LOCKED"});
    const contract=await missions.approvalContract(f.ids[0]);
    await expect(missions.changeLifecycle(f.ids[0],"DEACTIVATE",{expectedUpdatedAt:contract.binding.approvedConfigurationRevision,configurationDigest:contract.binding.configurationDigest,idempotencyKey:crypto.randomUUID()},f.actor)).rejects.toMatchObject({code:"MISSION_ACTIVE_CHEST_DEPENDENCY"});
    await f.admin.operate(active.chestId,"DEACTIVATE",chestOperation(active),f.actor);
    expect((await missions.changeLifecycle(f.ids[0],"DEACTIVATE",{expectedUpdatedAt:contract.binding.approvedConfigurationRevision,configurationDigest:contract.binding.configurationDigest,idempotencyKey:crypto.randomUUID()},f.actor)).active).toBe(false);
  });
  it("inactive edits cannot mix unfinished current-period eligibility/rewards but title-only edits preserve progress",async()=>{
    const f=await chestFixture(getDb());
    // Synthetic rule fixtures: only the first of five completes on the first event.
    await f.db.update(s.missionRules).set({targetCount:2}).where(inArray(s.missionRules.missionId,f.ids.slice(1)));
    const active=await activateChest(f),state=await earnChest(f);expect(state.currentCount).toBe(1);expect(state.unlockedAt).toBeNull();
    const d=await f.admin.operate(active.chestId,"DEACTIVATE",chestOperation(active),f.actor);
    const input={title:d.title,missionIds:f.ids,xp:2,synapsePoints:1,startsAt:null,endsAt:null,expectedUpdatedAt:d.revision};
    await expect(f.admin.configure(d.chestId,input,f.actor)).rejects.toMatchObject({code:"CHEST_CURRENT_PERIOD_CONFIGURATION_LOCKED"});
    await f.admin.configure(d.chestId,{...input,title:"Label only",xp:1},f.actor);
    expect((await f.db.select().from(c.playerMissionChests).where(eq(c.playerMissionChests.playerChestId,state.playerChestId)))[0]).toEqual(state);
  });
  it.each(["SP","XP"])("%s capacity failures use savepoints, reserve original entitlement, recover after deadline only explicitly and never double-pay",async currency=>{
    const f=await chestFixture(getDb(),"DAILY",currency==="SP"?2147483647:0,currency==="XP"?Number.MAX_SAFE_INTEGER:0),active=await activateChest(f);
    // Persist an explicitly synthetic earned historical entitlement. Arrival is
    // injected only into the service, never accepted by the HTTP contract.
    const [state]=await f.db.insert(c.playerMissionChests).values({playerId:f.playerId,chestId:active.chestId,periodKey:"2020-02-10",targetCountSnapshot:3,currentCount:3,unlockedAt:new Date("2020-02-10T11:00:00Z"),periodStartsAt:new Date("2020-02-10Z"),periodEndsAt:new Date("2020-02-11Z"),claimDeadline:new Date("2020-02-12Z"),rewardSnapshot:freezeRewards([{rewardType:"XP",amount:1},{rewardType:"SYNAPSE_POINTS",amount:1}])}).returning();
    const input={playerId:f.playerId,chestId:active.chestId,periodKey:state.periodKey,idempotencyKey:crypto.randomUUID(),arrivedAt:new Date("2020-02-10T12:00:00Z")};await expect(f.claims.claim(input)).rejects.toMatchObject({code:"CHEST_CAPACITY_PENDING"});
    const [head]=await f.db.select().from(c.chestCapacityExceptions).where(eq(c.chestCapacityExceptions.playerId,f.playerId));let exception=await f.capacity.detail(head.exceptionId,f.actor);
    for(const table of [s.pointTransactions,s.xpTransactions,c.missionChestClaims])expect(await f.db.select().from(table).where(eq(table.playerId,f.playerId))).toEqual([]);
    await expect(f.claims.claim({...input,arrivedAt:new Date("2099-01-01Z"),idempotencyKey:crypto.randomUUID()})).rejects.toMatchObject({code:"CHEST_CAPACITY_PENDING"});
    const request=()=>({expectedEventId:exception.revision,digest:exception.digest,reason:"Synthetic explicit recovery",idempotencyKey:crypto.randomUUID()});
    exception=await f.capacity.recover(head.exceptionId,request(),f.actor);expect(exception.history.at(-1)?.action).toBe("RECOVERY_BLOCKED");
    // Synthetic capacity setup only. No application balance-manipulation path is introduced.
    if(currency==="SP")await f.db.update(s.wallets).set({balance:0}).where(eq(s.wallets.playerId,f.playerId));else await f.db.update(s.playerProgression).set({totalXp:0}).where(eq(s.playerProgression.playerId,f.playerId));
    const key=request();exception=await f.capacity.recover(head.exceptionId,key,f.actor);expect(exception.status).toBe("RECOVERED");expect((await f.capacity.recover(head.exceptionId,key,f.actor)).idempotent).toBe(true);
    expect((await f.claims.claim({...input,arrivedAt:new Date("2099-01-01Z")})).awarded).toEqual({xp:1,synapsePoints:1});expect((await f.claims.history(f.playerId,{},new Date("2099-01-01Z"))).entries[0].status).toBe("RECOVERED");
    expect((await f.db.select().from(c.playerMissionChests).where(eq(c.playerMissionChests.playerChestId,state.playerChestId)))[0].claimDeadline).toEqual(state.claimDeadline);
  });
  it("equal-deadline ordinary arrivals cannot create an exception; history retains expired frozen evidence",async()=>{
    const f=await chestFixture(getDb(),"DAILY",2147483647),active=await activateChest(f),state=await earnChest(f);await expect(f.claims.claim({playerId:f.playerId,chestId:active.chestId,periodKey:state.periodKey,idempotencyKey:crypto.randomUUID(),arrivedAt:state.claimDeadline})).rejects.toMatchObject({code:"CHEST_CLAIM_EXPIRED"});
    expect(await f.db.select().from(c.chestCapacityExceptions).where(eq(c.chestCapacityExceptions.playerId,f.playerId))).toEqual([]);expect((await f.claims.history(f.playerId,{},state.claimDeadline)).entries[0].status).toBe("EXPIRED");
  });
  it.each([false,true])("replacement definitions cannot steal a period already paid or reserved (capacity=%s)",async blocked=>{
    const f=await chestFixture(getDb(),"DAILY",blocked?2147483647:0),active=await activateChest(f),state=await earnChest(f);
    const input={playerId:f.playerId,chestId:active.chestId,periodKey:state.periodKey,idempotencyKey:crypto.randomUUID()};
    if(blocked)await expect(f.claims.claim(input)).rejects.toMatchObject({code:"CHEST_CAPACITY_PENDING"});else await f.claims.claim(input);
    await f.admin.operate(active.chestId,"DEACTIVATE",chestOperation(active),f.actor);
    const replacement=await f.admin.create({title:"Synthetic replacement",periodType:"DAILY"},f.actor);
    const configured=await f.admin.configure(replacement.chestId,{title:replacement.title,missionIds:f.ids,xp:1,synapsePoints:1,startsAt:null,endsAt:null,expectedUpdatedAt:replacement.revision},f.actor);
    await activateChest({...f,configured});
    await f.db.insert(c.playerMissionChests).values({playerId:f.playerId,chestId:replacement.chestId,periodKey:state.periodKey,targetCountSnapshot:3,currentCount:3,unlockedAt:new Date(),periodStartsAt:state.periodStartsAt,periodEndsAt:state.periodEndsAt,claimDeadline:state.claimDeadline,rewardSnapshot:state.rewardSnapshot});
    await expect(f.claims.claim({...input,chestId:replacement.chestId,idempotencyKey:crypto.randomUUID()})).rejects.toMatchObject({code:blocked?"CHEST_PERIOD_RESERVED":"CHEST_PERIOD_ALREADY_CLAIMED"});
    expect((await f.claims.list(f.playerId)).find(r=>r.chestId===replacement.chestId)?.claimable).toBe(false);
  });
  it("UTC Daily/Weekly boundaries and grace use original M1 contracts",()=>{
    expect(periodKeyFor("DAILY",new Date("2030-01-07T00:00:00Z"),"x")).toBe("2030-01-07");
    const key=periodKeyFor("WEEKLY",new Date("2030-01-07T00:00:00Z"),"x"),bounds=periodBounds("WEEKLY",key,"x");expect(bounds.start!.toISOString()).toBe("2030-01-07T00:00:00.000Z");expect(bounds.end!.toISOString()).toBe("2030-01-14T00:00:00.000Z");
  });
  it("append-only administrative and exception history cannot be deleted or truncated",async()=>{
    const db=getDb();for(const table of ["mission_chest_admin_events","chest_capacity_exceptions","chest_capacity_requests","chest_capacity_events"])for(const statement of [`DELETE FROM ${table}`,`TRUNCATE ${table} CASCADE`])await expect(db.execute(sql.raw(statement))).rejects.toThrow();
  });
}
