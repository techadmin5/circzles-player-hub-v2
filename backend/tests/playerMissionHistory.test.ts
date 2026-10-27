import { afterAll, beforeAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFile, readdir } from "node:fs/promises";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import type { Database } from "../src/db/client.js";
import * as s from "../src/db/schema.js";
import { AppError } from "../src/domain/errors.js";
import { readPlayerMissionHistory, parseMissionHistoryQuery, type PlayerMissionHistoryPage } from "../src/domain/playerMissionHistory.js";
import { PlayerMissionService, DrizzleMissionRepository } from "../src/domain/missions.js";
import { IdentityService, DrizzleIdentityRepository } from "../src/domain/identity.js";
import { hashSessionToken, SESSION_COOKIE_NAME } from "../src/domain/sessions.js";
import { registerPlayerMissionHistoryRoutes } from "../src/http/playerMissionHistoryRoutes.js";
import { capacityFixture, openCapacity, recoveryRequest } from "./helpers/missionCapacityCases.js";
import type { PlayerMissionHistoryPage as FrontendPage } from "../../src/types/missionHistory.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const contractMatches: Equal<PlayerMissionHistoryPage, FrontendPage> = true;
let pg: PGlite, db: Database;
const now = new Date("2030-02-10T12:00:00Z"), secret = "synthetic-history-session-secret-at-least-32";
beforeAll(async () => {
  pg = new PGlite(); // No URL or persistent data directory; no existing database can be targeted.
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql")).sort()) await pg.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  db = drizzle(pg, { schema: s }) as unknown as Database;
}, 60000);
afterAll(async () => { await pg.close(); });
it("keeps the frontend contract synchronized", () => expect(contractMatches).toBe(true));
it.each([{ playerId: crypto.randomUUID() }, { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { cursor: "bad!" }, { cursor: "bm90LWpzb24" }, { offset: 1 }, { limit: ["1", "2"] }])("rejects malformed or owner-selecting query %j", query => {
  expect(() => parseMissionHistoryQuery(query)).toThrow(AppError);
});
it("inactive expired earnings retain frozen rewards without mutating expiry or substituting edited current rewards", async () => {
  const f = await capacityFixture(db);
  await db.update(s.missions).set({ title: "Edited current name" }).where(eq(s.missions.missionId, f.input.missionId));
  await db.insert(s.missionRewards).values({ missionId: f.input.missionId, rewardType: "XP", amount: 999 });
  const page = await readPlayerMissionHistory(db, f.input.playerId, {}, now);
  expect(page.entries).toHaveLength(1);
  expect(page.entries[0]).toMatchObject({ title: "Edited current name", titleSource: "CURRENT_DEFINITION", state: "EXPIRED", rewards: { xp: 7, synapsePoints: 3 }, rewardSource: "EARNED_SNAPSHOT", completedAt: f.progress.completedAt?.toISOString(), claimDeadline: f.progress.claimDeadline?.toISOString() });
  expect((await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.playerMissionProgressId, f.progress.playerMissionProgressId)))[0]).toEqual(f.progress);
});
it("unclaimed earnings before their deadline and partial progress are distinct", async () => {
  const f = await capacityFixture(db);
  expect((await readPlayerMissionHistory(db, f.input.playerId, {}, new Date("2020-02-10T12:00:00Z"))).entries[0].state).toBe("UNCLAIMED");
  const [mission] = await db.insert(s.missions).values({ title: "Tracked progress", description: "", category: "DAILY", periodType: "DAILY", active: false }).returning();
  await db.insert(s.playerMissionProgress).values({ missionId: mission.missionId, playerId: f.input.playerId, periodKey: "2030-02-10", currentCount: 1, targetCountSnapshot: 2 });
  const row = (await readPlayerMissionHistory(db, f.input.playerId, {}, now)).entries.find(entry => entry.missionId === mission.missionId);
  expect(row).toMatchObject({ state: "IN_PROGRESS", rewards: null, rewardSource: "UNAVAILABLE", progress: { current: 1, target: 2 } });
});
it("expired pending/blocked exceptions remain visible without administrator notes, actors, keys or request payloads", async () => {
  const f = await capacityFixture(db), opened = await openCapacity(db, f);
  expect((await readPlayerMissionHistory(db, f.input.playerId, {}, now)).entries[0]).toMatchObject({ state: "CAPACITY_PENDING", capacity: { status: "PENDING" } });
  await f.service.recover(opened.exceptionId, { ...recoveryRequest(opened), reason: "INTERNAL_SYNTHETIC_NOTE_DO_NOT_EXPOSE" }, f.actor);
  const page = await readPlayerMissionHistory(db, f.input.playerId, {}, now);
  expect(page.entries[0]).toMatchObject({ state: "CAPACITY_BLOCKED", claimState: "UNCLAIMED", capacity: { status: "BLOCKED" }, rewards: { xp: 7, synapsePoints: 3 } });
  const encoded = JSON.stringify(page);
  for (const forbidden of ["INTERNAL_SYNTHETIC_NOTE_DO_NOT_EXPOSE", f.actor, f.input.idempotencyKey, "actorAdminUserId", "reason", "digest", "errorCode", "request"]) expect(encoded).not.toContain(forbidden);
});
it("recovered paid receipts are distinguished from ordinary payment and replay is unchanged", async () => {
  const f = await capacityFixture(db), opened = await openCapacity(db, f);
  await db.update(s.wallets).set({ balance: 0 }).where(eq(s.wallets.playerId, f.input.playerId)); // Synthetic capacity fixture only.
  await f.service.recover(opened.exceptionId, recoveryRequest(opened), f.actor);
  expect((await readPlayerMissionHistory(db, f.input.playerId, {}, now)).entries[0]).toMatchObject({ state: "RECOVERED", claimState: "PAID", rewardSource: "CLAIM_SNAPSHOT", capacity: { status: "RECOVERED" }, rewards: { xp: 7, synapsePoints: 3 } });
  const normal = await capacityFixture(db, 7, 3, 0);
  await normal.claims.claim(normal.input);
  const history = await readPlayerMissionHistory(db, normal.input.playerId, {}, now);
  expect(history.entries[0]).toMatchObject({ state: "PAID", claimState: "PAID", capacity: null, rewards: { xp: 7, synapsePoints: 3 } });
  expect(history.entries[0].claimedAt).not.toBeNull();
  expect((await normal.claims.claim(normal.input)).idempotent).toBe(true);
});
it("missing legacy earned snapshots remain unknown, including inconsistent claimed evidence", async () => {
  const f = await capacityFixture(db);
  const [mission] = await db.insert(s.missions).values({ title: "Legacy", description: "", category: "DAILY", periodType: "DAILY", active: false }).returning();
  await db.insert(s.missionRewards).values({ missionId: mission.missionId, rewardType: "XP", amount: 999 });
  await db.insert(s.playerMissionProgress).values({ missionId: mission.missionId, playerId: f.input.playerId, periodKey: "legacy", targetCountSnapshot: 1, status: "CLAIMED" });
  const row = (await readPlayerMissionHistory(db, f.input.playerId, {}, now)).entries.find(entry => entry.missionId === mission.missionId);
  expect(row).toMatchObject({ state: "REVIEW_REQUIRED", claimState: "UNKNOWN", rewards: null, rewardSource: "UNAVAILABLE" });
});
it("malformed legacy JSON reward evidence cannot break the page or fabricate amounts", async () => {
  const f = await capacityFixture(db);
  for (const snapshot of [{ version: 1, rewards: [null] }, { version: 1, rewards: "invalid" }, { version: 1, rewards: [{ type: "XP", amount: 0 }] }]) {
    const [p] = await db.insert(s.playerMissionProgress).values({ missionId: f.input.missionId, playerId: f.input.playerId, periodKey: crypto.randomUUID(), targetCountSnapshot: 1, status: "CLAIMABLE" }).returning();
    await pg.query("UPDATE player_mission_progress SET reward_snapshot=$1::jsonb WHERE player_mission_progress_id=$2", [JSON.stringify(snapshot), p.playerMissionProgressId]);
    const row = (await readPlayerMissionHistory(db, f.input.playerId, {}, now)).entries.find(entry => entry.entitlementId === p.playerMissionProgressId);
    expect(row).toMatchObject({ rewards: null, rewardSource: "UNAVAILABLE", state: "UNCLAIMED" });
  }
});
it("keyset pagination is deterministic with tied timestamps and preserves PostgreSQL microseconds", async () => {
  const f = await capacityFixture(db);
  for (let i = 0; i < 4; i++) await db.insert(s.playerMissionProgress).values({ missionId: f.input.missionId, playerId: f.input.playerId, periodKey: `history-${i}`, targetCountSnapshot: 1, createdAt: new Date("2030-01-01T00:00:00.123Z") });
  await pg.query("UPDATE player_mission_progress SET created_at='2030-01-01T00:00:00.123456Z' WHERE player_id=$1 AND period_key LIKE 'history-%'", [f.input.playerId]);
  const all = await readPlayerMissionHistory(db, f.input.playerId, { limit: 100 }, now);
  const first = await readPlayerMissionHistory(db, f.input.playerId, { limit: 2 }, now);
  const second = await readPlayerMissionHistory(db, f.input.playerId, { limit: 2, cursor: first.nextCursor }, now);
  const third = await readPlayerMissionHistory(db, f.input.playerId, { limit: 2, cursor: second.nextCursor }, now);
  expect([...first.entries, ...second.entries, ...third.entries]).toEqual(all.entries);
  expect(third.nextCursor).toBeNull();
  const cursor = JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString()); expect(cursor.at).toBe("2030-01-01T00:00:00.123456Z");
  expect(new Set(all.entries.map(entry => entry.entitlementId)).size).toBe(5);
});
it("inserting newer progress between pages cannot repeat or shift the already paged records", async () => {
  const f = await capacityFixture(db);
  for (let i = 0; i < 3; i++) await db.insert(s.playerMissionProgress).values({ missionId: f.input.missionId, playerId: f.input.playerId, periodKey: `older-${i}`, targetCountSnapshot: 1, createdAt: new Date("2020-01-01Z") });
  const before = await readPlayerMissionHistory(db, f.input.playerId, { limit: 100 }, now);
  const first = await readPlayerMissionHistory(db, f.input.playerId, { limit: 2 }, now);
  await db.insert(s.playerMissionProgress).values({ missionId: f.input.missionId, playerId: f.input.playerId, periodKey: "new", targetCountSnapshot: 1, createdAt: new Date("2040-01-01Z") });
  const rest = await readPlayerMissionHistory(db, f.input.playerId, { limit: 100, cursor: first.nextCursor }, now);
  expect([...first.entries, ...rest.entries]).toEqual(before.entries);
});
it("legacy paid receipts provide historical amounts even without an earned snapshot", async () => {
  const f = await capacityFixture(db);
  const [p] = await db.insert(s.playerMissionProgress).values({ missionId: f.input.missionId, playerId: f.input.playerId, periodKey: "legacy-paid", targetCountSnapshot: 1, currentCount: 1, status: "CLAIMED" }).returning();
  await db.insert(s.missionClaims).values({ playerId: f.input.playerId, missionId: f.input.missionId, playerMissionProgressId: p.playerMissionProgressId, periodKey: p.periodKey, synapseRewardSnapshot: 11, xpRewardSnapshot: 13, idempotencyKey: crypto.randomUUID() });
  expect((await readPlayerMissionHistory(db, f.input.playerId, {}, now)).entries.find(row => row.entitlementId === p.playerMissionProgressId)).toMatchObject({ state: "PAID", rewardSource: "CLAIM_SNAPSHOT", rewards: { xp: 13, synapsePoints: 11 } });
});
it.each(["0000-01-01T00:00:00.000000Z", "2030-02-30T00:00:00.000000Z", "2030-01-01T00:00:00Z"])("rejects invalid or lossy cursor time %s before SQL", at => {
  expect(() => parseMissionHistoryQuery({ cursor: Buffer.from(JSON.stringify({ at, id: crypto.randomUUID() })).toString("base64url") })).toThrow(AppError);
});
it("HTTP sessions strictly scope history, reject owner assertions, and execute in a read-only transaction", async () => {
  const a = await capacityFixture(db), b = await capacityFixture(db), token = crypto.randomUUID();
  const [player] = await db.select().from(s.players).where(eq(s.players.playerId, a.input.playerId));
  await db.insert(s.authSessions).values({ userId: player.userId, tokenHash: hashSessionToken(token, secret), expiresAt: new Date(Date.now() + 60000) });
  const app = Fastify(); await app.register(cookie);
  app.setErrorHandler((error, _request, reply) => { if (error instanceof AppError) reply.code(error.statusCode).send({ code: error.code }); else reply.code(500).send({ code: "INTERNAL" }); });
  registerPlayerMissionHistoryRoutes(app, new IdentityService(new DrizzleIdentityRepository(db), secret), new PlayerMissionService(new DrizzleMissionRepository(db)));
  const headers = { cookie: `${SESSION_COOKIE_NAME}=${token}` };
  try {
    expect((await app.inject({ url: "/api/missions/history" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/missions/history", headers: { cookie: `${SESSION_COOKIE_NAME}=invalid` } })).statusCode).toBe(401);
    expect((await app.inject({ url: `/api/missions/history?playerId=${b.input.playerId}`, headers })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/missions/history?cursor=bad!", headers })).statusCode).toBe(400);
    await pg.exec("BEGIN READ ONLY");
    try {
      const response = await app.inject({ url: "/api/missions/history?limit=1", headers });
      expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("private, no-store");
      const page: PlayerMissionHistoryPage = response.json(); expect(page.entries).toHaveLength(1);
      expect(page.entries[0].entitlementId).toBe(a.progress.playerMissionProgressId);
      expect(JSON.stringify(page)).not.toContain(b.input.missionId);
    } finally { await pg.exec("ROLLBACK"); }
    await db.update(s.authSessions).set({ status: "REVOKED", revokedAt: new Date() }).where(eq(s.authSessions.tokenHash, hashSessionToken(token, secret)));
    expect((await app.inject({ url: "/api/missions/history", headers })).statusCode).toBe(401);
  } finally { await app.close(); }
});
it("a different player's cursor cannot select that player's records", async () => {
  const a = await capacityFixture(db), b = await capacityFixture(db);
  const foreignCursor = Buffer.from(JSON.stringify({ at: "2099-01-01T00:00:00.000000Z", id: b.progress.playerMissionProgressId })).toString("base64url");
  expect((await readPlayerMissionHistory(db, a.input.playerId, { cursor: foreignCursor }, now)).entries.map(entry => entry.entitlementId)).toEqual([a.progress.playerMissionProgressId]);
});
