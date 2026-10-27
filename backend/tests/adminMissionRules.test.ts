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
import { AdminMissionService } from "../src/domain/adminMissions.js";
import { adminMissionRuleOptions, parseAdminMissionRule } from "../src/domain/adminMissionRules.js";
import { implementedGameEventTypes } from "../src/domain/gameEvents.js";
import { DrizzleMissionClaimRepository, DrizzleMissionRepository, missionMatchesEvent, validateMissionRule } from "../src/domain/missions.js";
import { AdminAuthorizationService, DrizzleAdminAuthorizationRepository } from "../src/domain/adminAuth.js";
import { hashSessionToken, SESSION_COOKIE_NAME } from "../src/domain/sessions.js";
import { AppError } from "../src/domain/errors.js";
import type { Env } from "../src/config/env.js";
import { registerAdminMissionRoutes } from "../src/http/adminMissionRoutes.js";
import type { AdminMissionRuleInput, AdminMissionRuleOptions } from "../../src/types/adminMissions.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const inputMatches: Equal<ReturnType<typeof parseAdminMissionRule>, AdminMissionRuleInput> = true;
const optionsMatch: Equal<{ options: typeof adminMissionRuleOptions }, AdminMissionRuleOptions> = true;
let pg: PGlite, db: Database, service: AdminMissionService, actorId: string;
const now = new Date("2030-02-10T12:00:00Z"), secret = "synthetic-admin-rules-session-secret-at-least-32";
const historyFilter = { limit: 100, offset: 0 };
const draft = () => service.createDraft({ title: "Synthetic rule " + crypto.randomUUID(), description: "", category: "DAILY", displayOrder: 0 }, actorId, now);
const input = (revision: string, extra: Record<string, unknown> = {}) => ({ eventType: "puzzle.added", targetCount: 2, sourceType: null, puzzleId: null, levelId: null, conditions: {}, active: true, expectedUpdatedAt: revision, ...extra });
beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql")).sort()) await pg.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  db = drizzle(pg, { schema: s }) as unknown as Database;
  service = new AdminMissionService(db);
  const [user] = await db.insert(s.users).values({ verifiedEmail: "rule-actor@example.test" }).returning();
  const [actor] = await db.insert(s.adminUsers).values({ userId: user.userId, role: "SUPER_ADMIN" }).returning(); actorId = actor.adminUserId;
}, 60000);
afterAll(async () => { await pg.close(); });

it("keeps frontend request/options contracts aligned with strict backend parsing", () => {
  expect(inputMatches && optionsMatch).toBe(true);
  expect(adminMissionRuleOptions).toHaveLength(6);
});
it("migration 0028 preserves existing 0027 audit records and append-only guards", async () => {
  const isolated = new PGlite();
  try {
    for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql") && Number(file.slice(0, 4)) <= 27).sort()) await isolated.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
    const local = drizzle(isolated, { schema: s }) as unknown as Database;
    const [user] = await local.insert(s.users).values({ verifiedEmail: "upgrade-actor@example.test" }).returning();
    const [actor] = await local.insert(s.adminUsers).values({ userId: user.userId, role: "SUPER_ADMIN" }).returning();
    const admin = new AdminMissionService(local);
    const created = await admin.createDraft({ title: "Existing 0027 draft", description: "", category: "DAILY", displayOrder: 0 }, actor.adminUserId, now);
    const before = await admin.history(created.missionId, historyFilter);
    const migration = await readFile(new URL("../drizzle/0028_mission_admin_rule_history.sql", import.meta.url), "utf8");
    await isolated.exec("BEGIN;\n" + migration + "\nCOMMIT;");
    expect(await admin.history(created.missionId, historyFilter)).toEqual(before);
    await admin.updateRule(created.missionId, input(created.updatedAt), actor.adminUserId, now);
    expect((await admin.history(created.missionId, historyFilter)).entries.map(row => row.action)).toEqual(["RULE_CONFIGURED", "DRAFT_CREATED"]);
    await expect(isolated.exec("DELETE FROM mission_admin_history")).rejects.toThrow(/append-only/);
    await expect(isolated.exec("TRUNCATE mission_admin_history")).rejects.toThrow(/append-only/);
  } finally { await isolated.close(); }
}, 30000);
it.each(adminMissionRuleOptions)("configures and audits existing $eventType matching semantics", async option => {
  expect(implementedGameEventTypes).toContain(option.eventType);
  const created = await draft();
  const saved = await service.updateRule(created.missionId, input(created.updatedAt, { eventType: option.eventType, sourceType: option.sourceType, levelId: 0.5 }), actorId, now);
  expect(saved.active).toBe(false); expect(saved.rewards).toEqual([]);
  expect(saved.rule).toMatchObject({ eventType: option.eventType, targetCount: 2, sourceType: option.sourceType, levelId: 0.5, active: true, conditions: {} });
  expect(() => validateMissionRule(saved.rule!)).not.toThrow();
  const event = { eventType: option.eventType, sourceType: option.sourceType, payload: { levelId: 0.5, puzzleId: crypto.randomUUID() }, createdAt: now };
  expect(missionMatchesEvent(event, { startsAt: null, endsAt: null }, saved.rule!)).toBe(true);
  expect(missionMatchesEvent({ ...event, payload: { levelId: 1 } }, { startsAt: null, endsAt: null }, saved.rule!)).toBe(false);
  expect(missionMatchesEvent({ ...event, sourceType: "WRONG" }, { startsAt: null, endsAt: null }, saved.rule!)).toBe(false);
  const history = await service.history(created.missionId, historyFilter);
  expect(history.entries[0]).toMatchObject({ action: "RULE_CONFIGURED", actorAdminUserId: actorId, occurredAt: now.toISOString(), before: { rule: null, updatedAt: created.updatedAt }, after: { rule: saved.rule, updatedAt: saved.updatedAt, active: false } });
  const again = await service.updateRule(created.missionId, input(saved.updatedAt, { eventType: option.eventType, sourceType: option.sourceType, levelId: 0.5 }), actorId, now);
  expect(again.updatedAt).toBe(saved.updatedAt);
  expect(await service.history(created.missionId, historyFilter)).toEqual(history);
});
it.each([
  { eventType: "invented.event" }, { eventType: "mission.completed" }, { eventType: "mission.claimed" }, { eventType: "mission.chest_claimed" },
  { eventType: "xp.earned" }, { targetCount: 0 }, { targetCount: -1 }, { targetCount: 1.5 }, { targetCount: 2147483648 }, { targetCount: "2" },
  { sourceType: "SUBMISSION" }, { sourceType: "" }, { puzzleId: "bad-id" }, { levelId: 0 }, { levelId: -1 }, { levelId: 1.23 }, { levelId: 1000 },
  { conditions: { levelId: 1 } }, { conditions: { first: 1, nested: { unsupported: true } } }, { conditions: [] },
  { active: "false" }, { rewards: [{ rewardType: "XP", amount: 100 }] }, { expectedUpdatedAt: "invalid" }, { actorAdminUserId: "spoofed" },
])("rejects malformed, unsupported or out-of-range rule input %# without mutation/audit", async extra => {
  const created = await draft(); const before = await service.history(created.missionId, historyFilter);
  await expect(service.updateRule(created.missionId, input(created.updatedAt, extra), actorId, now)).rejects.toMatchObject({ code: "VALIDATION_FAILED", statusCode: 400 });
  expect((await service.detail(created.missionId)).rule).toBeNull();
  expect(await service.history(created.missionId, historyFilter)).toEqual(before);
});
it("validates actual CircZles IDs and level consistency without changing catalog data", async () => {
  const created = await draft();
  await expect(service.updateRule(created.missionId, input(created.updatedAt, { puzzleId: crypto.randomUUID() }), actorId, now)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  const [design] = await db.insert(s.puzzleDesigns).values({ name: "Synthetic rule design" }).returning();
  const [puzzle] = await db.insert(s.puzzles).values({ name: "Synthetic", puzzleDesignId: design.puzzleDesignId, levelId: 3.5 }).returning();
  await expect(service.updateRule(created.missionId, input(created.updatedAt, { puzzleId: puzzle.puzzleId, levelId: 1 }), actorId, now)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  const saved = await service.updateRule(created.missionId, input(created.updatedAt, { puzzleId: puzzle.puzzleId, levelId: 3.5 }), actorId, now);
  expect(saved.rule?.puzzleId).toBe(puzzle.puzzleId);
  expect((await db.select().from(s.puzzles).where(eq(s.puzzles.puzzleId, puzzle.puzzleId)))[0]).toEqual(puzzle);
});
it.each(["ACTIVE", "SCHEDULED", "ENDED"])("rejects editing an active definition with %s lifecycle", async lifecycle => {
  const [row] = await db.insert(s.missions).values({ title: "Synthetic", description: "", category: "DAILY", periodType: "DAILY", active: true,
    startsAt: lifecycle === "SCHEDULED" ? new Date(now.getTime() + 10000) : null, endsAt: lifecycle === "ENDED" ? new Date(now.getTime() - 1) : null }).returning();
  await expect(service.updateRule(row.missionId, input(row.updatedAt.toISOString()), actorId, now)).rejects.toMatchObject({ code: "MISSION_RULE_LOCKED", statusCode: 409 });
  expect((await service.history(row.missionId, historyFilter)).entries).toEqual([]);
});
it("rolls back rule creation, replacement and revision when audit insertion fails", async () => {
  const created = await draft(), missingActor = crypto.randomUUID();
  await expect(service.updateRule(created.missionId, input(created.updatedAt), missingActor, now)).rejects.toThrow();
  expect(await service.detail(created.missionId, now)).toEqual(created);
  const saved = await service.updateRule(created.missionId, input(created.updatedAt), actorId, now);
  const history = await service.history(created.missionId, historyFilter);
  await expect(service.updateRule(created.missionId, input(saved.updatedAt, { targetCount: 7 }), missingActor, now)).rejects.toThrow();
  expect(await service.detail(created.missionId, now)).toEqual(saved);
  expect(await service.history(created.missionId, historyFilter)).toEqual(history);
});
it("shares revision protection with metadata and accepts only one competing rule/metadata edit", async () => {
  const created = await draft();
  const results = await Promise.allSettled([
    service.updateRule(created.missionId, input(created.updatedAt), actorId, now),
    service.updateMetadata(created.missionId, { title: "Competing synthetic edit", description: "", displayOrder: 1, expectedUpdatedAt: created.updatedAt }, actorId, now),
  ]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "MISSION_REVISION_CONFLICT" } });
  expect((await service.history(created.missionId, historyFilter)).entries).toHaveLength(2);
});
it("rejects two competing rule revisions and records complete replacement snapshots", async () => {
  const created = await draft();
  const saved = await service.updateRule(created.missionId, input(created.updatedAt), actorId, now);
  const results = await Promise.allSettled([3, 4].map(targetCount => service.updateRule(created.missionId, input(saved.updatedAt, { targetCount, active: false }), actorId, now)));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "MISSION_REVISION_CONFLICT" } });
  const history = await service.history(created.missionId, historyFilter);
  expect(history.entries).toHaveLength(3);
  expect(history.entries[0].before?.rule).toEqual(saved.rule);
  expect(history.entries[0].after.rule?.active).toBe(false);
});
it("configured drafts remain absent from player assignment and cannot create claims or payouts", async () => {
  // The earlier fixtures include synthetic active definitions, so inspect only this draft.
  const created = await draft();
  await service.updateRule(created.missionId, input(created.updatedAt), actorId, now);
  const [user] = await db.insert(s.users).values({ verifiedEmail: "rules-player@example.test" }).returning();
  const [player] = await db.insert(s.players).values({ userId: user.userId, displayName: "Synthetic", publicPlayerId: "test_rules_player" }).returning();
  const repo = new DrizzleMissionRepository(db);
  // No worker is started and no game event is fabricated by configuration.
  expect((await repo.listForPlayer(player.playerId, now)).some(row => row.missionId === created.missionId)).toBe(false);
  await expect(new DrizzleMissionClaimRepository(db).claim({ playerId: player.playerId, missionId: created.missionId, idempotencyKey: crypto.randomUUID(), now })).rejects.toMatchObject({ code: "MISSION_NOT_CLAIMABLE" });
  for (const table of [s.gameEvents, s.playerMissionProgress, s.missionRewards, s.missionClaims, s.xpTransactions, s.pointTransactions]) expect(await db.select().from(table)).toEqual([]);
});
async function http(role?: "SUPER_ADMIN" | "REVIEWER", active = true, expired = false) {
  const [user] = await db.insert(s.users).values({ verifiedEmail: crypto.randomUUID() + "@example.test" }).returning();
  const [actor] = role ? await db.insert(s.adminUsers).values({ userId: user.userId, role, active }).returning() : [];
  const token = crypto.randomUUID();
  await db.insert(s.authSessions).values({ userId: user.userId, tokenHash: hashSessionToken(token, secret), expiresAt: new Date(Date.now() + (expired ? -60000 : 60000)) });
  const app = Fastify(); await app.register(cookie);
  app.setErrorHandler((error, _req, reply) => { if (error instanceof AppError) reply.code(error.statusCode).send({ code: error.code }); else reply.code(500).send({ code: "INTERNAL" }); });
  registerAdminMissionRoutes(app, { env: { NODE_ENV: "production", FRONTEND_ORIGIN: "https://hub.example.test", PLAYER_HUB_PROXY_SECRET: "synthetic-proxy-secret" } as Env,
    adminAuth: new AdminAuthorizationService(new DrizzleAdminAuthorizationRepository(db), secret), adminMissions: service });
  await app.ready(); return { app, actor, headers: { cookie: SESSION_COOKIE_NAME + "=" + token, origin: "https://hub.example.test", "x-player-hub-proxy-secret": "synthetic-proxy-secret" } };
}
it.each([[undefined, true, false, 403], ["REVIEWER", true, false, 403], ["SUPER_ADMIN", false, false, 403], ["SUPER_ADMIN", true, true, 401]] as const)("denies rule options and editing to unauthorized roles/sessions %#", async (role, active, expired, status) => {
  const { app, headers } = await http(role, active, expired);
  try {
    expect((await app.inject({ url: "/api/admin/missions/rule-options", headers })).statusCode).toBe(status);
    expect((await app.inject({ method: "PATCH", url: `/api/admin/missions/${crypto.randomUUID()}/rule`, headers, payload: input(now.toISOString()) })).statusCode).toBe(status);
  } finally { await app.close(); }
}, 15000);
it("authorizes rule edits independently, preserves proxy/origin protections and audits session identity", async () => {
  const { app, actor, headers } = await http("SUPER_ADMIN"), created = await draft();
  const url = `/api/admin/missions/${created.missionId}/rule`;
  try {
    const options = await app.inject({ url: "/api/admin/missions/rule-options", headers });
    expect(options.statusCode).toBe(200); expect(options.json()).toEqual({ options: adminMissionRuleOptions }); expect(options.headers["cache-control"]).toBe("private, no-store");
    expect((await app.inject({ method: "PATCH", url, payload: input(created.updatedAt) })).statusCode).toBe(401);
    for (const invalidHeaders of [{ cookie: headers.cookie }, { ...headers, origin: "https://evil.test" }, { ...headers, "sec-fetch-site": "cross-site" }]) expect((await app.inject({ method: "PATCH", url, headers: invalidHeaders, payload: input(created.updatedAt) })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url, headers, payload: input(created.updatedAt, { unexpected: true }) })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/api/admin/missions/bad/rule", headers, payload: input(created.updatedAt) })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/api/admin/missions/${crypto.randomUUID()}/rule`, headers, payload: input(created.updatedAt) })).statusCode).toBe(404);
    const response = await app.inject({ method: "PATCH", url, headers, payload: input(created.updatedAt) });
    expect(response.statusCode).toBe(200); expect(response.json().active).toBe(false); expect(response.headers["cache-control"]).toBe("private, no-store");
    expect((await service.history(created.missionId, historyFilter)).entries[0].actorAdminUserId).toBe(actor?.adminUserId);
    expect((await app.inject({ method: "PATCH", url, headers, payload: input(created.updatedAt) })).statusCode).toBe(409);
    await expect(db.update(missionAdminHistory).set({ action: "RULE_CONFIGURED" }).where(eq(missionAdminHistory.missionId, created.missionId))).rejects.toThrow();
  } finally { await app.close(); }
}, 15000);
