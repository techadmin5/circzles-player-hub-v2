import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { beforeAll, afterAll, expect, it } from "vitest";
import type { Database } from "../src/db/client.js";
import * as s from "../src/db/schema.js";
import { missionAdminHistory } from "../src/db/missionAdminSchema.js";
import { AdminMissionService, type AdminMissionHistoryPage } from "../src/domain/adminMissions.js";
import { DrizzleMissionClaimRepository, DrizzleMissionRepository, missionCategories } from "../src/domain/missions.js";
import { AdminAuthorizationService, DrizzleAdminAuthorizationRepository } from "../src/domain/adminAuth.js";
import { hashSessionToken, SESSION_COOKIE_NAME } from "../src/domain/sessions.js";
import { AppError } from "../src/domain/errors.js";
import type { Env } from "../src/config/env.js";
import { registerAdminMissionRoutes } from "../src/http/adminMissionRoutes.js";
import { adminMissionCategories, type AdminMissionHistoryPage as FrontendHistoryPage } from "../../src/types/adminMissions.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const historyContractMatches: Equal<AdminMissionHistoryPage, FrontendHistoryPage> = true;
let pg: PGlite, db: Database, service: AdminMissionService, actorId: string;
const now = new Date("2030-02-10T12:00:00Z"), secret = "admin-drafts-isolated-session-secret-at-least-32";
const pageFilter = { limit: 25, offset: 0 };
const draftInput = (extra: Record<string, unknown> = {}) => ({ title: "Synthetic draft " + crypto.randomUUID(), description: "", category: "DAILY", displayOrder: 0, ...extra });
const edit = (row: typeof s.missions.$inferSelect, extra: Record<string, unknown> = {}) => ({ title: "Edited synthetic label", description: "Edited description", displayOrder: 5, expectedUpdatedAt: row.updatedAt.toISOString(), ...extra });
beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql")).sort()) await pg.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  db = drizzle(pg, { schema: s }) as unknown as Database;
  service = new AdminMissionService(db);
  const [user] = await db.insert(s.users).values({ verifiedEmail: "draft-history-actor@example.test" }).returning();
  const [actor] = await db.insert(s.adminUsers).values({ userId: user.userId, role: "SUPER_ADMIN" }).returning();
  actorId = actor.adminUserId;
}, 60000);
afterAll(async () => { await pg.close(); });

it("keeps history and existing category contracts aligned", () => {
  expect(historyContractMatches).toBe(true); expect(adminMissionCategories).toEqual(missionCategories);
});
it.each([
  ["DAILY", "DAILY"], ["WEEKLY", "WEEKLY"], ["ACHIEVEMENT", "LIFETIME"],
  ["SPRINT", "FIXED"], ["SEASON", "FIXED"], ["EVENT", "FIXED"],
])("creates an inactive %s draft with existing %s period and no gameplay configuration", async (category, periodType) => {
  const draft = await service.createDraft(draftInput({ category }), actorId, now);
  expect(draft).toMatchObject({ active: false, lifecycle: "INACTIVE", periodType, rule: null, rewards: [], startsAt: null, endsAt: null, claimDeadline: null });
  expect(draft.configurationIssues.length).toBeGreaterThan(0);
  const history = await service.history(draft.missionId, pageFilter);
  expect(history.entries).toHaveLength(1);
  expect(history.entries[0]).toMatchObject({ missionId: draft.missionId, actorAdminUserId: actorId, action: "DRAFT_CREATED", occurredAt: now.toISOString(), before: null, after: { title: draft.title, category, periodType, active: false } });
  expect(Object.keys(history.entries[0]).sort()).toEqual(["action", "actorAdminUserId", "after", "before", "historyId", "missionId", "occurredAt"].sort());
});
it.each([{ title: " " }, { category: "NEW_TYPE" }, { category: "" }, { displayOrder: -1 }, { active: true }, { periodType: "LIFETIME" }, { rewards: [{ rewardType: "XP", amount: 99 }] }, { eventType: "puzzle.added" }, { startsAt: "2030-01-01Z" }, { actorAdminUserId: "spoofed" }, { title: "x".repeat(201) }])("rejects invalid or gameplay-bearing draft input %# without an audit write", async extra => {
  const before = await db.select().from(missionAdminHistory);
  await expect(service.createDraft(draftInput(extra), actorId, now)).rejects.toMatchObject({ code: "VALIDATION_FAILED", statusCode: 400 });
  expect(await db.select().from(missionAdminHistory)).toEqual(before);
});
it("new drafts cannot appear in player missions, progress or claim payouts", async () => {
  const draft = await service.createDraft(draftInput(), actorId, now);
  const [user] = await db.insert(s.users).values({ verifiedEmail: crypto.randomUUID() + "@example.test" }).returning();
  const [player] = await db.insert(s.players).values({ userId: user.userId, displayName: "Synthetic", publicPlayerId: "test_" + crypto.randomUUID().replaceAll("-", "") }).returning();
  const repo = new DrizzleMissionRepository(db);
  expect(await repo.listForPlayer(player.playerId, now)).toEqual([]);
  expect(await repo.listPeriods(player.playerId, now)).toEqual([]);
  await db.insert(s.gameEvents).values({ playerId: player.playerId, eventType: "puzzle.added", sourceType: "SYNTHETIC", sourceId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), payload: {}, createdAt: new Date(now.getTime() + 1000) });
  await repo.processBatch(1);
  expect(await db.select().from(s.playerMissionProgress)).toEqual([]);
  await expect(new DrizzleMissionClaimRepository(db).claim({ playerId: player.playerId, missionId: draft.missionId, idempotencyKey: crypto.randomUUID(), now })).rejects.toMatchObject({ code: "MISSION_NOT_CLAIMABLE", statusCode: 409 });
  expect(await db.select().from(s.missionClaims)).toEqual([]);
  expect(await db.select().from(s.xpTransactions)).toEqual([]);
  expect(await db.select().from(s.pointTransactions)).toEqual([]);
});
it("records exact metadata before/after, ignores no-ops and paginates history", async () => {
  const draft = await service.createDraft(draftInput(), actorId, now);
  const row = (await db.select().from(s.missions).where(eq(s.missions.missionId, draft.missionId)))[0];
  const saved = await service.updateMetadata(row.missionId, edit(row), actorId, now);
  const first = await service.history(row.missionId, { limit: 1, offset: 0 });
  expect(first.hasMore).toBe(true); expect(first.entries[0].action).toBe("METADATA_UPDATED");
  expect(first.entries[0].before).toMatchObject({ title: row.title, description: row.description, displayOrder: row.displayOrder, updatedAt: row.updatedAt.toISOString() });
  expect(first.entries[0].after).toMatchObject({ title: saved.title, description: saved.description, displayOrder: saved.displayOrder, updatedAt: saved.updatedAt, active: false });
  expect((await service.history(row.missionId, { limit: 1, offset: 1 })).entries[0].action).toBe("DRAFT_CREATED");
  await service.updateMetadata(row.missionId, { title: saved.title, description: saved.description, displayOrder: saved.displayOrder, expectedUpdatedAt: saved.updatedAt }, actorId, now);
  expect((await service.history(row.missionId, pageFilter)).entries).toHaveLength(2);
});
it("rolls back creation and edits when their audit insert fails", async () => {
  const input = draftInput(), missingActor = crypto.randomUUID();
  await expect(service.createDraft(input, missingActor, now)).rejects.toThrow();
  expect(await db.select().from(s.missions).where(eq(s.missions.title, input.title))).toEqual([]);
  const draft = await service.createDraft(draftInput(), actorId, now);
  const row = (await db.select().from(s.missions).where(eq(s.missions.missionId, draft.missionId)))[0];
  const before = await service.history(row.missionId, pageFilter);
  await expect(service.updateMetadata(row.missionId, edit(row), missingActor, now)).rejects.toThrow();
  expect((await db.select().from(s.missions).where(eq(s.missions.missionId, row.missionId)))[0]).toEqual(row);
  expect(await service.history(row.missionId, pageFilter)).toEqual(before);
});
it("accepts one concurrent revision and writes exactly one edit audit", async () => {
  const draft = await service.createDraft(draftInput(), actorId, now);
  const row = (await db.select().from(s.missions).where(eq(s.missions.missionId, draft.missionId)))[0];
  const results = await Promise.allSettled([
    service.updateMetadata(row.missionId, edit(row, { title: "First writer" }), actorId, now),
    service.updateMetadata(row.missionId, edit(row, { title: "Second writer" }), actorId, now),
  ]);
  expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find(row => row.status === "rejected");
  expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({ code: "MISSION_REVISION_CONFLICT" });
  const history = await service.history(row.missionId, pageFilter);
  expect(history.entries.filter(row => row.action === "METADATA_UPDATED")).toHaveLength(1);
  expect(history.entries[0].after.title).toBe((await service.detail(row.missionId)).title);
});
it("history rejects updates, deletes and truncation", async () => {
  const draft = await service.createDraft(draftInput(), actorId, now);
  const id = (await service.history(draft.missionId, pageFilter)).entries[0].historyId;
  for (const statement of [`UPDATE mission_admin_history SET action='METADATA_UPDATED' WHERE history_id=${id}`, `DELETE FROM mission_admin_history WHERE history_id=${id}`, "TRUNCATE mission_admin_history"]) await expect(pg.exec(statement)).rejects.toThrow("append-only");
  expect((await service.history(draft.missionId, pageFilter)).entries).toHaveLength(1);
});

async function http(role?: "SUPER_ADMIN" | "REVIEWER", active = true, expired = false) {
  const [user] = await db.insert(s.users).values({ verifiedEmail: crypto.randomUUID() + "@example.test" }).returning();
  const [actor] = role ? await db.insert(s.adminUsers).values({ userId: user.userId, role, active }).returning() : [];
  const token = crypto.randomUUID();
  await db.insert(s.authSessions).values({ userId: user.userId, tokenHash: hashSessionToken(token, secret), expiresAt: new Date(Date.now() + (expired ? -60000 : 60000)) });
  const app = Fastify(); await app.register(cookie);
  app.setErrorHandler((error, _req, reply) => { if (error instanceof AppError) reply.code(error.statusCode).send({ code: error.code }); else reply.code(500).send({ code: "INTERNAL" }); });
  registerAdminMissionRoutes(app, { env: { NODE_ENV: "production", FRONTEND_ORIGIN: "https://hub.example.test", PLAYER_HUB_PROXY_SECRET: "synthetic-proxy-secret" } as Env, adminAuth: new AdminAuthorizationService(new DrizzleAdminAuthorizationRepository(db), secret), adminMissions: service });
  await app.ready(); return { app, actor, headers: { cookie: SESSION_COOKIE_NAME + "=" + token, origin: "https://hub.example.test", "x-player-hub-proxy-secret": "synthetic-proxy-secret" } };
}
it.each([[undefined, true, false, 403], ["REVIEWER", true, false, 403], ["SUPER_ADMIN", false, false, 403], ["SUPER_ADMIN", true, true, 401]] as const)("creation and history deny unauthorized roles/sessions %#", async (role, active, expired, code) => {
  const { app, headers } = await http(role, active, expired);
  try {
    expect((await app.inject({ method: "POST", url: "/api/admin/missions", headers, payload: draftInput() })).statusCode).toBe(code);
    expect((await app.inject({ url: "/api/admin/missions/" + crypto.randomUUID() + "/history", headers })).statusCode).toBe(code);
  } finally { await app.close(); }
}, 15000);
it("creation records the session actor and history preserves proxy/origin/validation protections", async () => {
  const { app, headers, actor } = await http("SUPER_ADMIN");
  try {
    expect((await app.inject({ method: "POST", url: "/api/admin/missions", payload: draftInput() })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/admin/missions", headers: { cookie: headers.cookie }, payload: draftInput() })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/admin/missions", headers: { ...headers, origin: "https://evil.test" }, payload: draftInput() })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/admin/missions", headers, payload: draftInput({ active: true }) })).statusCode).toBe(400);
    const response = await app.inject({ method: "POST", url: "/api/admin/missions", headers, payload: draftInput() });
    expect(response.statusCode).toBe(201); expect(response.headers["cache-control"]).toBe("private, no-store"); expect(response.json().active).toBe(false);
    const historyUrl = "/api/admin/missions/" + response.json().missionId + "/history";
    const history = await app.inject({ url: historyUrl, headers });
    expect(history.statusCode).toBe(200); expect(history.headers["cache-control"]).toBe("private, no-store");
    expect(history.json().entries[0].actorAdminUserId).toBe(actor?.adminUserId);
    for (const query of ["?limit=0", "?offset=-1", "?unexpected=true"]) expect((await app.inject({ url: historyUrl + query, headers })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/admin/missions/" + crypto.randomUUID() + "/history", headers })).statusCode).toBe(404);
  } finally { await app.close(); }
}, 15000);
