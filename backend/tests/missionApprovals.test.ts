import { beforeAll, afterAll, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import type { Database } from "../src/db/client.js";
import type { Env } from "../src/config/env.js";
import * as s from "../src/db/schema.js";
import { missionApprovals, missionApprovalRevocations } from "../src/db/missionAdminSchema.js";
import { AdminMissionService } from "../src/domain/adminMissions.js";
import type { MissionApprovalContractDto } from "../src/domain/missionApprovalContract.js";
import { AdminAuthorizationService, DrizzleAdminAuthorizationRepository } from "../src/domain/adminAuth.js";
import { registerAdminMissionRoutes } from "../src/http/adminMissionRoutes.js";
import { hashSessionToken, SESSION_COOKIE_NAME } from "../src/domain/sessions.js";
import { AppError } from "../src/domain/errors.js";

let pg: PGlite, db: Database, service: AdminMissionService, actor: string;
const now = new Date("2030-02-10T12:00:00Z"), secret = "synthetic-approval-session-secret-more-than-32";
beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql")).sort()) await pg.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  db = drizzle(pg, { schema: s }) as unknown as Database; service = new AdminMissionService(db);
  const [user] = await db.insert(s.users).values({ verifiedEmail: "approval-actor@example.test" }).returning();
  const [admin] = await db.insert(s.adminUsers).values({ userId: user.userId, role: "SUPER_ADMIN" }).returning(); actor = admin.adminUserId;
}, 60000);
afterAll(async () => { await pg.close(); });
async function configured() {
  const [row] = await db.insert(s.missions).values({ title: "Synthetic approval", description: "", category: "DAILY", periodType: "DAILY", active: false, activationEffectiveAt: now, updatedAt: now }).returning();
  await db.insert(s.missionRules).values({ missionId: row.missionId, eventType: "puzzle.added", targetCount: 1, conditions: {} });
  await db.insert(s.missionRewards).values({ missionId: row.missionId, rewardType: "XP", amount: 7 });
  return row;
}
function payload(contract: MissionApprovalContractDto, category = "PRODUCT") {
  const record = contract.categories.find(item => item.category === category)?.recordedApproval;
  return { expectedUpdatedAt: contract.binding.approvedConfigurationRevision, configurationDigest: contract.binding.configurationDigest, expectedApprovalId: record?.approvalId ?? null, expectedRevocationId: record?.revocationId ?? null };
}
const change = async (id: string, category = "PRODUCT", revoke = false, actorId = actor) => service.changeApproval(id, category, payload(await service.approvalContract(id, now), category), actorId, revoke, now);
const statuses = (contract: MissionApprovalContractDto) => contract.categories.map(item => item.status);

it("persists separate exact-budget approvals by one SUPER_ADMIN without activation, expiry or reward side effects", async () => {
  const row = await configured();
  expect(statuses(await change(row.missionId))).toEqual(["APPROVED", "MISSING"]);
  expect((await service.readiness(row.missionId, now)).activationReady).toBe(false);
  const both = await change(row.missionId, "REWARD_BUDGET");
  expect(statuses(both)).toEqual(["APPROVED", "APPROVED"]);
  expect(both.categories[1].recordedApproval).toMatchObject({ approverAdminUserId: actor, approvedAt: now.toISOString(), xp: 7, synapsePoints: 0, approvedConfigurationRevision: row.updatedAt.toISOString() });
  expect(statuses(await service.approvalContract(row.missionId, new Date("2040-01-01Z")))).toEqual(["APPROVED", "APPROVED"]);
  expect((await service.readiness(row.missionId, now)).activationReady).toBe(true);
  expect((await service.detail(row.missionId, now)).active).toBe(false);
  for (const table of [s.missionClaims, s.xpTransactions, s.pointTransactions, s.gameEvents, s.playerMissionProgress]) expect(await db.select().from(table)).toEqual([]);
  expect((await service.history(row.missionId, { limit: 25, offset: 0 })).entries.map(item => item.action)).toEqual(["APPROVAL_GRANTED", "APPROVAL_GRANTED"]);
});
it.each(["metadata", "rule", "schedule", "rewards"])("%s edits invalidate approvals without deleting history", async kind => {
  const row = await configured(); await change(row.missionId); await change(row.missionId, "REWARD_BUDGET");
  const revision = row.updatedAt.toISOString();
  if (kind === "metadata") await service.updateMetadata(row.missionId, { title: "Edited", description: "", displayOrder: 0, expectedUpdatedAt: revision }, actor, now);
  if (kind === "rule") await service.updateRule(row.missionId, { eventType: "puzzle.added", targetCount: 2, sourceType: null, puzzleId: null, levelId: null, conditions: {}, active: true, expectedUpdatedAt: revision }, actor, now);
  if (kind === "schedule") await service.updateSchedule(row.missionId, { startsAt: "2030-02-11T00:00:00Z", endsAt: null, claimDeadline: null, expectedUpdatedAt: revision }, actor, now);
  if (kind === "rewards") await service.updateRewards(row.missionId, { xp: 8, synapsePoints: null, expectedUpdatedAt: revision }, actor, now);
  expect(statuses(await service.approvalContract(row.missionId, now))).toEqual(["INVALIDATED", "INVALIDATED"]);
  expect((await service.readiness(row.missionId, now)).activationReady).toBe(false);
  expect(await db.select().from(missionApprovals).where(eq(missionApprovals.missionId, row.missionId))).toHaveLength(2);
});
it("reverting metadata never revives a historical approval and stale payloads conflict", async () => {
  const row = await configured(), approved = await change(row.missionId), old = payload(approved, "REWARD_BUDGET");
  const edited = await service.updateMetadata(row.missionId, { title: "Changed", description: "", displayOrder: 0, expectedUpdatedAt: row.updatedAt.toISOString() }, actor, now);
  await service.updateMetadata(row.missionId, { title: row.title, description: "", displayOrder: 0, expectedUpdatedAt: edited.updatedAt }, actor, now);
  expect(statuses(await service.approvalContract(row.missionId, now))).toEqual(["INVALIDATED", "MISSING"]);
  await expect(service.changeApproval(row.missionId, "REWARD_BUDGET", old, actor, false, now)).rejects.toMatchObject({ code: "MISSION_REVISION_CONFLICT" });
});
it("revocation is separate, audited and permits explicit reapproval without reviving the revoked record", async () => {
  const row = await configured(), grant = await change(row.missionId), request = payload(grant);
  const revoked = await change(row.missionId, "PRODUCT", true);
  expect(statuses(revoked)).toEqual(["REVOKED", "MISSING"]);
  expect(revoked.categories[0].recordedApproval).toMatchObject({ revokedByAdminUserId: actor, revokedAt: now.toISOString() });
  await expect(service.changeApproval(row.missionId, "PRODUCT", request, actor, false, now)).rejects.toMatchObject({ code: "MISSION_APPROVAL_CONFLICT" });
  const replacement = await change(row.missionId);
  expect(replacement.categories[0].status).toBe("APPROVED");
  expect(replacement.categories[0].recordedApproval?.approvalId).not.toBe(grant.categories[0].recordedApproval?.approvalId);
});
it("concurrent duplicate approval/revocation requests create one mutation and one corresponding audit", async () => {
  const row = await configured(), input = payload(await service.approvalContract(row.missionId, now));
  const results = await Promise.allSettled([service.changeApproval(row.missionId, "PRODUCT", input, actor, false, now), service.changeApproval(row.missionId, "PRODUCT", input, actor, false, now)]);
  expect(results.filter(item => item.status === "fulfilled")).toHaveLength(1);
  const revokeInput = payload(await service.approvalContract(row.missionId, now));
  const revokes = await Promise.allSettled([service.changeApproval(row.missionId, "PRODUCT", revokeInput, actor, true, now), service.changeApproval(row.missionId, "PRODUCT", revokeInput, actor, true, now)]);
  expect(revokes.filter(item => item.status === "fulfilled")).toHaveLength(1);
  expect((await service.history(row.missionId, { limit: 25, offset: 0 })).entries).toHaveLength(2);
});
it("configuration-versus-approval race cannot leave a valid approval for stale configuration", async () => {
  const row = await configured(), input = payload(await service.approvalContract(row.missionId, now));
  await Promise.allSettled([service.changeApproval(row.missionId, "PRODUCT", input, actor, false, now), service.updateMetadata(row.missionId, { title: "Concurrent edit", description: "", displayOrder: 1, expectedUpdatedAt: row.updatedAt.toISOString() }, actor, now)]);
  expect((await service.approvalContract(row.missionId, now)).categories[0].status).not.toBe("APPROVED");
});
it.each([false, true])("audit failure rolls back approval mutation revoke=%s", async revoke => {
  const row = await configured(); if (revoke) await change(row.missionId);
  const before = await service.approvalContract(row.missionId, now);
  await pg.exec("CREATE FUNCTION synthetic_approval_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'APPROVAL_%' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_approval_audit_failure BEFORE INSERT ON mission_admin_history FOR EACH ROW EXECUTE FUNCTION synthetic_approval_audit_failure()");
  try { await expect(change(row.missionId, "PRODUCT", revoke)).rejects.toThrow(); }
  finally { await pg.exec("DROP TRIGGER synthetic_approval_audit_failure ON mission_admin_history; DROP FUNCTION synthetic_approval_audit_failure()"); }
  expect(await service.approvalContract(row.missionId, now)).toEqual(before);
});
it("new tables reject modification and truncation; existing history remains immutable", async () => {
  const row = await configured(); await change(row.missionId); await change(row.missionId, "PRODUCT", true);
  for (const [table, field] of [["mission_approvals", "approved_at"], ["mission_approval_revocations", "revoked_at"], ["mission_admin_history", "occurred_at"]]) {
    for (const statement of [`UPDATE ${table} SET ${field}=now()`, `DELETE FROM ${table}`, `TRUNCATE ${table} CASCADE`]) await expect(pg.exec(statement)).rejects.toThrow(/append-only/);
  }
  expect(await db.select().from(missionApprovalRevocations)).not.toHaveLength(0);
});
it.each(["incomplete", "active", "unsupported"])("rejects %s configuration before approval writes", async kind => {
  const row = await configured();
  if (kind === "incomplete") await db.update(s.missionRules).set({ active: false }).where(eq(s.missionRules.missionId, row.missionId));
  if (kind === "active") await db.update(s.missions).set({ active: true }).where(eq(s.missions.missionId, row.missionId));
  if (kind === "unsupported") await db.update(s.missionRules).set({ eventType: "xp.earned" }).where(eq(s.missionRules.missionId, row.missionId));
  await expect(change(row.missionId)).rejects.toMatchObject({ code: kind === "active" ? "MISSION_APPROVAL_LOCKED" : "MISSION_APPROVAL_NOT_READY" });
  expect(await db.select().from(missionApprovals).where(eq(missionApprovals.missionId, row.missionId))).toEqual([]);
});
it("accepts explicit integer-storage maximum reward without inventing an economic cap", async () => {
  const row = await configured(); await service.updateRewards(row.missionId, { xp: 2147483647, synapsePoints: 2147483647, expectedUpdatedAt: row.updatedAt.toISOString() }, actor, now);
  const approved = await change(row.missionId, "REWARD_BUDGET");
  expect(approved.categories[1].recordedApproval).toMatchObject({ xp: 2147483647, synapsePoints: 2147483647 });
});
it("independent categories can be granted concurrently against one configuration revision", async () => {
  const row = await configured(), contract = await service.approvalContract(row.missionId, now);
  const result = await Promise.all([service.changeApproval(row.missionId, "PRODUCT", payload(contract), actor, false, now), service.changeApproval(row.missionId, "REWARD_BUDGET", payload(contract, "REWARD_BUDGET"), actor, false, now)]);
  expect(result).toHaveLength(2); expect(statuses(await service.approvalContract(row.missionId, now))).toEqual(["APPROVED", "APPROVED"]);
});
it("failed configuration audit preserves existing approvals and does not create an unaudited invalidation", async () => {
  const row = await configured(), before = await change(row.missionId);
  await expect(service.updateMetadata(row.missionId, { title: "Not committed", description: "", displayOrder: 0, expectedUpdatedAt: row.updatedAt.toISOString() }, crypto.randomUUID(), now)).rejects.toThrow();
  expect(await service.approvalContract(row.missionId, now)).toEqual(before);
});
it("revocation remains possible for an invalidated approval on an active synthetic mission without deactivating it", async () => {
  const row = await configured(); await change(row.missionId);
  await db.update(s.missions).set({ active: true }).where(eq(s.missions.missionId, row.missionId));
  const result = await change(row.missionId, "PRODUCT", true);
  expect(result.categories[0].status).toBe("REVOKED"); expect(result.missionInactive).toBe(false);
  expect((await service.detail(row.missionId, now)).active).toBe(true);
});
it.each([{}, null, { expectedUpdatedAt: "invalid" }, { expectedApprovalId: "0" }, { expectedApprovalId: "9223372036854775808" }, { expectedRevocationId: -1 }, { configurationDigest: "bad" }, { approverAdminUserId: "forged" }])("rejects malformed or forged mutation data %# without writes", async invalid => {
  const row = await configured(), input = payload(await service.approvalContract(row.missionId, now));
  const data = invalid === null ? null : Object.keys(invalid).length === 0 ? {} : { ...input, ...invalid };
  await expect(service.changeApproval(row.missionId, "PRODUCT", data, actor, false, now)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  expect(await db.select().from(missionApprovals).where(eq(missionApprovals.missionId, row.missionId))).toEqual([]);
});
it("the service rejects an untrusted actor even if a caller bypasses the HTTP permission hook", async () => {
  const row = await configured();
  await expect(change(row.missionId, "PRODUCT", false, crypto.randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN" });
});

async function http(role?: "SUPER_ADMIN" | "REVIEWER", active = true, expired = false) {
  const [user] = await db.insert(s.users).values({ verifiedEmail: crypto.randomUUID() + "@example.test" }).returning();
  if (role) await db.insert(s.adminUsers).values({ userId: user.userId, role, active });
  const token = crypto.randomUUID(); await db.insert(s.authSessions).values({ userId: user.userId, tokenHash: hashSessionToken(token, secret), expiresAt: new Date(Date.now() + (expired ? -60000 : 60000)) });
  const app = Fastify(); await app.register(cookie);
  app.setErrorHandler((error, _request, reply) => { if (error instanceof AppError) reply.code(error.statusCode).send({ code: error.code }); else reply.code(500).send({ code: "INTERNAL" }); });
  registerAdminMissionRoutes(app, { env: { NODE_ENV: "production", FRONTEND_ORIGIN: "https://hub.example.test", PLAYER_HUB_PROXY_SECRET: "test-proxy" } as Env, adminAuth: new AdminAuthorizationService(new DrizzleAdminAuthorizationRepository(db), secret), adminMissions: service });
  await app.ready(); return { app, headers: { cookie: SESSION_COOKIE_NAME + "=" + token, "x-player-hub-proxy-secret": "test-proxy", origin: "https://hub.example.test" } };
}
it.each([[undefined, true, false, 403], ["REVIEWER", true, false, 403], ["SUPER_ADMIN", false, false, 403], ["SUPER_ADMIN", true, true, 401]] as const)("rejects unauthorized grant and revocation %#", async (role, active, expired, status) => {
  const { app, headers } = await http(role, active, expired), row = await configured();
  try { for (const suffix of ["", "/revoke"]) expect((await app.inject({ method: "POST", url: `/api/admin/missions/${row.missionId}/approvals/PRODUCT${suffix}`, headers, payload: payload(await service.approvalContract(row.missionId, now)) })).statusCode).toBe(status); }
  finally { await app.close(); }
});
it("API protects actor identity, origin/proxy, strict bodies and audit provenance; cannot activate through approval writes", async () => {
  const { app, headers } = await http("SUPER_ADMIN"), row = await configured(), input = payload(await service.approvalContract(row.missionId, now)), url = `/api/admin/missions/${row.missionId}/approvals/PRODUCT`;
  try {
    expect((await app.inject({ method: "POST", url, payload: input })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url, headers: { cookie: headers.cookie }, payload: input })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url, headers: { ...headers, origin: "https://evil.example.test" }, payload: input })).statusCode).toBe(403);
    for (const extra of [{ actorAdminUserId: actor }, { approvedAt: now.toISOString() }, { xp: 100 }, { active: true }, { approved: true }]) expect((await app.inject({ method: "POST", url, headers, payload: { ...input, ...extra } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url, headers, payload: { ...input, configurationDigest: "0".repeat(64) } })).statusCode).toBe(409);
    const response = await app.inject({ method: "POST", url, headers, payload: input }); expect(response.statusCode).toBe(200);
    const record = response.json().categories[0].recordedApproval;
    expect(record.approverAdminUserId).not.toBe(actor);
    expect((await service.history(row.missionId, { limit: 25, offset: 0 })).entries[0].actorAdminUserId).toBe(record.approverAdminUserId);
    expect((await app.inject({ method: "POST", url: `/api/admin/missions/${row.missionId}/activate`, headers, payload: {} })).statusCode).toBe(400);
    expect((await service.detail(row.missionId)).active).toBe(false);
  } finally { await app.close(); }
});
