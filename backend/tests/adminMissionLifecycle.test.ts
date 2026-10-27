import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import type { Database } from "../src/db/client.js";
import type { Env } from "../src/config/env.js";
import * as s from "../src/db/schema.js";
import { missionLifecycleOperations } from "../src/db/missionAdminSchema.js";
import { AdminMissionService } from "../src/domain/adminMissions.js";
import { AdminAuthorizationService, DrizzleAdminAuthorizationRepository } from "../src/domain/adminAuth.js";
import { registerAdminMissionRoutes } from "../src/http/adminMissionRoutes.js";
import { hashSessionToken, SESSION_COOKIE_NAME } from "../src/domain/sessions.js";
import { AppError } from "../src/domain/errors.js";
import type { MissionLifecycleResult } from "../src/domain/adminMissionLifecycle.js";
import type { MissionLifecycleResult as FrontendResult } from "../../src/types/adminMissions.js";

let pg: PGlite, db: Database, service: AdminMissionService, actor: string;
const now = new Date("2030-02-10T12:00:00Z"), secret = "synthetic-lifecycle-session-secret-more-than-32";
beforeAll(async () => {
  pg = new PGlite(); // Disposable in-memory database; no URL or external server is accepted.
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql")).sort()) await pg.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  db = drizzle(pg, { schema: s }) as unknown as Database; service = new AdminMissionService(db);
  actor = await admin("SUPER_ADMIN");
}, 60000);
afterAll(async () => { await pg.close(); });
async function admin(role: "SUPER_ADMIN" | "REVIEWER", active = true) {
  const [user] = await db.insert(s.users).values({ verifiedEmail: crypto.randomUUID() + "@example.test" }).returning();
  const [row] = await db.insert(s.adminUsers).values({ userId: user.userId, role, active }).returning();
  return row.adminUserId;
}
async function configured(active = false) {
  const [row] = await db.insert(s.missions).values({ title: "Synthetic lifecycle", description: "", category: "DAILY", periodType: "DAILY", active, activationEffectiveAt: now, updatedAt: now }).returning();
  await db.insert(s.missionRules).values({ missionId: row.missionId, eventType: "puzzle.added", targetCount: 1, conditions: {} });
  await db.insert(s.missionRewards).values({ missionId: row.missionId, rewardType: "XP", amount: 7 });
  return row;
}
async function input(id: string) {
  const contract = await service.approvalContract(id, now);
  return { expectedUpdatedAt: contract.binding.approvedConfigurationRevision, configurationDigest: contract.binding.configurationDigest, idempotencyKey: crypto.randomUUID() };
}
async function approve(id: string) {
  for (const category of ["PRODUCT", "REWARD_BUDGET"] as const) {
    const contract = await service.approvalContract(id, now);
    await service.changeApproval(id, category, { expectedUpdatedAt: contract.binding.approvedConfigurationRevision, configurationDigest: contract.binding.configurationDigest, expectedApprovalId: null, expectedRevocationId: null }, actor, false, now);
  }
}
const change = async (id: string, action: "ACTIVATE" | "DEACTIVATE", payload?: unknown, actorId = actor) => service.changeLifecycle(id, action, payload ?? await input(id), actorId, () => now);
async function protectedState() {
  const result: Record<string, unknown> = {};
  for (const table of ["player_mission_progress", "mission_claims", "mission_rewards", "wallets", "point_transactions", "xp_transactions", "player_progression", "game_events", "player_mission_chests", "mission_chest_claims"]) result[table] = (await pg.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) data FROM ${table} t`)).rows;
  return result;
}
it("approved technically valid missions activate with an audited forward-only cutoff and no reward effects", async () => {
  const row = await configured(); await approve(row.missionId);
  const protectedBefore = await protectedState(), readiness = await service.readiness(row.missionId, now);
  expect(readiness.activationReady).toBe(true);
  expect(readiness.checks.find(c => c.code === "MISSION_CAPACITY_RECOVERY_AVAILABLE")?.status).toBe("PASS");
  const result = await change(row.missionId, "ACTIVATE");
  expect(result).toMatchObject({ active: true, changed: true, authorizedConfiguration: { revision: row.updatedAt.toISOString() } });
  expect(await protectedState()).toEqual(protectedBefore);
  expect((await service.detail(row.missionId,now)).active).toBe(true);
});
it.each([
  ["missing rule", "RULE_MISSING"], ["disabled rule", "RULE_ENABLED"], ["unsupported event", "RULE_EVENT_SUPPORTED"],
  ["advanced conditions", "ADVANCED_CONDITIONS_UNSUPPORTED"], ["rewards", "REWARDS_VALID"],
  ["schedule", "SCHEDULE_VALID"], ["expired", "AVAILABILITY_NOT_EXPIRED"], ["approvals", "MISSION_PRODUCT_APPROVAL_MISSING"],
])("activation recomputes the persisted %s blocker inside its transaction", async (kind, code) => {
  const row = await configured();
  if (kind === "missing rule") await db.delete(s.missionRules).where(eq(s.missionRules.missionId, row.missionId));
  if (kind === "disabled rule") await db.update(s.missionRules).set({ active: false }).where(eq(s.missionRules.missionId, row.missionId));
  if (kind === "unsupported event") await db.update(s.missionRules).set({ eventType: "xp.earned" }).where(eq(s.missionRules.missionId, row.missionId));
  if (kind === "advanced conditions") await db.update(s.missionRules).set({ conditions: { invented: true } }).where(eq(s.missionRules.missionId, row.missionId));
  if (kind === "rewards") await db.delete(s.missionRewards).where(eq(s.missionRewards.missionId, row.missionId));
  if (kind === "schedule") await db.update(s.missions).set({ category: "EVENT", periodType: "FIXED" }).where(eq(s.missions.missionId, row.missionId));
  if (kind === "expired") await db.update(s.missions).set({ endsAt: new Date("2030-02-09Z") }).where(eq(s.missions.missionId, row.missionId));
  await expect(change(row.missionId, "ACTIVATE")).rejects.toMatchObject({ code: "MISSION_ACTIVATION_BLOCKED", message: expect.stringContaining(code) });
  expect((await service.detail(row.missionId, now)).active).toBe(false);
});
it.each(["revision", "digest", "invalidated", "revoked"])("rejects stale %s or approval state", async kind => {
  const row = await configured(); await approve(row.missionId); const request = await input(row.missionId);
  if (kind === "revision") request.expectedUpdatedAt = "2029-01-01T00:00:00Z";
  if (kind === "digest") request.configurationDigest = "0".repeat(64);
  if (kind === "invalidated") { await service.updateMetadata(row.missionId, { title: "Changed", description: "", displayOrder: 0, expectedUpdatedAt: request.expectedUpdatedAt }, actor, now); Object.assign(request, await input(row.missionId)); }
  if (kind === "revoked") {
    const c = await service.approvalContract(row.missionId, now);
    await service.changeApproval(row.missionId, "PRODUCT", { expectedUpdatedAt: request.expectedUpdatedAt, configurationDigest: request.configurationDigest, expectedApprovalId: c.categories[0].recordedApproval!.approvalId, expectedRevocationId: null }, actor, true, now);
  }
  await expect(change(row.missionId, "ACTIVATE", request)).rejects.toMatchObject({ code: ["revision", "digest"].includes(kind) ? "MISSION_REVISION_CONFLICT" : "MISSION_ACTIVATION_BLOCKED" });
});
it("deactivation changes only lifecycle/revision, preserves snapshots and remains idempotent", async () => {
  const row = await configured(true), request = await input(row.missionId), before = await protectedState();
  const [user] = await db.insert(s.users).values({ verifiedEmail: "earned-lifecycle@example.test" }).returning();
  const [player] = await db.insert(s.players).values({ userId: user.userId, displayName: "Synthetic earned" }).returning();
  const snapshot = { version: 1 as const, rewards: [{ type: "XP" as const, amount: 7 }] };
  await db.insert(s.playerMissionProgress).values({ playerId: player.playerId, missionId: row.missionId, periodKey: "2030-02-10", status: "CLAIMABLE", currentCount: 1, targetCountSnapshot: 1, rewardSnapshot: snapshot, completedAt: now, claimDeadline: new Date("2030-02-12Z") });
  const earned = await protectedState(); expect(earned).not.toEqual(before);
  const first = await change(row.missionId, "DEACTIVATE", request);
  const typed: FrontendResult = first; const backend: MissionLifecycleResult = typed; expect(backend).toEqual(first);
  expect(first).toMatchObject({ changed: true, active: false, idempotent: false, authorizedConfiguration: null, activationEffectiveAt: now.toISOString() });
  expect(first.missionRevision).not.toBe(request.expectedUpdatedAt);
  expect(await change(row.missionId, "DEACTIVATE", request)).toEqual({ ...first, idempotent: true });
  expect(await protectedState()).toEqual(earned);
  const history = await service.history(row.missionId, { limit: 25, offset: 0 }); expect(history.entries).toHaveLength(1);
  expect(history.entries[0]).toMatchObject({ action: "MISSION_DEACTIVATED", actorAdminUserId: actor, occurredAt: now.toISOString(), before: { active: true }, after: { active: false, lifecycleOperation: first } });
});
it("inactive deactivation is an audited no-op without invalidating current approvals", async () => {
  const row = await configured(); await approve(row.missionId); const before = await service.approvalContract(row.missionId, now);
  expect(await change(row.missionId, "DEACTIVATE")).toMatchObject({ changed: false, missionRevision: row.updatedAt.toISOString() });
  expect(await service.approvalContract(row.missionId, now)).toEqual(before);
});
it("same-key concurrent deactivations create exactly one receipt and audit", async () => {
  const row = await configured(true), request = await input(row.missionId);
  const results = await Promise.all([change(row.missionId, "DEACTIVATE", request), change(row.missionId, "DEACTIVATE", request)]);
  expect(results.map(result => result.idempotent).sort()).toEqual([false, true]); expect(results[0].operationId).toBe(results[1].operationId);
  expect((await service.history(row.missionId, { limit: 25, offset: 0 })).entries).toHaveLength(1);
});
it("different-key races and edits cannot apply stale state; historical approvals never revive", async () => {
  const row = await configured(); await approve(row.missionId);
  // Synthetic existing active state, not an activation through the deliberately blocked API.
  await db.update(s.missions).set({ active: true }).where(eq(s.missions.missionId, row.missionId));
  const request = await input(row.missionId);
  const results = await Promise.allSettled([change(row.missionId, "DEACTIVATE", request), change(row.missionId, "DEACTIVATE", { ...request, idempotencyKey: crypto.randomUUID() }), service.updateMetadata(row.missionId, { title: "Race", description: "", displayOrder: 0, expectedUpdatedAt: request.expectedUpdatedAt }, actor, now)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect((await service.approvalContract(row.missionId, now)).categories.map(item => item.status)).toEqual(["INVALIDATED", "INVALIDATED"]);
});
it("concurrent activation requests create one audited transition with idempotent replay", async () => {
  const row = await configured(); await approve(row.missionId); const request = await input(row.missionId);
  const before = await service.history(row.missionId, { limit: 25, offset: 0 });
  const results = await Promise.allSettled([change(row.missionId, "ACTIVATE", request), change(row.missionId, "ACTIVATE", request)]);
  expect(results.every(result => result.status === "fulfilled")).toBe(true);
  expect((await service.history(row.missionId, { limit: 25, offset: 0 })).entries).toHaveLength(before.entries.length+1);
});
it.each(["grant", "revoke", "edit"])("activation racing an approval/configuration %s cannot bypass review", async kind => {
  const row = await configured(); if (kind !== "grant") await approve(row.missionId);
  const request = await input(row.missionId), contract = await service.approvalContract(row.missionId, now);
  const approvalInput = { expectedUpdatedAt: request.expectedUpdatedAt, configurationDigest: request.configurationDigest, expectedApprovalId: contract.categories[0].recordedApproval?.approvalId ?? null, expectedRevocationId: null };
  const mutation = kind === "edit" ? service.updateMetadata(row.missionId, { title: "Concurrent lifecycle edit", description: "", displayOrder: 0, expectedUpdatedAt: request.expectedUpdatedAt }, actor, now) : service.changeApproval(row.missionId, "PRODUCT", approvalInput, actor, kind === "revoke", now);
  const [activation, update] = await Promise.allSettled([change(row.missionId, "ACTIVATE", request), mutation]);
  expect(update.status).toBe("fulfilled"); expect(activation.status).toBe("rejected");
  expect((await service.detail(row.missionId, now)).active).toBe(false);
  expect(await db.select().from(missionLifecycleOperations).where(eq(missionLifecycleOperations.missionId, row.missionId))).toEqual([]);
  if (kind !== "grant") expect((await service.approvalContract(row.missionId, now)).categories[0].status).toBe(kind === "edit" ? "INVALIDATED" : "REVOKED");
});
it("uses the server clock at transaction evaluation rather than a prior preview timestamp", async () => {
  const row = await configured();
  await db.update(s.missions).set({ endsAt: new Date("2030-02-11Z") }).where(eq(s.missions.missionId, row.missionId));
  await approve(row.missionId);
  const preview = await service.readiness(row.missionId, now);
  expect(preview.checks.find(check => check.code === "AVAILABILITY_NOT_EXPIRED")?.status).toBe("PASS");
  await expect(service.changeLifecycle(row.missionId, "ACTIVATE", await input(row.missionId), actor, () => new Date("2030-02-11Z"))).rejects.toMatchObject({ code: "MISSION_ACTIVATION_BLOCKED", message: expect.stringContaining("AVAILABILITY_NOT_EXPIRED") });
});
it("key reuse with a different actor, action or digest is rejected", async () => {
  const row = await configured(true), request = await input(row.missionId); await change(row.missionId, "DEACTIVATE", request);
  await expect(change(row.missionId, "ACTIVATE", request)).rejects.toMatchObject({ code: "MISSION_LIFECYCLE_KEY_CONFLICT" });
  await expect(change(row.missionId, "DEACTIVATE", { ...request, configurationDigest: "0".repeat(64) })).rejects.toMatchObject({ code: "MISSION_LIFECYCLE_KEY_CONFLICT" });
  await expect(change(row.missionId, "DEACTIVATE", request, await admin("SUPER_ADMIN"))).rejects.toMatchObject({ code: "MISSION_LIFECYCLE_KEY_CONFLICT" });
});
it("an original activation receipt can be replayed after deactivation without reactivating", async () => {
  const row = await configured(true), request = await input(row.missionId);
  // Historical receipt fixture only: never bypass readiness to execute a new activation.
  const result: MissionLifecycleResult = { operationId: crypto.randomUUID(), missionId: row.missionId, action: "ACTIVATE", active: true, changed: true, missionRevision: row.updatedAt.toISOString(), activationEffectiveAt: now.toISOString(), occurredAt: now.toISOString(), idempotent: false, authorizedConfiguration: { revision: row.updatedAt.toISOString(), digest: request.configurationDigest, productApprovalId: "1", rewardBudgetApprovalId: "2" } };
  await db.insert(missionLifecycleOperations).values({ operationId: result.operationId, missionId: row.missionId, actorAdminUserId: actor, action: "ACTIVATE", idempotencyKey: request.idempotencyKey, request, result, occurredAt: now });
  await change(row.missionId, "DEACTIVATE");
  const before = await service.detail(row.missionId, now), history = await service.history(row.missionId, { limit: 25, offset: 0 });
  expect(await change(row.missionId, "ACTIVATE", request)).toEqual({ ...result, idempotent: true });
  expect(await service.detail(row.missionId, now)).toEqual(before); expect(before.active).toBe(false);
  expect(await service.history(row.missionId, { limit: 25, offset: 0 })).toEqual(history);
});
it("already-active missions cannot create an activation receipt under a fresh key", async () => {
  const row = await configured(true);
  await expect(change(row.missionId, "ACTIVATE")).rejects.toMatchObject({ code: "MISSION_ALREADY_ACTIVE" });
  expect(await db.select().from(missionLifecycleOperations).where(eq(missionLifecycleOperations.missionId, row.missionId))).toEqual([]);
});
it("audit insertion failure rolls back mission, revision and receipt together", async () => {
  const row = await configured(true), request = await input(row.missionId), before = await service.detail(row.missionId, now);
  await pg.exec("CREATE FUNCTION synthetic_lifecycle_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'MISSION_DEACTIVATED' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_lifecycle_audit_failure BEFORE INSERT ON mission_admin_history FOR EACH ROW EXECUTE FUNCTION synthetic_lifecycle_audit_failure()");
  try { await expect(change(row.missionId, "DEACTIVATE", request)).rejects.toThrow(); }
  finally { await pg.exec("DROP TRIGGER synthetic_lifecycle_audit_failure ON mission_admin_history; DROP FUNCTION synthetic_lifecycle_audit_failure()"); }
  expect(await service.detail(row.missionId, now)).toEqual(before);
  expect(await db.select().from(missionLifecycleOperations).where(eq(missionLifecycleOperations.missionId, row.missionId))).toEqual([]);
  expect((await change(row.missionId, "DEACTIVATE", request)).changed).toBe(true);
});
it("receipts reject update/delete/truncate and duplicate mission keys", async () => {
  const row = await configured(); await change(row.missionId, "DEACTIVATE");
  for (const sql of ["UPDATE mission_lifecycle_operations SET occurred_at=now()", "DELETE FROM mission_lifecycle_operations", "TRUNCATE mission_lifecycle_operations CASCADE"]) await expect(pg.exec(sql)).rejects.toThrow(/append-only/);
  const [receipt] = await db.select().from(missionLifecycleOperations).where(eq(missionLifecycleOperations.missionId, row.missionId));
  await expect(db.insert(missionLifecycleOperations).values({ ...receipt, operationId: crypto.randomUUID() })).rejects.toThrow();
});
it.each([{}, { active: true }, { actorAdminUserId: "forged" }, { idempotencyKey: "not-a-uuid" }, { configurationDigest: "bad" }])("rejects malformed/forged lifecycle input %#", async invalid => {
  const row = await configured(); await expect(change(row.missionId, "ACTIVATE", { ...await input(row.missionId), ...invalid, ...(Object.keys(invalid).length ? {} : { expectedUpdatedAt: undefined }) })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});
it.each(["REVIEWER", "INACTIVE", "MISSING"])("service independently rejects %s actor", async role => {
  const row = await configured(true), id = role === "MISSING" ? crypto.randomUUID() : await admin(role === "REVIEWER" ? "REVIEWER" : "SUPER_ADMIN", role !== "INACTIVE");
  await expect(change(row.missionId, "DEACTIVATE", undefined, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
});
async function http(role?: "SUPER_ADMIN" | "REVIEWER", active = true) {
  const [user] = await db.insert(s.users).values({ verifiedEmail: crypto.randomUUID() + "@example.test" }).returning();
  if (role) await db.insert(s.adminUsers).values({ userId: user.userId, role, active });
  const token = crypto.randomUUID(); await db.insert(s.authSessions).values({ userId: user.userId, tokenHash: hashSessionToken(token, secret), expiresAt: new Date(Date.now() + 60000) });
  const app = Fastify(); await app.register(cookie);
  app.setErrorHandler((error, _req, reply) => { if (error instanceof AppError) reply.code(error.statusCode).send({ code: error.code }); else reply.code(500).send({ code: "INTERNAL" }); });
  registerAdminMissionRoutes(app, { env: { NODE_ENV: "production", FRONTEND_ORIGIN: "https://hub.example.test", PLAYER_HUB_PROXY_SECRET: "synthetic-proxy" } as Env, adminAuth: new AdminAuthorizationService(new DrizzleAdminAuthorizationRepository(db), secret), adminMissions: service });
  await app.ready(); return { app, headers: { cookie: SESSION_COOKIE_NAME + "=" + token, "x-player-hub-proxy-secret": "synthetic-proxy", origin: "https://hub.example.test" } };
}
it.each([undefined, "REVIEWER", "INACTIVE"] as const)("HTTP denies unauthorized lifecycle operations %s", async role => {
  const row = await configured(), { app, headers } = await http(role === "INACTIVE" ? "SUPER_ADMIN" : role, role !== "INACTIVE");
  try { for (const action of ["activate", "deactivate"]) expect((await app.inject({ method: "POST", url: `/api/admin/missions/${row.missionId}/${action}`, headers, payload: await input(row.missionId) })).statusCode).toBe(403); }
  finally { await app.close(); }
});
it("HTTP enforces session, origin, proxy, strict requests and server-derived audit actor", async () => {
  const row = await configured(true), { app, headers } = await http("SUPER_ADMIN"), url = `/api/admin/missions/${row.missionId}/deactivate`, request = await input(row.missionId);
  try {
    expect((await app.inject({ method: "POST", url, payload: request })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url, headers: { cookie: headers.cookie }, payload: request })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url, headers: { ...headers, origin: "https://evil.example.test" }, payload: request })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: url + "?active=true", headers, payload: request })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url, headers, payload: { ...request, actorAdminUserId: actor } })).statusCode).toBe(400);
    const response = await app.inject({ method: "POST", url, headers, payload: request }); expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("private, no-store");
    expect((await service.history(row.missionId, { limit: 25, offset: 0 })).entries[0].actorAdminUserId).not.toBe(actor);
  } finally { await app.close(); }
});
