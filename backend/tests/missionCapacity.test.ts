import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readdir, readFile } from "node:fs/promises";
import type { Database } from "../src/db/client.js";
import * as s from "../src/db/schema.js";
import { capacityCases } from "./helpers/missionCapacityCases.js";
import { capacityFixture, openCapacity, recoveryRequest } from "./helpers/missionCapacityCases.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { AdminMissionService } from "../src/domain/adminMissions.js";
import { AdminAuthorizationService, DrizzleAdminAuthorizationRepository } from "../src/domain/adminAuth.js";
import { registerAdminMissionRoutes } from "../src/http/adminMissionRoutes.js";
import { hashSessionToken, SESSION_COOKIE_NAME } from "../src/domain/sessions.js";
import { AppError } from "../src/domain/errors.js";
import type { Env } from "../src/config/env.js";
import type { MissionCapacityDto } from "../../src/types/adminMissions.js";

let pg: PGlite, db: Database;
beforeAll(async () => {
  pg = new PGlite();
  for (const f of (await readdir(new URL("../drizzle/", import.meta.url))).filter(f => f.endsWith(".sql")).sort()) await pg.exec((await readFile(new URL(`../drizzle/${f}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  db = drizzle(pg, { schema: s }) as unknown as Database;
}, 60000);
afterAll(async () => { await pg.close(); });
capacityCases(() => db);
it("capacity exception records, request bindings and audit events are append-only", async () => {
  for (const table of ["mission_capacity_exceptions", "mission_capacity_requests", "mission_capacity_events"]) {
    for (const sql of [`DELETE FROM ${table}`, `TRUNCATE ${table} CASCADE`]) await expect(pg.exec(sql)).rejects.toThrow(/append-only/);
  }
});
it("capacity routes protect the actor, session, origin and proxy and audit the authenticated administrator", async () => {
  const f = await capacityFixture(db), row: MissionCapacityDto = await openCapacity(db, f);
  const secret = "synthetic-capacity-session-secret-more-than-32", token = crypto.randomUUID();
  const [admin] = await db.select().from(s.adminUsers).where(eq(s.adminUsers.adminUserId, f.actor));
  await db.insert(s.authSessions).values({ userId: admin.userId, tokenHash: hashSessionToken(token, secret), expiresAt: new Date(Date.now() + 60000) });
  const app = Fastify(); await app.register(cookie);
  app.setErrorHandler((error, _req, reply) => { if (error instanceof AppError) reply.code(error.statusCode).send({ code: error.code }); else reply.code(500).send({ code: "INTERNAL" }); });
  const env = { NODE_ENV: "production", FRONTEND_ORIGIN: "https://hub.test.invalid", PLAYER_HUB_PROXY_SECRET: "synthetic-capacity-proxy" } as Env;
  registerAdminMissionRoutes(app, { env, adminAuth: new AdminAuthorizationService(new DrizzleAdminAuthorizationRepository(db), secret), adminMissions: new AdminMissionService(db) });
  const url = `/api/admin/mission-capacity-exceptions/${row.exceptionId}`, headers = { cookie: SESSION_COOKIE_NAME + "=" + token, "x-player-hub-proxy-secret": "synthetic-capacity-proxy", origin: "https://hub.test.invalid" };
  try {
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await app.inject({ url, headers: { cookie: headers.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ url, headers })).json().status).toBe("PENDING");
    expect((await app.inject({ url: `/api/admin/missions/${f.input.missionId}/capacity-exceptions`, headers })).json().entries).toHaveLength(1);
    expect((await app.inject({ method: "POST", url: url + "/recover", headers: { ...headers, origin: "https://evil.test.invalid" }, payload: recoveryRequest(row) })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: url + "/recover", headers, payload: { ...recoveryRequest(row), actor: "forged" } })).statusCode).toBe(400);
    const response = await app.inject({ method: "POST", url: url + "/recover", headers, payload: recoveryRequest(row) });
    expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json().history.at(-1)).toMatchObject({ action: "RECOVERY_BLOCKED", actorAdminUserId: f.actor });
    env.MISSION_CLAIMS_ENABLED = false;
    const paused = await app.inject({ method: "POST", url: url + "/recover", headers, payload: recoveryRequest(row) });
    expect(paused.statusCode).toBe(503); expect(paused.json().code).toBe("MISSION_CLAIMS_MAINTENANCE"); expect(paused.headers["retry-after"]).toBe("60");
    expect((await app.inject({ url, headers })).statusCode).toBe(200);
    expect((await f.service.detail(row.exceptionId, f.actor)).history).toHaveLength(2);
  } finally { await app.close(); }
});
