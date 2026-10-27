import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { beforeAll, afterAll, expect, it } from "vitest";
import type { Database } from "../src/db/client.js";
import * as s from "../src/db/schema.js";
import * as c from "../src/db/missionChestSchema.js";
import { missionAdminHistory } from "../src/db/missionAdminSchema.js";
import { AdminMissionService } from "../src/domain/adminMissions.js";
import { parseAdminMissionSchedule } from "../src/domain/adminMissionScheduling.js";
import { claimDeadlineFor, freezeRewards, periodBounds, periodKeyFor } from "../src/domain/missionLifecycle.js";
import { isMissionVisibleAt, missionMatchesEvent } from "../src/domain/missions.js";
import { AdminAuthorizationService, DrizzleAdminAuthorizationRepository } from "../src/domain/adminAuth.js";
import { hashSessionToken, SESSION_COOKIE_NAME } from "../src/domain/sessions.js";
import { AppError } from "../src/domain/errors.js";
import type { Env } from "../src/config/env.js";
import { registerAdminMissionRoutes } from "../src/http/adminMissionRoutes.js";
import type { AdminMissionScheduleInput } from "../../src/types/adminMissions.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const contractMatches: Equal<ReturnType<typeof parseAdminMissionSchedule>, AdminMissionScheduleInput> = true;
let pg: PGlite, db: Database, service: AdminMissionService, actorId: string;
const now = new Date("2030-02-10T12:00:00Z"), secret = "synthetic-admin-schedule-session-secret-at-least-32";
const historyFilter = { limit: 100, offset: 0 };
const draft = (category = "DAILY") => service.createDraft({ title: "Synthetic schedule " + crypto.randomUUID(), description: "", category, displayOrder: 0 }, actorId, now);
const input = (revision: string, extra: Record<string, unknown> = {}) => ({ startsAt: "2030-02-11T00:00:00Z", endsAt: "2030-02-12T00:00:00Z", claimDeadline: null, expectedUpdatedAt: revision, ...extra });
beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql")).sort()) await pg.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  db = drizzle(pg, { schema: s }) as unknown as Database; service = new AdminMissionService(db);
  const [user] = await db.insert(s.users).values({ verifiedEmail: "schedule-actor@example.test" }).returning();
  const [actor] = await db.insert(s.adminUsers).values({ userId: user.userId, role: "SUPER_ADMIN" }).returning(); actorId = actor.adminUserId;
}, 60000);
afterAll(async () => { await pg.close(); });

it("keeps the frontend schedule payload aligned with the strict backend contract", () => expect(contractMatches).toBe(true));
it.each(["DAILY", "WEEKLY", "ACHIEVEMENT", "SPRINT", "SEASON", "EVENT"])("configures existing %s scheduling without changing category, cutoff, activation or rewards", async category => {
  const created = await draft(category);
  const saved = await service.updateSchedule(created.missionId, input(created.updatedAt), actorId, now);
  expect(saved).toMatchObject({ category, periodType: created.periodType, active: false, lifecycle: "INACTIVE", rule: null, rewards: [], startsAt: "2030-02-11T00:00:00.000Z", endsAt: "2030-02-12T00:00:00.000Z", claimDeadline: null, activationEffectiveAt: created.activationEffectiveAt });
  const entry = (await service.history(created.missionId, historyFilter)).entries[0];
  expect(entry).toMatchObject({ actorAdminUserId: actorId, action: "SCHEDULE_CONFIGURED", occurredAt: now.toISOString(), before: { schedule: { startsAt: null, endsAt: null, claimDeadline: null, activationEffectiveAt: created.activationEffectiveAt } }, after: { schedule: { startsAt: saved.startsAt, endsAt: saved.endsAt, claimDeadline: null, activationEffectiveAt: created.activationEffectiveAt }, updatedAt: saved.updatedAt, active: false } });
  for (const at of ["2030-02-10T12:00:00Z", "2030-02-11T00:00:00Z", "2030-02-13T00:00:00Z"]) expect((await service.detail(created.missionId, new Date(at))).lifecycle).toBe("INACTIVE");
});
it.each([
  { startsAt: "2030-02-30T00:00:00Z" }, { endsAt: "2030-02-12" }, { startsAt: "2030-02-11T00:00:00" },
  { startsAt: "2030-02-11T05:30:00+05:30" }, { startsAt: "2030-02-11T00:00:00.0001Z" }, { startsAt: "2030-02-11T24:00:00Z" },
  { startsAt: "0000-01-01T00:00:00Z" }, { startsAt: 1896998400000 }, { startsAt: {} }, { startsAt: "" }, { startsAt: undefined },
  { endsAt: "2030-02-11T00:00:00Z" }, { endsAt: "2030-02-10T23:59:59Z" },
  { startsAt: null, endsAt: "2030-02-10T12:00:00Z" },
  { claimDeadline: "2030-02-13T00:00:00Z" }, { claimDeadline: [] }, { expectedUpdatedAt: "bad" },
  { active: true }, { activationEffectiveAt: "2030-01-01T00:00:00Z" }, { timezone: "Asia/Kolkata" }, { recurrence: "HOURLY" },
  { periodType: "FIXED" }, { category: "EVENT" }, { rewards: [{ rewardType: "XP", amount: 1 }] }, { actorAdminUserId: "spoofed" },
])("rejects invalid dates, unsupported schedules or contradictory input %# without changing history", async extra => {
  const created = await draft(); const history = await service.history(created.missionId, historyFilter);
  await expect(service.updateSchedule(created.missionId, input(created.updatedAt, extra), actorId, now)).rejects.toMatchObject({ code: "VALIDATION_FAILED", statusCode: 400 });
  expect(await service.detail(created.missionId, now)).toEqual(created);
  expect(await service.history(created.missionId, historyFilter)).toEqual(history);
});
it.each(["SPRINT", "SEASON", "EVENT"])("requires both UTC endpoints for %s fixed campaigns", async category => {
  const created = await draft(category);
  for (const extra of [{ startsAt: null }, { endsAt: null }, { startsAt: null, endsAt: null }]) await expect(service.updateSchedule(created.missionId, input(created.updatedAt, extra), actorId, now)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});
it.each(["DAILY", "WEEKLY", "ACHIEVEMENT"])("supports optional/open windows for %s under existing M1 contracts", async category => {
  const created = await draft(category);
  const first = await service.updateSchedule(created.missionId, input(created.updatedAt, { startsAt: null }), actorId, now);
  expect(first.startsAt).toBeNull();
  const second = await service.updateSchedule(created.missionId, input(first.updatedAt, { endsAt: null }), actorId, now);
  expect(second.endsAt).toBeNull();
  const cleared = await service.updateSchedule(created.missionId, input(second.updatedAt, { startsAt: null, endsAt: null }), actorId, now);
  expect(cleared.startsAt).toBeNull(); expect(cleared.endsAt).toBeNull();
});
it.each(["SPRINT", "SEASON", "EVENT", "ACHIEVEMENT"])("accepts an explicit %s deadline at availability end, rejects earlier and impossible deadlines", async category => {
  const created = await draft(category);
  for (const extra of [{ claimDeadline: "2030-02-11T12:00:00Z" }, { startsAt: null, endsAt: null, claimDeadline: now.toISOString() }]) await expect(service.updateSchedule(created.missionId, input(created.updatedAt, extra), actorId, now)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  const saved = await service.updateSchedule(created.missionId, input(created.updatedAt, { claimDeadline: "2030-02-12T00:00:00Z" }), actorId, now);
  expect(saved.claimDeadline).toBe(saved.endsAt);
  expect(claimDeadlineFor(saved.periodType as "LIFETIME" | "FIXED", new Date(saved.endsAt!), new Date(saved.claimDeadline!))?.toISOString()).toBe(saved.endsAt);
});
it("lifetime deadline must follow the window start even without an availability end", async () => {
  const created = await draft("ACHIEVEMENT");
  await expect(service.updateSchedule(created.missionId, input(created.updatedAt, { endsAt: null, claimDeadline: "2030-02-11T00:00:00Z" }), actorId, now)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  const saved = await service.updateSchedule(created.missionId, input(created.updatedAt, { endsAt: null, claimDeadline: "2030-02-11T00:00:00.001Z" }), actorId, now);
  expect(saved.claimDeadline).toBe("2030-02-11T00:00:00.001Z");
});
it.each(["DAILY", "WEEKLY"] as const)("keeps %s UTC period boundaries/grace independent of availability, DST or machine timezone", async type => {
  const created = await draft(type);
  const saved = await service.updateSchedule(created.missionId, input(created.updatedAt, { startsAt: "2030-03-10T08:15:00Z", endsAt: "2030-03-10T09:15:00Z" }), actorId, now);
  const key = periodKeyFor(type, new Date(saved.startsAt!), saved.missionId);
  const bounds = periodBounds(type, key, saved.missionId, new Date(saved.startsAt!), new Date(saved.endsAt!));
  expect(bounds.start?.toISOString()).toBe(type === "DAILY" ? "2030-03-10T00:00:00.000Z" : "2030-03-04T00:00:00.000Z");
  expect(bounds.end?.toISOString()).toBe(type === "DAILY" ? "2030-03-11T00:00:00.000Z" : "2030-03-11T00:00:00.000Z");
  expect(claimDeadlineFor(type, bounds.end, null)?.toISOString()).toBe("2030-03-12T00:00:00.000Z");
  expect(bounds.end!.getTime() - bounds.start!.getTime()).toBe((type === "DAILY" ? 1 : 7) * 86400000);
  await expect(service.updateSchedule(created.missionId, input(saved.updatedAt, { claimDeadline: "2030-03-12T00:00:00Z" }), actorId, now)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});
it("preserves M1 inclusive start, exclusive end and ISO year rollover without running a worker", async () => {
  const created = await draft("EVENT");
  const saved = await service.updateSchedule(created.missionId, input(created.updatedAt, { startsAt: "2030-12-31T23:59:59.999Z", endsAt: "2031-01-01T00:00:00Z" }), actorId, now);
  const window = { startsAt: new Date(saved.startsAt!), endsAt: new Date(saved.endsAt!) };
  const rule = { eventType: "puzzle.added", sourceType: null, puzzleId: null, levelId: null, conditions: {} };
  for (const [at, expected] of [["2030-12-31T23:59:59.998Z", false], [saved.startsAt!, true], [saved.endsAt!, false]] as const) expect(missionMatchesEvent({ eventType: "puzzle.added", sourceType: "PUZZLE_CLAIM", payload: {}, createdAt: new Date(at) }, window, rule)).toBe(expected);
  expect(isMissionVisibleAt({ ...window, active: false }, window.startsAt)).toBe(false);
  expect(periodKeyFor("DAILY", window.endsAt, saved.missionId)).toBe("2031-01-01");
  expect(periodKeyFor("WEEKLY", window.startsAt, saved.missionId)).toBe("2031-W01");
  const bounds = periodBounds("WEEKLY", "2031-W01", saved.missionId);
  expect(bounds.start?.toISOString()).toBe("2030-12-30T00:00:00.000Z");
  expect(bounds.end?.toISOString()).toBe("2031-01-06T00:00:00.000Z");
});
it("normalizes milliseconds, accepts leap days and ignores equivalent no-op schedules", async () => {
  const created = await draft();
  const saved = await service.updateSchedule(created.missionId, input(created.updatedAt, { startsAt: "2032-02-29T12:00:00.1Z", endsAt: "2032-03-01T00:00:00Z" }), actorId, now);
  expect(saved.startsAt).toBe("2032-02-29T12:00:00.100Z");
  const history = await service.history(created.missionId, historyFilter);
  const same = await service.updateSchedule(created.missionId, input(saved.updatedAt, { startsAt: saved.startsAt, endsAt: saved.endsAt }), actorId, now);
  expect(same.updatedAt).toBe(saved.updatedAt); expect(await service.history(created.missionId, historyFilter)).toEqual(history);
});
it.each(["ACTIVE", "SCHEDULED", "ENDED"])("refuses schedule edits for active definitions with %s lifecycle", async lifecycle => {
  const [row] = await db.insert(s.missions).values({ title: "Synthetic active", description: "", category: "DAILY", periodType: "DAILY", active: true, activationEffectiveAt: now,
    startsAt: lifecycle === "SCHEDULED" ? new Date("2031-01-01Z") : null, endsAt: lifecycle === "ENDED" ? new Date("2030-02-10T11:00:00Z") : null }).returning();
  await expect(service.updateSchedule(row.missionId, input(row.updatedAt.toISOString()), actorId, now)).rejects.toMatchObject({ code: "MISSION_SCHEDULE_LOCKED", statusCode: 409 });
  expect((await service.history(row.missionId, historyFilter)).entries).toEqual([]);
});
it("rolls back both initial/replacement schedule and revision if the audit write fails", async () => {
  const created = await draft(), missingActor = crypto.randomUUID();
  await expect(service.updateSchedule(created.missionId, input(created.updatedAt), missingActor, now)).rejects.toThrow();
  expect(await service.detail(created.missionId, now)).toEqual(created);
  const saved = await service.updateSchedule(created.missionId, input(created.updatedAt), actorId, now);
  const history = await service.history(created.missionId, historyFilter);
  await expect(service.updateSchedule(created.missionId, input(saved.updatedAt, { endsAt: "2030-02-13T00:00:00Z" }), missingActor, now)).rejects.toThrow();
  expect(await service.detail(created.missionId, now)).toEqual(saved); expect(await service.history(created.missionId, historyFilter)).toEqual(history);
});
it.each(["schedule", "metadata", "rule"])("serializes scheduling against a competing %s revision", async competing => {
  const created = await draft();
  const second = () => competing === "schedule" ? service.updateSchedule(created.missionId, input(created.updatedAt, { endsAt: "2030-02-13T00:00:00Z" }), actorId, now)
    : competing === "metadata" ? service.updateMetadata(created.missionId, { title: "Concurrent metadata", description: "", displayOrder: 1, expectedUpdatedAt: created.updatedAt }, actorId, now)
      : service.updateRule(created.missionId, { eventType: "puzzle.added", targetCount: 1, sourceType: null, puzzleId: null, levelId: null, conditions: {}, active: false, expectedUpdatedAt: created.updatedAt }, actorId, now);
  const result = await Promise.allSettled([service.updateSchedule(created.missionId, input(created.updatedAt), actorId, now), second()]);
  expect(result.filter(row => row.status === "fulfilled")).toHaveLength(1);
  expect(result.find(row => row.status === "rejected")).toMatchObject({ reason: { code: "MISSION_REVISION_CONFLICT" } });
  expect((await service.history(created.missionId, historyFilter)).entries).toHaveLength(2);
});
it("does not alter synthetic earned mission/chest snapshots, eligibility, cutoff or ledgers", async () => {
  const created = await draft();
  const [user] = await db.insert(s.users).values({ verifiedEmail: "schedule-synthetic-player@example.test" }).returning();
  const [player] = await db.insert(s.players).values({ userId: user.userId, displayName: "Synthetic schedule" }).returning();
  const reward = freezeRewards([{ rewardType: "XP", amount: 1 }]); // Synthetic snapshot, never paid.
  const [progress] = await db.insert(s.playerMissionProgress).values({ playerId: player.playerId, missionId: created.missionId, periodKey: "2030-02-10", targetCountSnapshot: 1, currentCount: 1, status: "CLAIMABLE", completedAt: now, periodStartsAt: new Date("2030-02-10Z"), periodEndsAt: new Date("2030-02-11Z"), claimDeadline: new Date("2030-02-12Z"), rewardSnapshot: reward }).returning();
  const [chest] = await db.insert(c.missionChests).values({ title: "Synthetic inactive chest", periodType: "DAILY", targetCount: 1, rewards: reward, active: false }).returning();
  const [eligibility] = await db.insert(c.missionChestEligibility).values({ chestId: chest.chestId, missionId: created.missionId, active: false }).returning();
  const [state] = await db.insert(c.playerMissionChests).values({ playerId: player.playerId, chestId: chest.chestId, periodKey: "2030-02-10", targetCountSnapshot: 1, currentCount: 1, periodStartsAt: progress.periodStartsAt!, periodEndsAt: progress.periodEndsAt!, claimDeadline: progress.claimDeadline!, rewardSnapshot: reward, unlockedAt: now }).returning();
  const saved = await service.updateSchedule(created.missionId, input(created.updatedAt), actorId, now);
  expect(saved.activationEffectiveAt).toBe(created.activationEffectiveAt); expect(saved.active).toBe(false); expect(saved.rewards).toEqual([]);
  expect((await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.missionId, created.missionId)))[0]).toEqual(progress);
  expect((await db.select().from(c.missionChests).where(eq(c.missionChests.chestId, chest.chestId)))[0]).toEqual(chest);
  expect((await db.select().from(c.missionChestEligibility).where(eq(c.missionChestEligibility.eligibilityId, eligibility.eligibilityId)))[0]).toEqual(eligibility);
  expect((await db.select().from(c.playerMissionChests).where(eq(c.playerMissionChests.playerChestId, state.playerChestId)))[0]).toEqual(state);
  for (const table of [s.gameEvents, s.missionRewards, s.missionClaims, s.xpTransactions, s.pointTransactions, c.missionChestClaims]) expect(await db.select().from(table)).toEqual([]);
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
it.each([[undefined, true, false, 403], ["REVIEWER", true, false, 403], ["SUPER_ADMIN", false, false, 403], ["SUPER_ADMIN", true, true, 401]] as const)("denies schedule edits to unauthorized roles/sessions %#", async (role, active, expired, status) => {
  const { app, headers } = await http(role, active, expired);
  try { expect((await app.inject({ method: "PATCH", url: `/api/admin/missions/${crypto.randomUUID()}/schedule`, headers, payload: input(now.toISOString()) })).statusCode).toBe(status); }
  finally { await app.close(); }
}, 15000);
it("enforces API authentication, origin/proxy, validation and revision checks and records the session actor", async () => {
  const { app, actor, headers } = await http("SUPER_ADMIN"), created = await draft(); const url = `/api/admin/missions/${created.missionId}/schedule`;
  try {
    expect((await app.inject({ method: "PATCH", url, payload: input(created.updatedAt) })).statusCode).toBe(401);
    for (const invalidHeaders of [{ cookie: headers.cookie }, { ...headers, origin: "https://evil.test" }, { ...headers, "sec-fetch-site": "cross-site" }]) expect((await app.inject({ method: "PATCH", url, headers: invalidHeaders, payload: input(created.updatedAt) })).statusCode).toBe(403);
    for (const payload of [null, [], {}, input(created.updatedAt, { active: true }), input(created.updatedAt, { startsAt: "2030-02-30T00:00:00Z" })]) expect((await app.inject({ method: "PATCH", url, headers: { ...headers, "content-type": "application/json" }, payload: JSON.stringify(payload) })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/api/admin/missions/bad/schedule", headers, payload: input(created.updatedAt) })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/api/admin/missions/${crypto.randomUUID()}/schedule`, headers, payload: input(created.updatedAt) })).statusCode).toBe(404);
    const response = await app.inject({ method: "PATCH", url, headers, payload: input(created.updatedAt) });
    expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("private, no-store"); expect(response.json().active).toBe(false);
    expect((await service.history(created.missionId, historyFilter)).entries[0].actorAdminUserId).toBe(actor?.adminUserId);
    expect((await app.inject({ method: "PATCH", url, headers, payload: input(created.updatedAt) })).statusCode).toBe(409);
    await expect(db.update(missionAdminHistory).set({ action: "SCHEDULE_CONFIGURED" }).where(eq(missionAdminHistory.missionId, created.missionId))).rejects.toThrow();
  } finally { await app.close(); }
}, 15000);
it("migration 0029 preserves 0028 metadata/rule history and append-only protection", async () => {
  const isolated = new PGlite();
  try {
    for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql") && Number(file.slice(0, 4)) <= 28).sort()) await isolated.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
    const local = drizzle(isolated, { schema: s }) as unknown as Database; const admin = new AdminMissionService(local);
    const [user] = await local.insert(s.users).values({ verifiedEmail: "schedule-upgrade@example.test" }).returning();
    const [actor] = await local.insert(s.adminUsers).values({ userId: user.userId, role: "SUPER_ADMIN" }).returning();
    const created = await admin.createDraft({ title: "Existing 0028", description: "", category: "DAILY", displayOrder: 0 }, actor.adminUserId, now);
    const rule = await admin.updateRule(created.missionId, { eventType: "puzzle.added", targetCount: 1, sourceType: null, puzzleId: null, levelId: null, conditions: {}, active: false, expectedUpdatedAt: created.updatedAt }, actor.adminUserId, now);
    const before = await admin.history(created.missionId, historyFilter);
    await isolated.exec("BEGIN;\n" + await readFile(new URL("../drizzle/0029_mission_admin_schedule_history.sql", import.meta.url), "utf8") + "\nCOMMIT;");
    expect(await admin.history(created.missionId, historyFilter)).toEqual(before);
    await admin.updateSchedule(created.missionId, input(rule.updatedAt), actor.adminUserId, now);
    expect((await admin.history(created.missionId, historyFilter)).entries.map(row => row.action)).toEqual(["SCHEDULE_CONFIGURED", "RULE_CONFIGURED", "DRAFT_CREATED"]);
    await expect(isolated.exec("DELETE FROM mission_admin_history")).rejects.toThrow(/append-only/);
    await expect(isolated.exec("TRUNCATE mission_admin_history")).rejects.toThrow(/append-only/);
  } finally { await isolated.close(); }
}, 30000);
