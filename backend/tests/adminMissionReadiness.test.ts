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
import { AdminMissionService } from "../src/domain/adminMissions.js";
import type { AdminMissionReadinessDto } from "../src/domain/adminMissionReadiness.js";
import { freezeRewards } from "../src/domain/missionLifecycle.js";
import { AdminAuthorizationService, DrizzleAdminAuthorizationRepository } from "../src/domain/adminAuth.js";
import { hashSessionToken, SESSION_COOKIE_NAME } from "../src/domain/sessions.js";
import { AppError } from "../src/domain/errors.js";
import type { Env } from "../src/config/env.js";
import { registerAdminMissionRoutes } from "../src/http/adminMissionRoutes.js";
import type { AdminMissionReadinessDto as FrontendReadiness } from "../../src/types/adminMissions.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const contractMatches: Equal<AdminMissionReadinessDto, FrontendReadiness> = true;
let pg: PGlite, db: Database, service: AdminMissionService, actorId: string;
const now = new Date("2030-02-10T12:00:00Z"), secret = "synthetic-readiness-session-secret-at-least-32";
let queries: string[] = [];
const item = (result: AdminMissionReadinessDto, code: string) => result.checks.find(check => check.code === code);
const draft = () => service.createDraft({ title: "Synthetic readiness " + crypto.randomUUID(), description: "", category: "DAILY", displayOrder: 0 }, actorId, now);
async function configured(extra: Partial<typeof s.missions.$inferInsert> = {}) {
  const [row] = await db.insert(s.missions).values({ title: "Synthetic readiness " + crypto.randomUUID(), description: "", category: "DAILY", periodType: "DAILY", active: false, activationEffectiveAt: now, updatedAt: now, ...extra }).returning();
  await db.insert(s.missionRules).values({ missionId: row.missionId, eventType: "puzzle.added", targetCount: 1, conditions: {} });
  await db.insert(s.missionRewards).values({ missionId: row.missionId, rewardType: "XP", amount: 1 });
  return row;
}
beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql")).sort()) await pg.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  db = drizzle(pg, { schema: s, logger: { logQuery(query) { queries.push(query); } } }) as unknown as Database;
  service = new AdminMissionService(db);
  const [user] = await db.insert(s.users).values({ verifiedEmail: "readiness-actor@example.test" }).returning();
  const [actor] = await db.insert(s.adminUsers).values({ userId: user.userId, role: "SUPER_ADMIN" }).returning(); actorId = actor.adminUserId;
}, 60000);
afterAll(async () => { await pg.close(); });

it("reports incomplete drafts explicitly, returns revision and never fabricates product approval", async () => {
  expect(contractMatches).toBe(true);
  const created = await draft(), result = await service.readiness(created.missionId, now);
  expect(result).toMatchObject({ missionId: created.missionId, missionRevision: created.updatedAt, evaluatedAt: now.toISOString(), activationReady: false, productApproval: "NOT_RECORDED", configurationStatus: "BLOCKED", overallStatus: "BLOCKED", rewardSafety: { xp: null, synapsePoints: null, balancesInspected: false } });
  for (const code of ["RULE_MISSING", "REWARDS_VALID", "REWARD_BUDGET_APPROVAL_MISSING", "MISSION_PRODUCT_APPROVAL_MISSING"]) expect(item(result, code)?.status).toBe("BLOCKED");
  expect(item(result, "MISSION_INACTIVE")?.status).toBe("PASS");
  expect(new Set(result.checks.map(check => check.code)).size).toBe(result.checks.length);
  expect(result.checks.every(check => check.code && check.field && check.message)).toBe(true);
});
it.each(["puzzle.added", "submission.created", "submission.approved", "submission.rejected", "submission.resubmission_required", "personal_best.improved"])("distinguishes valid %s configuration from safety/product approval", async eventType => {
  const row = await configured(); await db.update(s.missionRules).set({ eventType }).where(eq(s.missionRules.missionId, row.missionId));
  const result = await service.readiness(row.missionId, now);
  expect(result.configurationStatus).toBe("PASS"); expect(result.overallStatus).toBe("BLOCKED"); expect(result.activationReady).toBe(false);
  for (const code of ["RULE_ENABLED", "RULE_M1_VALID", "RULE_EVENT_SUPPORTED", "RULE_PARAMETERS_VALID", "REWARDS_VALID", "SP_INTEGER_OVERFLOW_EXPOSURE"]) expect(item(result, code)?.status).toBe("PASS");
  expect(item(result, "XP_PRECISION_EXPOSURE")?.status).toBe("WARNING");
  expect(item(result, "REWARD_BUDGET_APPROVAL_MISSING")?.category).toBe("PRODUCT");
});
it.each(["invented.event", "mission.completed", "mission.claimed", "mission.chest_claimed", "xp.earned"])("blocks unsupported or unreviewed event %s", async eventType => {
  const row = await configured(); await db.update(s.missionRules).set({ eventType }).where(eq(s.missionRules.missionId, row.missionId));
  expect(item(await service.readiness(row.missionId, now), "RULE_EVENT_SUPPORTED")?.status).toBe("BLOCKED");
});
it("blocks a disabled rule and a source filter incompatible with its actual emitter", async () => {
  const row = await configured(); await db.update(s.missionRules).set({ active: false, sourceType: "SUBMISSION" }).where(eq(s.missionRules.missionId, row.missionId));
  const result = await service.readiness(row.missionId, now);
  expect(item(result, "RULE_ENABLED")?.status).toBe("BLOCKED"); expect(item(result, "RULE_PARAMETERS_VALID")?.status).toBe("BLOCKED");
});
it.each([{ brand: "CircZles" }, { first: 1, nested: { invalid: true } }, [], null])("blocks advanced/malformed conditions independently of M1 short-circuit validation %#", async conditions => {
  const row = await configured();
  await pg.query("UPDATE mission_rules SET conditions=$1::jsonb WHERE mission_id=$2", [JSON.stringify(conditions), row.missionId]);
  const result = await service.readiness(row.missionId, now);
  expect(item(result, "ADVANCED_CONDITIONS_UNSUPPORTED")?.status).toBe("BLOCKED"); expect(result.configurationStatus).toBe("BLOCKED");
});
it("validates canonical puzzle/level filters against active persisted catalog data", async () => {
  const row = await configured();
  const [design] = await db.insert(s.puzzleDesigns).values({ name: "Synthetic readiness design" }).returning();
  const [puzzle] = await db.insert(s.puzzles).values({ name: "Synthetic readiness", puzzleDesignId: design.puzzleDesignId, levelId: 3.5 }).returning();
  await db.update(s.missionRules).set({ puzzleId: puzzle.puzzleId, levelId: 1 }).where(eq(s.missionRules.missionId, row.missionId));
  expect(item(await service.readiness(row.missionId, now), "RULE_FILTER_RESOLVES")?.status).toBe("BLOCKED");
  await db.update(s.missionRules).set({ levelId: 3.5 }).where(eq(s.missionRules.missionId, row.missionId));
  expect(item(await service.readiness(row.missionId, now), "RULE_FILTER_RESOLVES")?.status).toBe("PASS");
  await db.update(s.puzzleDesigns).set({ status: "DRAFT" }).where(eq(s.puzzleDesigns.puzzleDesignId, design.puzzleDesignId));
  expect(item(await service.readiness(row.missionId, now), "RULE_FILTER_RESOLVES")?.status).toBe("BLOCKED");
  await db.update(s.missionRules).set({ puzzleId: null, levelId: 999.9 }).where(eq(s.missionRules.missionId, row.missionId));
  expect(item(await service.readiness(row.missionId, now), "RULE_FILTER_RESOLVES")?.status).toBe("BLOCKED");
});
it.each([
  [{ category: "EVENT", periodType: "FIXED" }, "SCHEDULE_VALID"],
  [{ category: "DAILY", periodType: "LIFETIME" }, "LIFECYCLE_VALID"],
  [{ title: " " }, "METADATA_VALID"],
  [{ claimDeadline: new Date("2030-02-12Z") }, "SCHEDULE_VALID"],
  [{ startsAt: new Date("2030-02-09Z"), endsAt: now }, "AVAILABILITY_NOT_EXPIRED"],
  [{ endsAt: new Date("2030-02-10T11:00:00Z") }, "SCHEDULE_VALID"],
  [{ category: "ACHIEVEMENT", periodType: "LIFETIME", claimDeadline: now }, "CLAIM_DEADLINE_NOT_EXPIRED"],
  [{ category: "EVENT", periodType: "FIXED", startsAt: new Date("2030-02-11Z"), endsAt: new Date("2030-02-12Z"), claimDeadline: new Date("2030-02-11T12:00:00Z") }, "SCHEDULE_VALID"],
] as const)("blocks stored lifecycle, schedule and deadline conflicts %#", async (extra, code) => {
  const row = await configured(extra);
  expect(item(await service.readiness(row.missionId, now), code)?.status).toBe("BLOCKED");
});
it("treats future UTC windows as advisory and open lifetime claim liability as an unapproved decision", async () => {
  const row = await configured({ startsAt: new Date("2030-02-11Z"), endsAt: new Date("2030-02-12Z") });
  const future = await service.readiness(row.missionId, now);
  expect(item(future, "FUTURE_EVENT_WINDOW")?.status).toBe("WARNING"); expect(item(future, "UTC_PERIOD_CONTRACT")?.status).toBe("PASS");
  const lifetime = await configured({ category: "ACHIEVEMENT", periodType: "LIFETIME" });
  const open = await service.readiness(lifetime.missionId, now);
  expect(open.configurationStatus).toBe("PASS"); expect(item(open, "OPEN_CLAIM_WINDOW_UNAPPROVED")?.status).toBe("BLOCKED");
});
it("rejects persisted non-finite scheduling dates as a structured blocker", async () => {
  const row = await configured(); await pg.query("UPDATE missions SET ends_at='infinity'::timestamptz WHERE mission_id=$1", [row.missionId]);
  expect(item(await service.readiness(row.missionId, now), "SCHEDULE_VALID")?.status).toBe("BLOCKED");
});
it.each(["disabled", "unsupported", "aggregate_overflow"])("blocks persisted invalid reward configuration %s", async kind => {
  const row = await configured();
  if (kind === "disabled") await db.update(s.missionRewards).set({ active: false }).where(eq(s.missionRewards.missionId, row.missionId));
  else if (kind === "unsupported") await db.update(s.missionRewards).set({ rewardType: "COSMETIC" }).where(eq(s.missionRewards.missionId, row.missionId));
  else await db.insert(s.missionRewards).values({ missionId: row.missionId, rewardType: "XP", amount: 2147483647 });
  const result = await service.readiness(row.missionId, now);
  expect(item(result, "REWARDS_VALID")?.status).toBe("BLOCKED"); expect(result.rewardSafety.xp).toBeNull(); expect(result.rewardSafety.synapsePoints).toBeNull();
});
it.each([1, 2147483647])("reports guarded SP overflow exposure for amount %s without querying balances", async amount => {
  const row = await configured(); await db.update(s.missionRewards).set({ rewardType: "SYNAPSE_POINTS", amount }).where(eq(s.missionRewards.missionId, row.missionId));
  queries = []; const result = await service.readiness(row.missionId, now);
  expect(result.configurationStatus).toBe("PASS"); expect(item(result, "SP_INTEGER_OVERFLOW_EXPOSURE")?.status).toBe("WARNING");
  expect(result.rewardSafety).toMatchObject({ xp: 0, synapsePoints: amount, spWalletLimit: 2147483647, maximumSafeSpBalance: 2147483647 - amount, maximumSafeXpTotal: null, balancesInspected: false });
  expect(item(result, "XP_PRECISION_EXPOSURE")?.status).toBe("PASS");
  expect(queries.some(query => /"wallets"|"players"|"player_progression"|"point_transactions"|"xp_transactions"/.test(query))).toBe(false);
});
it("blocks disabled unsupported reward types as outside reviewed builder scope", async () => {
  const row = await configured(); await db.insert(s.missionRewards).values({ missionId: row.missionId, rewardType: "INVENTORY", amount: 1, active: false });
  const result = await service.readiness(row.missionId, now);
  expect(item(result, "REWARDS_VALID")?.status).toBe("PASS"); expect(item(result, "REWARD_TYPES_UNSUPPORTED")?.status).toBe("BLOCKED");
});
it("requires chest eligibility review without changing any chest setting", async () => {
  const row = await configured();
  const [chest] = await db.insert(c.missionChests).values({ title: "Synthetic inactive chest", periodType: "DAILY", targetCount: 1, active: false, rewards: freezeRewards([{ rewardType: "XP", amount: 1 }]) }).returning();
  const [link] = await db.insert(c.missionChestEligibility).values({ chestId: chest.chestId, missionId: row.missionId, active: true }).returning();
  expect(item(await service.readiness(row.missionId, now), "CHEST_LINK_REVIEW")?.status).toBe("BLOCKED");
  expect((await db.select().from(c.missionChestEligibility).where(eq(c.missionChestEligibility.eligibilityId, link.eligibilityId)))[0]).toEqual(link);
});
it.each(["ACTIVE", "SCHEDULED", "ENDED"])("reports active %s definitions as blocked without deactivation", async lifecycle => {
  const row = await configured({ active: true, startsAt: lifecycle === "SCHEDULED" ? new Date("2030-02-11Z") : null, endsAt: lifecycle === "ENDED" ? now : null });
  expect(item(await service.readiness(row.missionId, now), "MISSION_INACTIVE")?.status).toBe("BLOCKED");
  expect((await db.select().from(s.missions).where(eq(s.missions.missionId, row.missionId)))[0]).toEqual(row);
});
it.each(["metadata", "rule", "schedule", "rewards"])("returns the current revision after a persisted %s edit; no edit constitutes approval", async kind => {
  const row = await configured(); const first = await service.readiness(row.missionId, now);
  const expectedUpdatedAt = first.missionRevision;
  if (kind === "metadata") await service.updateMetadata(row.missionId, { title: "Explicit new synthetic label", description: "", displayOrder: 1, expectedUpdatedAt }, actorId, now);
  if (kind === "rule") await service.updateRule(row.missionId, { eventType: "puzzle.added", targetCount: 2, sourceType: null, puzzleId: null, levelId: null, conditions: {}, active: true, expectedUpdatedAt }, actorId, now);
  if (kind === "schedule") await service.updateSchedule(row.missionId, { startsAt: "2030-02-11T00:00:00Z", endsAt: null, claimDeadline: null, expectedUpdatedAt }, actorId, now);
  if (kind === "rewards") await service.updateRewards(row.missionId, { xp: 2, synapsePoints: null, expectedUpdatedAt }, actorId, now);
  const next = await service.readiness(row.missionId, now);
  expect(next.missionRevision).not.toBe(first.missionRevision); expect(next.productApproval).toBe("NOT_RECORDED"); expect(next.activationReady).toBe(false);
});
async function snapshot() {
  const tables = await pg.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const result: Record<string, unknown> = {};
  for (const { tablename } of tables.rows) result[tablename] = (await pg.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS data FROM public."${tablename.replaceAll('"', '""')}" t`)).rows;
  return result;
}
it("uses repeatable-read READ ONLY transactions and leaves all 59 synthetic tables unchanged", async () => {
  const row = await configured(); const before = await snapshot();
  queries = [];
  const first = await service.readiness(row.missionId, now), again = await service.readiness(row.missionId, now);
  const observed = [...queries];
  expect(again).toEqual(first); expect(await snapshot()).toEqual(before);
  expect(observed.some(query => /set transaction isolation level repeatable read read only/i.test(query))).toBe(true);
  expect(observed.some(query => /\b(insert|update|delete|truncate|for share|for update)\b/i.test(query))).toBe(false);
});
async function http(role?: "SUPER_ADMIN" | "REVIEWER", active = true, expired = false) {
  const [user] = await db.insert(s.users).values({ verifiedEmail: crypto.randomUUID() + "@example.test" }).returning();
  if (role) await db.insert(s.adminUsers).values({ userId: user.userId, role, active });
  const token = crypto.randomUUID();
  await db.insert(s.authSessions).values({ userId: user.userId, tokenHash: hashSessionToken(token, secret), expiresAt: new Date(Date.now() + (expired ? -60000 : 60000)) });
  const app = Fastify(); await app.register(cookie);
  app.setErrorHandler((error, _req, reply) => { if (error instanceof AppError) reply.code(error.statusCode).send({ code: error.code }); else reply.code(500).send({ code: "INTERNAL" }); });
  registerAdminMissionRoutes(app, { env: { NODE_ENV: "production", FRONTEND_ORIGIN: "https://hub.example.test", PLAYER_HUB_PROXY_SECRET: "synthetic-proxy-secret" } as Env,
    adminAuth: new AdminAuthorizationService(new DrizzleAdminAuthorizationRepository(db), secret), adminMissions: service });
  await app.ready(); return { app, headers: { cookie: SESSION_COOKIE_NAME + "=" + token, "x-player-hub-proxy-secret": "synthetic-proxy-secret" } };
}
it.each([[undefined, true, false, 403], ["REVIEWER", true, false, 403], ["SUPER_ADMIN", false, false, 403], ["SUPER_ADMIN", true, true, 401]] as const)("denies readiness to unauthorized roles/sessions %#", async (role, active, expired, status) => {
  const { app, headers } = await http(role, active, expired);
  try { expect((await app.inject({ url: `/api/admin/missions/${crypto.randomUUID()}/readiness`, headers })).statusCode).toBe(status); }
  finally { await app.close(); }
}, 15000);
it("GET readiness is authorized/no-store, rejects client assertions and cannot mutate or award through other methods", async () => {
  const { app, headers } = await http("SUPER_ADMIN"), row = await configured(), url = `/api/admin/missions/${row.missionId}/readiness`;
  try {
    const before = await snapshot();
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await app.inject({ url, headers: { cookie: headers.cookie } })).statusCode).toBe(403);
    const response = await app.inject({ url, headers });
    expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("private, no-store"); expect(response.json().activationReady).toBe(false);
    for (const query of ["?approved=true", "?xp=1", "?expectedUpdatedAt=spoofed", "?active=true"]) expect((await app.inject({ url: url + query, headers })).statusCode).toBe(400);
    for (const method of ["POST", "PATCH", "PUT", "DELETE"] as const) expect((await app.inject({ method, url, headers, payload: { active: true, approved: true, rewards: [{ rewardType: "XP", amount: 1 }] } })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/admin/missions/bad/readiness", headers })).statusCode).toBe(400);
    expect((await app.inject({ url: `/api/admin/missions/${crypto.randomUUID()}/readiness`, headers })).statusCode).toBe(404);
    expect(await snapshot()).toEqual(before);
  } finally { await app.close(); }
}, 15000);
