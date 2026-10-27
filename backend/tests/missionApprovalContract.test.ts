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
import { matchesMissionApprovalBinding, type MissionApprovalContractDto } from "../src/domain/missionApprovalContract.js";
import { AdminAuthorizationService, DrizzleAdminAuthorizationRepository } from "../src/domain/adminAuth.js";
import { hashSessionToken, SESSION_COOKIE_NAME } from "../src/domain/sessions.js";
import { AppError } from "../src/domain/errors.js";
import type { Env } from "../src/config/env.js";
import { registerAdminMissionRoutes } from "../src/http/adminMissionRoutes.js";
import type { MissionApprovalContractDto as FrontendContract } from "../../src/types/adminMissions.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const contractsMatch: Equal<MissionApprovalContractDto, FrontendContract> = true;
let pg: PGlite, db: Database, service: AdminMissionService, actorId: string;
let queries: string[] = [];
const now = new Date("2030-02-10T12:00:00Z"), secret = "synthetic-contract-session-secret-at-least-32";
const draft = () => service.createDraft({ title: "Synthetic approval " + crypto.randomUUID(), description: "", category: "DAILY", displayOrder: 0 }, actorId, now);
beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql")).sort()) await pg.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  db = drizzle(pg, { schema: s, logger: { logQuery(query) { queries.push(query); } } }) as unknown as Database; service = new AdminMissionService(db);
  const [user] = await db.insert(s.users).values({ verifiedEmail: "contract-actor@example.test" }).returning();
  const [actor] = await db.insert(s.adminUsers).values({ userId: user.userId, role: "SUPER_ADMIN" }).returning(); actorId = actor.adminUserId;
}, 60000);
afterAll(async () => { await pg.close(); });
it("exposes separate approval categories and exact persisted binding without implicitly issuing approval", async () => {
  expect(contractsMatch).toBe(true); const row = await draft(), contract = await service.approvalContract(row.missionId, now);
  expect(contract).toMatchObject({ missionInactive: true, recordingEnabled: true, allowsActivation: false, evaluatedAt: now.toISOString(), binding: { missionId: row.missionId, approvedConfigurationRevision: row.updatedAt } });
  expect(contract.binding.configurationDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(contract.categories.map(category => category.category)).toEqual(["PRODUCT", "REWARD_BUDGET"]);
  expect(contract.categories.every(category => category.status === "MISSING" && category.recordedApproval === null && category.requiredDecisions.length === 0)).toBe(true);
  expect(contract.recordContract).toMatchObject({ actorSource: "AUTHENTICATED_SERVER_SESSION", timestampSource: "SERVER_UTC", auditRequirement: "SAME_TRANSACTION_AS_APPROVAL", freshnessRequirement: "REVISION_AND_DIGEST_MUST_MATCH" });
  expect(contract.recordContract.requiredFields).toEqual(["missionId", "approvedConfigurationRevision", "configurationDigest", "approvalCategory", "approverAdminUserId", "approvedAt"]);
});
it.each(["metadata", "rule", "schedule", "rewards"])("a persisted %s change supersedes the proposed approval binding", async kind => {
  const row = await draft(), before = await service.approvalContract(row.missionId, now), expectedUpdatedAt = row.updatedAt;
  if (kind === "metadata") await service.updateMetadata(row.missionId, { title: "Synthetic changed", description: "", displayOrder: 1, expectedUpdatedAt }, actorId, now);
  if (kind === "rule") await service.updateRule(row.missionId, { eventType: "puzzle.added", targetCount: 1, sourceType: null, puzzleId: null, levelId: null, conditions: {}, active: false, expectedUpdatedAt }, actorId, now);
  if (kind === "schedule") await service.updateSchedule(row.missionId, { startsAt: "2030-02-11T00:00:00Z", endsAt: null, claimDeadline: null, expectedUpdatedAt }, actorId, now);
  if (kind === "rewards") await service.updateRewards(row.missionId, { xp: 1, synapsePoints: null, expectedUpdatedAt }, actorId, now);
  const after = await service.approvalContract(row.missionId, now);
  expect(matchesMissionApprovalBinding(before.binding, after.binding)).toBe(false); expect(after.binding.configurationDigest).not.toBe(before.binding.configurationDigest);
  expect(after.recordingEnabled).toBe(true); expect((await service.readiness(row.missionId, now)).productApproval).toBe("NOT_RECORDED");
});
it("digest detects direct configuration changes even if a legacy writer fails to advance revision", async () => {
  const row = await draft(), before = await service.approvalContract(row.missionId, now);
  await db.update(s.missions).set({ description: "Synthetic changed without revision" }).where(eq(s.missions.missionId, row.missionId));
  const after = await service.approvalContract(row.missionId, now);
  expect(after.binding.approvedConfigurationRevision).toBe(before.binding.approvedConfigurationRevision);
  expect(matchesMissionApprovalBinding(before.binding, after.binding)).toBe(false);
});
it("binding equality is not authority, approval or activation", async () => {
  const row = await draft(), a = await service.approvalContract(row.missionId, now), b = await service.approvalContract(row.missionId, now);
  expect(matchesMissionApprovalBinding(a.binding, b.binding)).toBe(true);
  for (const extra of [{ missionId: crypto.randomUUID() }, { approvedConfigurationRevision: "2031-01-01T00:00:00Z" }, { configurationDigest: "0".repeat(64) }]) expect(matchesMissionApprovalBinding({ ...a.binding, ...extra }, b.binding)).toBe(false);
  expect(b.categories.every(category => category.recordedApproval === null)).toBe(true); expect(b.allowsActivation).toBe(false);
});
it("inspection is read-only and does not create approval/audit, claims or payouts", async () => {
  const row = await draft();
  const before = await db.select().from(missionAdminHistory); queries = [];
  const first = await service.approvalContract(row.missionId, now), second = await service.approvalContract(row.missionId, now), inspected = [...queries];
  expect(second).toEqual(first); expect(inspected.some(query => /repeatable read read only/i.test(query))).toBe(true);
  expect(inspected.some(query => /\b(insert|update|delete|truncate|for update|for share)\b/i.test(query))).toBe(false);
  expect(await db.select().from(missionAdminHistory)).toEqual(before);
  for (const table of [s.missionClaims, s.xpTransactions, s.pointTransactions, s.gameEvents]) expect(await db.select().from(table)).toEqual([]);
  expect((await service.detail(row.missionId, now)).active).toBe(false);
});
it("failed configuration audit leaves the old approval binding valid and creates no unaudited revision", async () => {
  const row = await draft(), before = await service.approvalContract(row.missionId, now);
  await expect(service.updateMetadata(row.missionId, { title: "Unaudited synthetic edit", description: "", displayOrder: 1, expectedUpdatedAt: row.updatedAt }, crypto.randomUUID(), now)).rejects.toThrow();
  expect(await service.approvalContract(row.missionId, now)).toEqual(before);
});
async function http(role?: "SUPER_ADMIN" | "REVIEWER", active = true, expired = false) {
  const [user] = await db.insert(s.users).values({ verifiedEmail: crypto.randomUUID() + "@example.test" }).returning();
  if (role) await db.insert(s.adminUsers).values({ userId: user.userId, role, active });
  const token = crypto.randomUUID();
  await db.insert(s.authSessions).values({ userId: user.userId, tokenHash: hashSessionToken(token, secret), expiresAt: new Date(Date.now() + (expired ? -60000 : 60000)) });
  const app = Fastify(); await app.register(cookie);
  app.setErrorHandler((error, _req, reply) => { if (error instanceof AppError) reply.code(error.statusCode).send({ code: error.code }); else reply.code(500).send({ code: "INTERNAL" }); });
  registerAdminMissionRoutes(app, { env: { NODE_ENV: "production", FRONTEND_ORIGIN: "https://hub.example.test", PLAYER_HUB_PROXY_SECRET: "synthetic-proxy-secret" } as Env, adminAuth: new AdminAuthorizationService(new DrizzleAdminAuthorizationRepository(db), secret), adminMissions: service });
  await app.ready(); return { app, headers: { cookie: SESSION_COOKIE_NAME + "=" + token, "x-player-hub-proxy-secret": "synthetic-proxy-secret" } };
}
it.each([[undefined, true, false, 403], ["REVIEWER", true, false, 403], ["SUPER_ADMIN", false, false, 403], ["SUPER_ADMIN", true, true, 401]] as const)("requires SUPER_ADMIN authorization for contract inspection %#", async (role, active, expired, status) => {
  const { app, headers } = await http(role, active, expired);
  try { expect((await app.inject({ url: `/api/admin/missions/${crypto.randomUUID()}/approval-contract`, headers })).statusCode).toBe(status); }
  finally { await app.close(); }
}, 15000);
it("inspection rejects client assertions and mutation methods on the inspection endpoint", async () => {
  const { app, headers } = await http("SUPER_ADMIN"), row = await draft(), url = `/api/admin/missions/${row.missionId}/approval-contract`;
  try {
    expect((await app.inject({ url })).statusCode).toBe(401); expect((await app.inject({ url, headers: { cookie: headers.cookie } })).statusCode).toBe(403);
    const before = await db.select().from(missionAdminHistory), response = await app.inject({ url, headers });
    expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("private, no-store"); expect(response.json().recordingEnabled).toBe(true);
    for (const query of ["?approverAdminUserId=forged", "?approvedAt=2030-01-01", "?category=PRODUCT", "?maximumXp=1", "?approved=true"]) expect((await app.inject({ url: url + query, headers })).statusCode).toBe(400);
    for (const method of ["POST", "PATCH", "PUT", "DELETE"] as const) expect((await app.inject({ method, url, headers, payload: { ...response.json().binding, approverAdminUserId: actorId, approvedAt: now.toISOString(), approvalCategory: "PRODUCT" } })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/admin/missions/${crypto.randomUUID()}/approval-contract`, headers })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/admin/missions/bad/approval-contract", headers })).statusCode).toBe(400);
    expect(await db.select().from(missionAdminHistory)).toEqual(before); expect((await service.detail(row.missionId, now)).active).toBe(false);
  } finally { await app.close(); }
}, 15000);
