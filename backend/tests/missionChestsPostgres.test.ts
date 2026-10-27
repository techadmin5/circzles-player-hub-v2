import { beforeAll,afterAll,describe,it,expect } from "vitest";
import { eq } from "drizzle-orm";
import { verifyMissionsReleaseUpgrade } from "./helpers/missionsReleaseUpgrade.js";
import { fileURLToPath } from "node:url";
import { createDb } from "../src/db/client.js";
import * as c from "../src/db/missionChestSchema.js";
import * as s from "../src/db/schema.js";
import { localMissionPostgresUrl } from "./helpers/localMissionPostgres.js";
import { chestCases,chestFixture,activateChest,earnChest,chestOperation } from "./helpers/chestCases.js";
import { MissionChestService } from "../src/domain/missionChests.js";
import { AdminMissionChestService } from "../src/domain/adminMissionChests.js";
import { ChestCapacityService } from "../src/domain/chestCapacityExceptions.js";
const raw=process.env.MISSION_CHESTS_TEST_DATABASE_URL;
describe.skipIf(!raw)("fresh local PostgreSQL chest integrity",()=>{
  let first:ReturnType<typeof createDb>,second:ReturnType<typeof createDb>;
  const pids:number[]=[];
  beforeAll(async()=>{
    const name=process.env.MISSION_CHESTS_TEST_DATABASE_NAME,url=localMissionPostgresUrl(raw,name,process.env.MISSIONS_POSTGRES_DISPOSABLE);
    first=createDb(url.toString(),()=>{});second=createDb(url.toString(),()=>{});
    for(const connection of [first,second]){
      const id=(await connection.pool.query("SELECT current_database() AS database,current_user AS role,session_user AS session_role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::int AS version,pg_backend_pid() AS pid")).rows[0];
      if(id.database!==name||id.role!=="circzles_test"||id.session_role!=="circzles_test"||id.host!=="127.0.0.1"||id.port!==5432||id.version!==180006)throw new Error("STOP: local PostgreSQL chest identity mismatch before writes");pids.push(id.pid);
    }
    expect(new Set(pids).size).toBe(2);
    if((await first.pool.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema IN ('public','drizzle')")).rows[0].count!==0)throw new Error("STOP: chest verification requires a new empty disposable database");
    await verifyMissionsReleaseUpgrade(first,fileURLToPath(new URL("../drizzle/",import.meta.url)));
    expect((await first.pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count).toBe(36);
  },60000);
  afterAll(async()=>{await first?.pool.end();await second?.pool.end();console.info("CHEST_LOCAL_EVIDENCE",JSON.stringify({database:process.env.MISSION_CHESTS_TEST_DATABASE_NAME,pids}));});
  chestCases(()=>first.db);
  it("independent connections contend on the same claim, preserving one receipt and one ledger grant",async()=>{
    const f=await chestFixture(first.db),active=await activateChest(f),state=await earnChest(f),other=new MissionChestService(second.db),input={playerId:f.playerId,chestId:active.chestId,periodKey:state.periodKey,idempotencyKey:crypto.randomUUID()};
    const lock=await first.pool.connect();await lock.query("BEGIN");await lock.query("SELECT player_chest_id FROM player_mission_chests WHERE player_chest_id=$1 FOR UPDATE",[state.playerChestId]);
    const calls=Promise.all([f.claims.claim(input),other.claim(input)]);let observed=false;
    try{for(let n=0;n<100;n++){observed=(await first.pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()) AS waiting")).rows[0].waiting;if(observed)break;await new Promise(resolve=>setTimeout(resolve,20));}expect(observed).toBe(true);}finally{await lock.query("ROLLBACK");lock.release();}
    const [a,b]=await calls;expect(a.chestClaimId).toBe(b.chestClaimId);
    expect(await first.db.select().from(s.pointTransactions).where(eq(s.pointTransactions.playerId,f.playerId))).toHaveLength(1);
    expect(await first.db.select().from(s.xpTransactions).where(eq(s.xpTransactions.playerId,f.playerId))).toHaveLength(1);
  });
  it("approval versus editing serializes and cannot revive historical authorization",async()=>{
    const f=await chestFixture(first.db),d=f.configured,admin=new AdminMissionChestService(second.db);
    const outcomes=await Promise.allSettled([f.admin.operate(d.chestId,"APPROVE_PRODUCT",chestOperation(d,"PRODUCT"),f.actor),admin.configure(d.chestId,{title:d.title+" edited",missionIds:f.ids,xp:1,synapsePoints:1,startsAt:null,endsAt:null,expectedUpdatedAt:d.revision},f.actor)]);
    expect(outcomes.some(o=>o.status==="fulfilled")).toBe(true);const current=await admin.detail(d.chestId);expect(current.activationReady).toBe(false);expect(current.approvals.every(a=>a.status!=="APPROVED")).toBe(true);
  });
  it("concurrent recovery and ordinary retries preserve a single payout and immutable frozen amounts",async()=>{
    const f=await chestFixture(first.db,"DAILY",2147483647),active=await activateChest(f),state=await earnChest(f),input={playerId:f.playerId,chestId:active.chestId,periodKey:state.periodKey,idempotencyKey:crypto.randomUUID()};
    await expect(f.claims.claim(input)).rejects.toMatchObject({code:"CHEST_CAPACITY_PENDING"});
    const [head]=await first.db.select().from(c.chestCapacityExceptions).where(eq(c.chestCapacityExceptions.playerId,f.playerId));const d=await f.capacity.detail(head.exceptionId,f.actor);
    await first.db.update(s.wallets).set({balance:0}).where(eq(s.wallets.playerId,f.playerId));
    const request={expectedEventId:d.revision,digest:d.digest,reason:"Synthetic concurrent recovery",idempotencyKey:crypto.randomUUID()};
    const results=await Promise.allSettled([f.capacity.recover(d.exceptionId,request,f.actor),new ChestCapacityService(second.db).recover(d.exceptionId,request,f.actor),new MissionChestService(second.db).claim(input)]);
    expect(results.slice(0,2).every(r=>r.status==="fulfilled")).toBe(true);expect((await f.capacity.detail(d.exceptionId,f.actor)).status).toBe("RECOVERED");
    expect(await first.db.select().from(c.missionChestClaims).where(eq(c.missionChestClaims.playerId,f.playerId))).toHaveLength(1);
  });
  it("audit failure rolls back configuration and lifecycle changes",async()=>{
    const f=await chestFixture(first.db),before=f.configured;
    // A disposable-database-only fault trigger tests transaction atomicity; production triggers stay intact.
    await first.pool.query("CREATE FUNCTION chest_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$; CREATE TRIGGER chest_test_audit_failure BEFORE INSERT ON mission_chest_admin_events FOR EACH ROW EXECUTE FUNCTION chest_test_audit_failure()");
    try{await expect(f.admin.configure(before.chestId,{title:"Must roll back",missionIds:[],xp:null,synapsePoints:null,startsAt:null,endsAt:null,expectedUpdatedAt:before.revision},f.actor)).rejects.toThrow();expect(await f.admin.detail(before.chestId)).toEqual(before);}finally{await first.pool.query("DROP TRIGGER chest_test_audit_failure ON mission_chest_admin_events; DROP FUNCTION chest_test_audit_failure()");}
  });
});
