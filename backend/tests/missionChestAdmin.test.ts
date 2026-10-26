import { beforeAll,afterAll,it,expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readdir,readFile } from "node:fs/promises";
import type { Database } from "../src/db/client.js";
import * as s from "../src/db/schema.js";
import { chestCases } from "./helpers/chestCases.js";
import { chestFixture } from "./helpers/chestCases.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { AdminMissionService } from "../src/domain/adminMissions.js";
import { AdminAuthorizationService,DrizzleAdminAuthorizationRepository } from "../src/domain/adminAuth.js";
import { registerAdminMissionRoutes } from "../src/http/adminMissionRoutes.js";
import { AppError } from "../src/domain/errors.js";
import { eq } from "drizzle-orm";
import { hashSessionToken,SESSION_COOKIE_NAME } from "../src/domain/sessions.js";
import type { Env } from "../src/config/env.js";
import type { AdminChest,PlayerChest } from "../../src/types/missionChests.js";
import { MissionChestService } from "../src/domain/missionChests.js";
import { chestOperation } from "./helpers/chestCases.js";
let pg:PGlite,db:Database;
beforeAll(async()=>{pg=new PGlite();for(const f of (await readdir(new URL("../drizzle/",import.meta.url))).filter(f=>f.endsWith(".sql")).sort())await pg.exec((await readFile(new URL(`../drizzle/${f}`,import.meta.url),"utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;",""));db=drizzle(pg,{schema:s}) as unknown as Database;},60000);
afterAll(async()=>{await pg?.close();});
chestCases(()=>db);
it("new admin routes enforce session, SUPER_ADMIN permission, trusted actor, origin and production proxy",async()=>{
 const f=await chestFixture(db),secret="synthetic-chest-session-at-least-32-characters",token=crypto.randomUUID();
 const [admin]=await db.select().from(s.adminUsers).where(eq(s.adminUsers.adminUserId,f.actor));
 await db.insert(s.authSessions).values({userId:admin.userId,tokenHash:hashSessionToken(token,secret),expiresAt:new Date(Date.now()+60000)});
 const app=Fastify();await app.register(cookie);app.setErrorHandler((e,_r,reply)=>{if(e instanceof AppError)reply.code(e.statusCode).send({code:e.code});else reply.code(500).send({code:"INTERNAL"});});
 registerAdminMissionRoutes(app,{env:{NODE_ENV:"production",FRONTEND_ORIGIN:"https://hub.test.invalid",PLAYER_HUB_PROXY_SECRET:"synthetic-proxy"} as Env,adminAuth:new AdminAuthorizationService(new DrizzleAdminAuthorizationRepository(db),secret),adminMissions:new AdminMissionService(db)});
 const url="/api/admin/mission-chests",headers={cookie:SESSION_COOKIE_NAME+"="+token,"x-player-hub-proxy-secret":"synthetic-proxy",origin:"https://hub.test.invalid"};
 try{
  expect((await app.inject({url})).statusCode).toBe(401);expect((await app.inject({url,headers:{cookie:headers.cookie}})).statusCode).toBe(403);
  expect((await app.inject({url,headers})).statusCode).toBe(200);
  expect((await app.inject({url,method:"POST",headers:{...headers,origin:"https://evil.invalid"},payload:{title:"x",periodType:"DAILY"}})).statusCode).toBe(403);
  expect((await app.inject({url,method:"POST",headers,payload:{title:"x",periodType:"DAILY",actor:"forged"}})).statusCode).toBe(400);
  await db.update(s.adminUsers).set({role:"REVIEWER"}).where(eq(s.adminUsers.adminUserId,f.actor));expect((await app.inject({url,headers})).statusCode).toBe(403);
 }finally{await app.close();}
},20000);
it("frontend contracts match serialized chest responses without importing backend modules into Next",async()=>{
 const f=await chestFixture(db);
 const admin:AdminChest=await f.admin.detail(f.configured.chestId);expect(admin.rewards?.rewards[0].type).toBe("XP");
 type Json<T>=T extends Date?string:T extends (infer U)[]?Json<U>[]:T extends object?{[K in keyof T]:Json<T[K]>}:T;
 const check=(response:Json<Awaited<ReturnType<MissionChestService["list"]>>>):PlayerChest[]=>response;
 expect(check([])).toEqual([]);
});
it("revocations are separately audited and cannot be bypassed by replaying an earlier category approval",async()=>{
 const f=await chestFixture(db);let d=f.configured;
 const original=chestOperation(d,"PRODUCT");d=await f.admin.operate(d.chestId,"APPROVE_PRODUCT",original,f.actor);
 d=await f.admin.operate(d.chestId,"APPROVE_REWARD_BUDGET",chestOperation(d,"REWARD_BUDGET"),f.actor);
 expect(d.activationReady).toBe(true);
 d=await f.admin.operate(d.chestId,"REVOKE_PRODUCT",chestOperation(d,"PRODUCT"),f.actor);
 expect(d.approvals.find(a=>a.category==="PRODUCT")?.status).toBe("REVOKED");expect(d.approvals.find(a=>a.category==="REWARD_BUDGET")?.status).toBe("APPROVED");
 expect((await f.admin.operate(d.chestId,"APPROVE_PRODUCT",original,f.actor)).activationReady).toBe(false);
 await expect(f.admin.operate(d.chestId,"ACTIVATE",chestOperation(d),f.actor)).rejects.toMatchObject({code:"CHEST_ACTIVATION_BLOCKED"});
 expect((await f.admin.history(d.chestId)).entries.filter(e=>e.action==="REVOKE_PRODUCT")).toHaveLength(1);
});
