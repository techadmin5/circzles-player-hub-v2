import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { beforeAll, afterAll, expect, it } from "vitest";
import type { Database } from "../src/db/client.js";
import * as s from "../src/db/schema.js";
import { AdminMissionService, type AdminMissionDto, type AdminMissionPage } from "../src/domain/adminMissions.js";
import type { AdminMissionDto as FrontendDto, AdminMissionPage as FrontendPage } from "../../src/types/adminMissions.js";
import { AdminAuthorizationService, DrizzleAdminAuthorizationRepository, hasAdminPermission } from "../src/domain/adminAuth.js";
import { hashSessionToken, SESSION_COOKIE_NAME } from "../src/domain/sessions.js";
import { AppError } from "../src/domain/errors.js";
import type { Env } from "../src/config/env.js";
import { registerAdminMissionRoutes } from "../src/http/adminMissionRoutes.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const contractsMatch: [Equal<AdminMissionDto, FrontendDto>, Equal<AdminMissionPage, FrontendPage>] = [true, true];
let pg: PGlite, db: Database, service: AdminMissionService, actorId: string;
const now = new Date("2030-02-10T12:00:00Z"), secret = "admin-missions-isolated-session-secret-at-least-32";
beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql")).sort()) {
    await pg.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  }
  db = drizzle(pg, { schema: s }) as unknown as Database;
  service = new AdminMissionService(db);
  const [actorUser] = await db.insert(s.users).values({ verifiedEmail: "mission-audit-actor@example.test" }).returning();
  const [actor] = await db.insert(s.adminUsers).values({ userId: actorUser.userId, role: "SUPER_ADMIN" }).returning();
  actorId = actor.adminUserId;
}, 60000);
afterAll(async () => { await pg.close(); });

async function mission(overrides: Partial<typeof s.missions.$inferInsert> = {}) {
  const [row] = await db.insert(s.missions).values({ title: "Synthetic mission " + crypto.randomUUID(), description: "Synthetic description", category: "DAILY", periodType: "DAILY", active: false, activationEffectiveAt: new Date("2030-01-01Z"), ...overrides }).returning();
  await db.insert(s.missionRules).values({ missionId: row.missionId, eventType: "puzzle.added", targetCount: 2 });
  await db.insert(s.missionRewards).values({ missionId: row.missionId, rewardType: "XP", amount: 1 });
  return row;
}
function edit(row: typeof s.missions.$inferSelect, extra: Record<string, unknown> = {}) {
  return { title: "Edited synthetic label", description: "Edited description", displayOrder: 5, expectedUpdatedAt: row.updatedAt.toISOString(), ...extra };
}

it("keeps frontend JSON contracts synchronized without implementation imports", () => expect(contractsMatch).toEqual([true, true]));
it("preserves mission configuration permission for SUPER_ADMIN only without approval authority", () => {
  expect(hasAdminPermission("SUPER_ADMIN", "MISSIONS_MANAGE")).toBe(true);
  expect(hasAdminPermission("REVIEWER", "MISSIONS_MANAGE")).toBe(false);
});
it("lists inactive definitions with deterministic pagination and literal search", async () => {
  const prefix = "paged_%" + crypto.randomUUID();
  await mission({ title: prefix + " one", displayOrder: 10 }); await mission({ title: prefix + " two", displayOrder: 11 });
  const first = await service.list({ search: prefix, limit: 1, offset: 0 }, now);
  expect(first.missions).toHaveLength(1); expect(first.hasMore).toBe(true);
  expect(first.missions[0]).toMatchObject({ title: prefix + " one", lifecycle: "INACTIVE", configurationIssues: [] });
  const second = await service.list({ search: prefix, limit: 1, offset: 1 }, now);
  expect(second.missions[0].title).toBe(prefix + " two"); expect(second.hasMore).toBe(false);
});
it.each([
  [{ active: false }, "INACTIVE"],
  [{ active: true, startsAt: new Date("2031-01-01Z") }, "SCHEDULED"],
  [{ active: true, activationEffectiveAt: new Date("2031-01-01Z") }, "SCHEDULED"],
  [{ active: true }, "ACTIVE"],
  [{ active: true, endsAt: new Date("2030-02-10T12:00:00Z") }, "ENDED"],
] as const)("derives definition lifecycle %# independently from player completion", async (values, lifecycle) => {
  const row = await mission(values);
  expect((await service.detail(row.missionId, now)).lifecycle).toBe(lifecycle);
});
it("shows invalid existing definitions rather than inventing valid rules or rewards", async () => {
  const [row] = await db.insert(s.missions).values({ title: "Incomplete", description: "", category: "DAILY", periodType: "FIXED", active: false }).returning();
  const detail = await service.detail(row.missionId, now);
  expect(detail.configurationIssues).toHaveLength(3); expect(detail.rule).toBeNull(); expect(detail.rewards).toEqual([]);
});
it("updates only inactive metadata and preserves gameplay, snapshots and ledgers", async () => {
  const row = await mission();
  const [user] = await db.insert(s.users).values({ verifiedEmail: crypto.randomUUID() + "@example.test" }).returning();
  const [player] = await db.insert(s.players).values({ userId: user.userId, displayName: "Synthetic", publicPlayerId: "test_" + crypto.randomUUID().replaceAll("-", "") }).returning();
  await db.insert(s.playerMissionProgress).values({ playerId: player.playerId, missionId: row.missionId, periodKey: "2030-02-10", targetCountSnapshot: 2, currentCount: 2, status: "CLAIMABLE", completedAt: now, rewardSnapshot: { version: 1, rewards: [{ type: "XP", amount: 1 }] } });
  const protectedTables = ["mission_rules", "mission_rewards", "player_mission_progress", "mission_claims", "mission_chest_claims", "point_transactions", "xp_transactions", "game_events"];
  const snapshot = async () => Promise.all(protectedTables.map(table => pg.query(`SELECT * FROM ${table}`)));
  const before = await snapshot();
  const saved = await service.updateMetadata(row.missionId, edit(row), actorId, now);
  expect(saved).toMatchObject({ title: "Edited synthetic label", description: "Edited description", displayOrder: 5, active: false });
  expect(await snapshot()).toEqual(before);
  const [after] = await db.select().from(s.missions).where(eq(s.missions.missionId, row.missionId));
  expect({ ...after, title: row.title, description: row.description, displayOrder: row.displayOrder, updatedAt: row.updatedAt }).toEqual(row);
});
it("rejects active metadata writes and stale revisions without overwriting", async () => {
  const active = await mission({ active: true });
  await expect(service.updateMetadata(active.missionId, edit(active), actorId)).rejects.toMatchObject({ code: "MISSION_METADATA_LOCKED", statusCode: 409 });
  const row = await mission(); await service.updateMetadata(row.missionId, edit(row), actorId, now);
  await expect(service.updateMetadata(row.missionId, edit(row, { title: "Stale overwrite" }), actorId, now)).rejects.toMatchObject({ code: "MISSION_REVISION_CONFLICT", statusCode: 409 });
  expect((await service.detail(row.missionId)).title).toBe("Edited synthetic label");
});
it.each([{ active: true }, { rewards: [] }, { targetCount: 100 }, { category: "WEEKLY" }, { startsAt: "2030-01-01" }, { title: " " }, { displayOrder: -1 }, { displayOrder: "1" }, { expectedUpdatedAt: "invalid" }])("rejects unsupported or malformed edits %#", async extra => {
  const row = await mission();
  await expect(service.updateMetadata(row.missionId, edit(row, extra), actorId)).rejects.toMatchObject({ code: "VALIDATION_FAILED", statusCode: 400 });
});
it("returns not found for an unknown definition", async () => {
  await expect(service.detail(crypto.randomUUID())).rejects.toMatchObject({ code: "MISSION_NOT_FOUND", statusCode: 404 });
});

async function http(role?: "SUPER_ADMIN" | "REVIEWER", active = true, expired = false, production = false) {
  const [user] = await db.insert(s.users).values({ verifiedEmail: crypto.randomUUID() + "@example.test" }).returning();
  if (role) await db.insert(s.adminUsers).values({ userId: user.userId, role, active });
  const token = crypto.randomUUID();
  await db.insert(s.authSessions).values({ userId: user.userId, tokenHash: hashSessionToken(token, secret), expiresAt: new Date(Date.now() + (expired ? -60000 : 60000)) });
  const app = Fastify(); await app.register(cookie);
  app.setErrorHandler((error, _req, reply) => { if (error instanceof AppError) reply.code(error.statusCode).send({ code: error.code }); else reply.code(500).send({ code: "INTERNAL" }); });
  registerAdminMissionRoutes(app, { env: { NODE_ENV: production ? "production" : "test", FRONTEND_ORIGIN: "https://hub.example.test", PLAYER_HUB_PROXY_SECRET: "synthetic-proxy-secret" } as Env, adminAuth: new AdminAuthorizationService(new DrizzleAdminAuthorizationRepository(db), secret), adminMissions: service });
  await app.ready(); return { app, headers: { cookie: SESSION_COOKIE_NAME + "=" + token } };
}
it.each([[undefined, true, false, 403], ["REVIEWER", true, false, 403], ["SUPER_ADMIN", false, false, 403], ["SUPER_ADMIN", true, true, 401]] as const)("denies non-admin, reviewer, inactive and expired sessions %#", async (role, active, expired, code) => {
  const { app, headers } = await http(role, active, expired);
  try { for (const url of ["/api/admin/missions/access", "/api/admin/missions", "/api/admin/missions/" + crypto.randomUUID(), "/api/admin/missions/" + crypto.randomUUID() + "/history"]) expect((await app.inject({ url, headers })).statusCode).toBe(code);
    expect((await app.inject({ method: "POST", url: "/api/admin/missions", headers, payload: {} })).statusCode).toBe(code);
    expect((await app.inject({ method: "PATCH", url: "/api/admin/missions/" + crypto.randomUUID(), headers, payload: {} })).statusCode).toBe(code);
  } finally { await app.close(); }
}, 15000);
it("requires authentication, proxy, same-origin writes and strict query/identifier validation", async () => {
  const { app, headers } = await http("SUPER_ADMIN", true, false, true);
  try {
    const row = await mission(), url = "/api/admin/missions/" + row.missionId;
    expect((await app.inject({ url: "/api/admin/missions/access" })).statusCode).toBe(401);
    expect((await app.inject({ url, headers })).statusCode).toBe(403);
    const trusted = { ...headers, "x-player-hub-proxy-secret": "synthetic-proxy-secret" };
    const access = await app.inject({ url: "/api/admin/missions/access", headers: trusted });
    expect(access.json()).toEqual({ allowed: true }); expect(access.headers["cache-control"]).toBe("private, no-store");
    for (const badUrl of ["/api/admin/missions/not-a-uuid", "/api/admin/missions?unknown=true", "/api/admin/missions?limit=101", "/api/admin/missions?offset=-1"]) expect((await app.inject({ url: badUrl, headers: trusted })).statusCode).toBe(400);
    for (const extra of [{ origin: "https://evil.test" }, { "sec-fetch-site": "cross-site" }]) expect((await app.inject({ method: "PATCH", url, headers: { ...trusted, ...extra }, payload: edit(row) })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url, headers: { ...trusted, origin: "https://hub.example.test" }, payload: edit(row) })).statusCode).toBe(200);
  } finally { await app.close(); }
});
