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
import { parseAdminMissionRewards } from "../src/domain/adminMissionRewards.js";
import { freezeRewards, snapshotTotals } from "../src/domain/missionLifecycle.js";
import { AdminAuthorizationService, DrizzleAdminAuthorizationRepository } from "../src/domain/adminAuth.js";
import { hashSessionToken, SESSION_COOKIE_NAME } from "../src/domain/sessions.js";
import { AppError } from "../src/domain/errors.js";
import type { Env } from "../src/config/env.js";
import { registerAdminMissionRoutes } from "../src/http/adminMissionRoutes.js";
import type { AdminMissionRewardsInput } from "../../src/types/adminMissions.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const contractMatches: Equal<ReturnType<typeof parseAdminMissionRewards>, AdminMissionRewardsInput> = true;
let pg: PGlite, db: Database, service: AdminMissionService, actorId: string;
const now = new Date("2030-02-10T12:00:00Z"), secret = "synthetic-admin-rewards-session-secret-at-least-32";
const historyFilter = { limit: 100, offset: 0 };
const draft = () => service.createDraft({ title: "Synthetic rewards " + crypto.randomUUID(), description: "", category: "DAILY", displayOrder: 0 }, actorId, now);
const input = (revision: string, extra: Record<string, unknown> = {}) => ({ xp: 5, synapsePoints: 7, expectedUpdatedAt: revision, ...extra });
const rowsFor = (id: string) => db.select().from(s.missionRewards).where(eq(s.missionRewards.missionId, id));
beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql")).sort()) await pg.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  db = drizzle(pg, { schema: s }) as unknown as Database; service = new AdminMissionService(db);
  const [user] = await db.insert(s.users).values({ verifiedEmail: "rewards-actor@example.test" }).returning();
  const [actor] = await db.insert(s.adminUsers).values({ userId: user.userId, role: "SUPER_ADMIN" }).returning(); actorId = actor.adminUserId;
}, 60000);
afterAll(async () => { await pg.close(); });

it("keeps the frontend payload aligned and creates no default rewards on drafts", async () => {
  expect(contractMatches).toBe(true);
  const created = await draft(); expect(created.rewards).toEqual([]); expect(created.active).toBe(false);
  expect(await rowsFor(created.missionId)).toEqual([]);
});
it.each([[1, null], [null, 1], [2147483647, null], [null, 2147483647], [2147483647, 2147483647], [5, 7]])("accepts explicit XP %s / SP %s within existing per-currency limits", async (xp, synapsePoints) => {
  const created = await draft(); const saved = await service.updateRewards(created.missionId, input(created.updatedAt, { xp, synapsePoints }), actorId, now);
  expect(saved.active).toBe(false); expect(saved.lifecycle).toBe("INACTIVE"); expect(saved.rule).toBeNull();
  expect(saved.startsAt).toBeNull(); expect(saved.activationEffectiveAt).toBe(created.activationEffectiveAt);
  expect(snapshotTotals(freezeRewards(saved.rewards.filter(reward => reward.active)))).toEqual({ xp: xp ?? 0, synapsePoints: synapsePoints ?? 0 });
  expect(saved.rewards.every(reward => reward.amount > 0 && reward.active)).toBe(true);
  const entry = (await service.history(created.missionId, historyFilter)).entries[0];
  expect(entry).toMatchObject({ action: "REWARDS_CONFIGURED", actorAdminUserId: actorId, occurredAt: now.toISOString(), before: { rewards: [], updatedAt: created.updatedAt }, after: { rewards: saved.rewards, updatedAt: saved.updatedAt, active: false } });
});
it.each([
  { xp: 0 }, { synapsePoints: 0 }, { xp: -1 }, { synapsePoints: -1 }, { xp: 1.5 }, { synapsePoints: 1.5 },
  { xp: 2147483648 }, { synapsePoints: 2147483648 }, { xp: Number.MAX_SAFE_INTEGER }, { xp: NaN }, { synapsePoints: Infinity },
  { xp: "5" }, { synapsePoints: "7" }, { xp: true }, { xp: {} }, { synapsePoints: [] },
  { xp: undefined }, { synapsePoints: undefined }, { xp: null, synapsePoints: null },
  { expectedUpdatedAt: "bad" }, { active: true }, { rewardType: "COSMETIC" }, { rewards: [] }, { amount: 1 }, { actorAdminUserId: "spoofed" },
])("rejects invalid, missing, empty or unsupported reward configuration %# without mutation", async extra => {
  const created = await draft(); const history = await service.history(created.missionId, historyFilter);
  await expect(service.updateRewards(created.missionId, input(created.updatedAt, extra), actorId, now)).rejects.toMatchObject({ code: "VALIDATION_FAILED", statusCode: 400 });
  expect(await service.detail(created.missionId, now)).toEqual(created); expect(await rowsFor(created.missionId)).toEqual([]);
  expect(await service.history(created.missionId, historyFilter)).toEqual(history);
});
it("permits one omitted currency but never stores zero rows or clears all payable rewards", async () => {
  const created = await draft(); const saved = await service.updateRewards(created.missionId, input(created.updatedAt), actorId, now);
  const before = await rowsFor(created.missionId);
  await expect(service.updateRewards(created.missionId, input(saved.updatedAt, { xp: null, synapsePoints: null }), actorId, now)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  expect(await rowsFor(created.missionId)).toEqual(before);
  const xpOnly = await service.updateRewards(created.missionId, input(saved.updatedAt, { xp: 8, synapsePoints: null }), actorId, now);
  expect(xpOnly.rewards.filter(row => row.active)).toEqual([{ rewardType: "XP", amount: 8, active: true }]);
  const spOnly = await service.updateRewards(created.missionId, input(xpOnly.updatedAt, { xp: null, synapsePoints: 9 }), actorId, now);
  expect(spOnly.rewards.filter(row => row.active)).toEqual([{ rewardType: "SYNAPSE_POINTS", amount: 9, active: true }]);
  expect((await rowsFor(created.missionId)).map(row => row.missionRewardId).sort()).toEqual(before.map(row => row.missionRewardId).sort());
  expect((await rowsFor(created.missionId)).every(row => row.amount > 0)).toBe(true);
});
it("honors aggregate M1 rewards, ignores effective no-ops and retains duplicate row IDs on explicit replacement", async () => {
  const created = await draft();
  await db.insert(s.missionRewards).values([{ missionId: created.missionId, rewardType: "XP", amount: 2, displayOrder: 0 }, { missionId: created.missionId, rewardType: "XP", amount: 3, displayOrder: 1 }, { missionId: created.missionId, rewardType: "SYNAPSE_POINTS", amount: 5, displayOrder: 2 }]);
  const before = await rowsFor(created.missionId), history = await service.history(created.missionId, historyFilter);
  const same = await service.updateRewards(created.missionId, input(created.updatedAt, { xp: 5, synapsePoints: 5 }), actorId, now);
  expect(same.updatedAt).toBe(created.updatedAt); expect(await rowsFor(created.missionId)).toEqual(before); expect(await service.history(created.missionId, historyFilter)).toEqual(history);
  const changed = await service.updateRewards(created.missionId, input(same.updatedAt, { xp: 6, synapsePoints: null }), actorId, now);
  expect(changed.rewards.filter(row => row.active)).toEqual([{ rewardType: "XP", amount: 6, active: true }]);
  expect((await rowsFor(created.missionId)).map(row => row.missionRewardId).sort()).toEqual(before.map(row => row.missionRewardId).sort());
  const audit = (await service.history(created.missionId, historyFilter)).entries[0];
  expect(audit.before?.rewards).toEqual(same.rewards); expect(audit.after.rewards).toEqual(changed.rewards);
});
it("can explicitly repair an invalid aggregate XP/SP configuration without expanding the reward cap", async () => {
  const created = await draft();
  await db.insert(s.missionRewards).values([{ missionId: created.missionId, rewardType: "XP", amount: 2147483647 }, { missionId: created.missionId, rewardType: "XP", amount: 1 }]);
  expect((await service.detail(created.missionId, now)).configurationIssues).toContain("Invalid mission reward total.");
  const saved = await service.updateRewards(created.missionId, input(created.updatedAt, { xp: 9, synapsePoints: null }), actorId, now);
  expect(snapshotTotals(freezeRewards(saved.rewards.filter(row => row.active)))).toEqual({ xp: 9, synapsePoints: 0 });
});
it.each([true, false])("refuses to overwrite unsupported reward types, including active=%s", async active => {
  const created = await draft();
  await db.insert(s.missionRewards).values({ missionId: created.missionId, rewardType: "COSMETIC", amount: 1, active });
  const before = await rowsFor(created.missionId), history = await service.history(created.missionId, historyFilter);
  await expect(service.updateRewards(created.missionId, input(created.updatedAt), actorId, now)).rejects.toMatchObject({ code: "MISSION_REWARDS_UNSUPPORTED", statusCode: 409 });
  expect(await rowsFor(created.missionId)).toEqual(before); expect(await service.history(created.missionId, historyFilter)).toEqual(history);
});
it.each(["ACTIVE", "SCHEDULED", "ENDED"])("rejects reward edits for active definitions with %s lifecycle", async lifecycle => {
  const [row] = await db.insert(s.missions).values({ title: "Synthetic active", description: "", category: "DAILY", periodType: "DAILY", active: true, activationEffectiveAt: now,
    startsAt: lifecycle === "SCHEDULED" ? new Date("2031-01-01Z") : null, endsAt: lifecycle === "ENDED" ? new Date("2030-02-10T11:00:00Z") : null }).returning();
  await expect(service.updateRewards(row.missionId, input(row.updatedAt.toISOString()), actorId, now)).rejects.toMatchObject({ code: "MISSION_REWARDS_LOCKED", statusCode: 409 });
  expect(await rowsFor(row.missionId)).toEqual([]); expect((await service.history(row.missionId, historyFilter)).entries).toEqual([]);
});
it("rolls back inserted, updated and disabled reward rows plus revision if history insertion fails", async () => {
  const created = await draft(), missingActor = crypto.randomUUID();
  await expect(service.updateRewards(created.missionId, input(created.updatedAt), missingActor, now)).rejects.toThrow();
  expect(await service.detail(created.missionId, now)).toEqual(created); expect(await rowsFor(created.missionId)).toEqual([]);
  const saved = await service.updateRewards(created.missionId, input(created.updatedAt), actorId, now);
  const before = await rowsFor(created.missionId), history = await service.history(created.missionId, historyFilter);
  await expect(service.updateRewards(created.missionId, input(saved.updatedAt, { xp: 9, synapsePoints: null }), missingActor, now)).rejects.toThrow();
  expect(await rowsFor(created.missionId)).toEqual(before); expect(await service.detail(created.missionId, now)).toEqual(saved); expect(await service.history(created.missionId, historyFilter)).toEqual(history);
});
it.each(["rewards", "metadata", "rule", "schedule"])("shares revision protection with competing %s edits", async competing => {
  const created = await draft();
  const second = () => competing === "rewards" ? service.updateRewards(created.missionId, input(created.updatedAt, { xp: 99 }), actorId, now)
    : competing === "metadata" ? service.updateMetadata(created.missionId, { title: "Concurrent metadata", description: "", displayOrder: 1, expectedUpdatedAt: created.updatedAt }, actorId, now)
      : competing === "schedule" ? service.updateSchedule(created.missionId, { startsAt: "2030-02-11T00:00:00Z", endsAt: null, claimDeadline: null, expectedUpdatedAt: created.updatedAt }, actorId, now)
        : service.updateRule(created.missionId, { eventType: "puzzle.added", targetCount: 1, sourceType: null, puzzleId: null, levelId: null, conditions: {}, active: false, expectedUpdatedAt: created.updatedAt }, actorId, now);
  const result = await Promise.allSettled([service.updateRewards(created.missionId, input(created.updatedAt), actorId, now), second()]);
  expect(result.filter(row => row.status === "fulfilled")).toHaveLength(1);
  expect(result.find(row => row.status === "rejected")).toMatchObject({ reason: { code: "MISSION_REVISION_CONFLICT" } });
  expect((await service.history(created.missionId, historyFilter)).entries).toHaveLength(2);
});
it("preserves frozen completion/claim snapshots, balances, ledgers and chest rewards without executing a payout", async () => {
  const created = await draft(); const configured = await service.updateRewards(created.missionId, input(created.updatedAt), actorId, now);
  // All records below are synthetic fixture data, inserted directly. No claim/grant/processor runs.
  const [user] = await db.insert(s.users).values({ verifiedEmail: "rewards-synthetic-player@example.test" }).returning();
  const [player] = await db.insert(s.players).values({ userId: user.userId, displayName: "Synthetic reward history" }).returning();
  const reward = freezeRewards([{ rewardType: "XP", amount: 5 }, { rewardType: "SYNAPSE_POINTS", amount: 7 }]);
  const [progress] = await db.insert(s.playerMissionProgress).values({ playerId: player.playerId, missionId: created.missionId, periodKey: "2030-02-10", targetCountSnapshot: 1, currentCount: 1, status: "CLAIMED", completedAt: now, claimedAt: now, claimDeadline: new Date("2030-02-12Z"), rewardSnapshot: reward }).returning();
  const claimId = crypto.randomUUID();
  const [xp] = await db.insert(s.xpTransactions).values({ playerId: player.playerId, amount: 5, totalXpAfter: 5, reason: "Synthetic fixture", sourceType: "MISSION_REWARD", sourceId: claimId, idempotencyKey: "synthetic-reward-history-xp" }).returning();
  const [sp] = await db.insert(s.pointTransactions).values({ playerId: player.playerId, amount: 7, direction: "CREDIT", balanceAfter: 7, reason: "Synthetic fixture", sourceType: "MISSION_REWARD", sourceId: claimId, idempotencyKey: "synthetic-reward-history-sp" }).returning();
  const [claim] = await db.insert(s.missionClaims).values({ missionClaimId: claimId, playerId: player.playerId, missionId: created.missionId, playerMissionProgressId: progress.playerMissionProgressId, periodKey: progress.periodKey, xpRewardSnapshot: 5, synapseRewardSnapshot: 7, xpTransactionId: xp.xpTransactionId, pointTransactionId: sp.transactionId, idempotencyKey: "synthetic-claim-history" }).returning();
  const [wallet] = await db.insert(s.wallets).values({ playerId: player.playerId, balance: 7 }).returning();
  const [state] = await db.insert(s.playerProgression).values({ playerId: player.playerId, totalXp: 5, progressionLevel: 1, rankName: "Synthetic" }).returning();
  const [chest] = await db.insert(c.missionChests).values({ title: "Synthetic inactive chest", periodType: "DAILY", targetCount: 1, active: false, rewards: reward }).returning();
  const saved = await service.updateRewards(created.missionId, input(configured.updatedAt, { xp: 11, synapsePoints: null }), actorId, now);
  expect(saved.active).toBe(false); expect(saved.rule).toBeNull();
  expect((await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.playerMissionProgressId, progress.playerMissionProgressId)))[0]).toEqual(progress);
  expect(snapshotTotals(progress.rewardSnapshot)).toEqual({ xp: 5, synapsePoints: 7 });
  expect((await db.select().from(s.missionClaims).where(eq(s.missionClaims.missionClaimId, claimId)))[0]).toEqual(claim);
  expect((await db.select().from(s.xpTransactions).where(eq(s.xpTransactions.xpTransactionId, xp.xpTransactionId)))[0]).toEqual(xp);
  expect((await db.select().from(s.pointTransactions).where(eq(s.pointTransactions.transactionId, sp.transactionId)))[0]).toEqual(sp);
  expect((await db.select().from(s.wallets).where(eq(s.wallets.playerId, player.playerId)))[0]).toEqual(wallet);
  expect((await db.select().from(s.playerProgression).where(eq(s.playerProgression.playerId, player.playerId)))[0]).toEqual(state);
  expect((await db.select().from(c.missionChests).where(eq(c.missionChests.chestId, chest.chestId)))[0]).toEqual(chest);
  expect(await db.select().from(s.gameEvents)).toEqual([]);
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
it.each([[undefined, true, false, 403], ["REVIEWER", true, false, 403], ["SUPER_ADMIN", false, false, 403], ["SUPER_ADMIN", true, true, 401]] as const)("denies reward edits to unauthorized roles/sessions %#", async (role, active, expired, status) => {
  const { app, headers } = await http(role, active, expired);
  try { expect((await app.inject({ method: "PATCH", url: `/api/admin/missions/${crypto.randomUUID()}/rewards`, headers, payload: input(now.toISOString()) })).statusCode).toBe(status); }
  finally { await app.close(); }
}, 15000);
it("enforces API authentication/proxy/origin, strict values and revisions and audits the session actor", async () => {
  const { app, actor, headers } = await http("SUPER_ADMIN"), created = await draft(); const url = `/api/admin/missions/${created.missionId}/rewards`;
  try {
    expect((await app.inject({ method: "PATCH", url, payload: input(created.updatedAt) })).statusCode).toBe(401);
    for (const invalidHeaders of [{ cookie: headers.cookie }, { ...headers, origin: "https://evil.test" }, { ...headers, "sec-fetch-site": "cross-site" }]) expect((await app.inject({ method: "PATCH", url, headers: invalidHeaders, payload: input(created.updatedAt) })).statusCode).toBe(403);
    for (const payload of [null, [], {}, input(created.updatedAt, { xp: 0 }), input(created.updatedAt, { active: true })]) expect((await app.inject({ method: "PATCH", url, headers: { ...headers, "content-type": "application/json" }, payload: JSON.stringify(payload) })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/api/admin/missions/bad/rewards", headers, payload: input(created.updatedAt) })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/api/admin/missions/${crypto.randomUUID()}/rewards`, headers, payload: input(created.updatedAt) })).statusCode).toBe(404);
    const response = await app.inject({ method: "PATCH", url, headers, payload: input(created.updatedAt) });
    expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("private, no-store"); expect(response.json().active).toBe(false);
    expect((await service.history(created.missionId, historyFilter)).entries[0].actorAdminUserId).toBe(actor?.adminUserId);
    expect((await app.inject({ method: "PATCH", url, headers, payload: input(created.updatedAt) })).statusCode).toBe(409);
    await expect(db.update(missionAdminHistory).set({ action: "REWARDS_CONFIGURED" }).where(eq(missionAdminHistory.missionId, created.missionId))).rejects.toThrow();
  } finally { await app.close(); }
}, 15000);
it("migration 0030 preserves 0029 history and append-only protection", async () => {
  const isolated = new PGlite();
  try {
    for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql") && Number(file.slice(0, 4)) <= 29).sort()) await isolated.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
    const local = drizzle(isolated, { schema: s }) as unknown as Database; const admin = new AdminMissionService(local);
    const [user] = await local.insert(s.users).values({ verifiedEmail: "reward-upgrade@example.test" }).returning();
    const [actor] = await local.insert(s.adminUsers).values({ userId: user.userId, role: "SUPER_ADMIN" }).returning();
    const created = await admin.createDraft({ title: "Existing 0029", description: "", category: "DAILY", displayOrder: 0 }, actor.adminUserId, now);
    const metadata = await admin.updateMetadata(created.missionId, { title: "Synthetic renamed", description: "", displayOrder: 1, expectedUpdatedAt: created.updatedAt }, actor.adminUserId, now);
    const rule = await admin.updateRule(created.missionId, { eventType: "puzzle.added", targetCount: 1, sourceType: null, puzzleId: null, levelId: null, conditions: {}, active: false, expectedUpdatedAt: metadata.updatedAt }, actor.adminUserId, now);
    const scheduled = await admin.updateSchedule(created.missionId, { startsAt: "2030-02-11T00:00:00Z", endsAt: null, claimDeadline: null, expectedUpdatedAt: rule.updatedAt }, actor.adminUserId, now);
    const before = await admin.history(created.missionId, historyFilter);
    await isolated.exec("BEGIN;\n" + await readFile(new URL("../drizzle/0030_mission_admin_reward_history.sql", import.meta.url), "utf8") + "\nCOMMIT;");
    expect(await admin.history(created.missionId, historyFilter)).toEqual(before);
    await admin.updateRewards(created.missionId, input(scheduled.updatedAt), actor.adminUserId, now);
    expect((await admin.history(created.missionId, historyFilter)).entries.map(row => row.action)).toEqual(["REWARDS_CONFIGURED", "SCHEDULE_CONFIGURED", "RULE_CONFIGURED", "METADATA_UPDATED", "DRAFT_CREATED"]);
    await expect(isolated.exec("DELETE FROM mission_admin_history")).rejects.toThrow(/append-only/);
    await expect(isolated.exec("TRUNCATE mission_admin_history")).rejects.toThrow(/append-only/);
  } finally { await isolated.close(); }
}, 30000);
