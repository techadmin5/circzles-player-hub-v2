import { MissionCapacityService } from "../src/domain/missionCapacityExceptions.js";
import { missionCapacityExceptions } from "../src/db/missionAdminSchema.js";
import { beforeAll, afterAll, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db/client.js";
import * as s from "../src/db/schema.js";
import * as c from "../src/db/missionChestSchema.js";
import { DrizzleGameStateRepository, grantXpInTransaction, creditPointsInTransaction, debitPointsInTransaction } from "../src/domain/gameState.js";
import { DrizzleMissionClaimRepository } from "../src/domain/missions.js";
import { MissionChestService } from "../src/domain/missionChests.js";
import { freezeRewards } from "../src/domain/missionLifecycle.js";

let pg: PGlite, db: Database;
const now = new Date("2030-02-10T12:00:00Z"), max = 2147483647, xpMax = Number.MAX_SAFE_INTEGER;
beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql")).sort()) await pg.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  db = drizzle(pg, { schema: s }) as unknown as Database;
  await new DrizzleGameStateRepository(db).seedProgressionLevels([{ progressionLevel: 1, rankName: "Synthetic", xpRequired: 0, rewards: [] }]);
}, 60000);
afterAll(async () => { await pg.close(); });
async function player(sp = 0, xp = 0) {
  const [user] = await db.insert(s.users).values({ verifiedEmail: crypto.randomUUID() + "@example.test" }).returning();
  const [row] = await db.insert(s.players).values({ userId: user.userId, displayName: "Synthetic arithmetic" }).returning();
  await db.insert(s.wallets).values({ playerId: row.playerId, balance: sp });
  await db.insert(s.playerProgression).values({ playerId: row.playerId, totalXp: xp, progressionLevel: 1, rankName: "Synthetic" });
  return row.playerId;
}
const grant = (playerId: string, amount: number, key = crypto.randomUUID()) => ({ playerId, amount, reason: "Synthetic arithmetic test", sourceType: "SYNTHETIC", idempotencyKey: key });
async function state() {
  return Promise.all([db.select().from(s.wallets), db.select().from(s.playerProgression), db.select().from(s.xpTransactions), db.select().from(s.pointTransactions), db.select().from(s.gameEvents), db.select().from(s.playerMissionProgress), db.select().from(s.missionClaims), db.select().from(c.playerMissionChests), db.select().from(c.missionChestClaims)]);
}
async function earned(playerId: string, xp: number, sp: number) {
  // Inactive synthetic definition and directly inserted earned fixture; no activation or processor.
  const [mission] = await db.insert(s.missions).values({ title: "Synthetic earned fixture", description: "", category: "DAILY", periodType: "DAILY", active: false }).returning();
  const rewardSnapshot = freezeRewards([...(xp ? [{ rewardType: "XP", amount: xp }] : []), ...(sp ? [{ rewardType: "SYNAPSE_POINTS", amount: sp }] : [])]);
  const [progress] = await db.insert(s.playerMissionProgress).values({ playerId, missionId: mission.missionId, periodKey: "2030-02-10", targetCountSnapshot: 1, currentCount: 1, status: "CLAIMABLE", rewardSnapshot, completedAt: now, claimDeadline: new Date("2030-02-12Z") }).returning();
  return { playerId, missionId: mission.missionId, periodKey: progress.periodKey, idempotencyKey: crypto.randomUUID(), now };
}
it.each([0, -1, 1.5, max + 1, NaN, Infinity])("rejects invalid internal grant/debit amount %s before initialization or writes", async amount => {
  const id = await player(), before = await state();
  for (const execute of [grantXpInTransaction, creditPointsInTransaction, debitPointsInTransaction]) await expect(db.transaction(async tx => { await execute(tx, grant(id, amount)); })).rejects.toMatchObject({ code: "REWARD_AMOUNT_INVALID" });
  expect(await state()).toEqual(before);
});
it("accepts SP exactly at the PostgreSQL maximum and replays without adding again", async () => {
  const id = await player(), data = grant(id, max);
  const first = await db.transaction(tx => creditPointsInTransaction(tx, data));
  expect(first.balanceAfter).toBe(max);
  const replay = await db.transaction(tx => creditPointsInTransaction(tx, data));
  expect(replay).toMatchObject({ idempotent: true, transactionId: first.transactionId, balanceAfter: max });
  const before = await state();
  await expect(db.transaction(tx => creditPointsInTransaction(tx, grant(id, 1)))).rejects.toMatchObject({ code: "SP_BALANCE_LIMIT_EXCEEDED", statusCode: 409 });
  expect(await state()).toEqual(before);
});
it("accepts exact XP safe-integer ceiling, replays it and rejects the next unit", async () => {
  const id = await player(0, xpMax - max), data = grant(id, max);
  const first = await db.transaction(tx => grantXpInTransaction(tx, data));
  expect(first.totalXpAfter).toBe(xpMax);
  expect((await db.transaction(tx => grantXpInTransaction(tx, data))).idempotent).toBe(true);
  const before = await state();
  await expect(db.transaction(tx => grantXpInTransaction(tx, grant(id, 1)))).rejects.toMatchObject({ code: "XP_TOTAL_LIMIT_EXCEEDED", statusCode: 409 });
  expect(await state()).toEqual(before);
  expect((await pg.query<{ value: string }>("SELECT total_xp::text AS value FROM player_progression WHERE player_id=$1", [id])).rows[0].value).toBe(String(xpMax));
});
it.each(["9007199254740992", "9007199254740993", "9223372036854775807"])("reads unsafe historical XP %s as exact text and fails closed instead of rounding", async raw => {
  const id = await player(); await pg.query("UPDATE player_progression SET total_xp=$1::bigint WHERE player_id=$2", [raw, id]);
  const before = await state();
  await expect(db.transaction(tx => grantXpInTransaction(tx, grant(id, 1)))).rejects.toMatchObject({ code: "XP_TOTAL_UNSAFE" });
  await expect(new DrizzleGameStateRepository(db).getPlayerGameState(id)).rejects.toMatchObject({ code: "XP_TOTAL_UNSAFE" });
  expect(await state()).toEqual(before);
  expect((await pg.query<{ value: string }>("SELECT total_xp::text AS value FROM player_progression WHERE player_id=$1", [id])).rows[0].value).toBe(raw);
});
it("rejects an unsafe historical XP receipt replay without changing its key or data", async () => {
  const id = await player(), data = grant(id, 1);
  const receipt = await db.transaction(tx => grantXpInTransaction(tx, data));
  await pg.query("UPDATE xp_transactions SET total_xp_after=$1::bigint WHERE xp_transaction_id=$2", ["9007199254740993", receipt.transactionId]);
  const before = await state();
  await expect(db.transaction(tx => grantXpInTransaction(tx, data))).rejects.toMatchObject({ code: "XP_TOTAL_UNSAFE" }); expect(await state()).toEqual(before);
});
it("preserves insufficient-points debit semantics and idempotency conflicts", async () => {
  const id = await player(1), data = grant(id, 1);
  await expect(db.transaction(tx => debitPointsInTransaction(tx, grant(id, 2)))).rejects.toMatchObject({ code: "INSUFFICIENT_POINTS" });
  const first = await db.transaction(tx => debitPointsInTransaction(tx, data)); expect(first.balanceAfter).toBe(0);
  expect((await db.transaction(tx => debitPointsInTransaction(tx, data))).idempotent).toBe(true);
  const before = await state();
  await expect(db.transaction(tx => creditPointsInTransaction(tx, data))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" }); expect(await state()).toEqual(before);
});
it.each(["XP", "SP"])("rolls back an entire frozen mission claim on %s overflow, including earlier SP writes", async type => {
  const id = await player(type === "SP" ? max : 0, type === "XP" ? xpMax : 0), claim = await earned(id, 1, 1), before = await state();
  await expect(new DrizzleMissionClaimRepository(db).claim(claim)).rejects.toMatchObject({ code: "MISSION_CAPACITY_PENDING" });
  expect(await state()).toEqual(before);
});
it("reserves an exception key and permits exact frozen recovery only by SUPER_ADMIN", async () => {
  const id = await player(max), claim = await earned(id, 0, 1), repo = new DrizzleMissionClaimRepository(db);
  await expect(repo.claim(claim)).rejects.toMatchObject({ code: "MISSION_CAPACITY_PENDING" });
  await db.update(s.wallets).set({ balance: max - 1 }).where(eq(s.wallets.playerId, id)); // Synthetic capacity change only.
  await expect(repo.claim(claim)).rejects.toMatchObject({ code: "MISSION_CAPACITY_PENDING" });
  const [user] = await db.insert(s.users).values({ verifiedEmail: crypto.randomUUID()+"@test.invalid" }).returning();
  const [admin] = await db.insert(s.adminUsers).values({ userId: user.userId, role: "SUPER_ADMIN" }).returning();
  const [exception] = await db.select().from(missionCapacityExceptions).where(eq(missionCapacityExceptions.playerId,id));
  const service = new MissionCapacityService(db), current = await service.detail(exception.exceptionId,admin.adminUserId);
  await service.recover(exception.exceptionId,{expectedEventId:current.revision,digest:current.digest,reason:"Synthetic recovery",idempotencyKey:crypto.randomUUID()},admin.adminUserId);
  const success = await repo.claim(claim); expect(success.awarded.synapsePoints).toBe(1);
  const replay = await repo.claim(claim); expect(replay.idempotent).toBe(true); expect(replay.missionClaimId).toBe(success.missionClaimId);
});
it("capacity failure preserves eligibility and deadline but does not extend the original expiry", async () => {
  const id = await player(max), claim = await earned(id, 1, 1), repo = new DrizzleMissionClaimRepository(db);
  const [before] = await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.playerId, id));
  await expect(repo.claim(claim)).rejects.toMatchObject({ code: "MISSION_CAPACITY_PENDING" });
  expect((await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.playerId, id)))[0]).toEqual(before);
  await expect(repo.claim({ ...claim, now: before.claimDeadline! })).rejects.toMatchObject({ code: "MISSION_CAPACITY_PENDING" });
  const [expired] = await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.playerId, id));
  expect(expired).toMatchObject({ status: "CLAIMABLE", claimedAt: null, rewardSnapshot: before.rewardSnapshot, claimDeadline: before.claimDeadline, expiredAt: null });
  expect(await db.select().from(s.missionClaims).where(eq(s.missionClaims.playerId, id))).toEqual([]);
  expect(await db.select().from(s.pointTransactions).where(eq(s.pointTransactions.playerId, id))).toEqual([]);
  expect(await db.select().from(s.xpTransactions).where(eq(s.xpTransactions.playerId, id))).toEqual([]);
});
it.each(["SP", "XP"])("serializes competing synthetic %s claims at capacity without partial awards", async type => {
  const id = await player(type === "SP" ? max - 1 : 0, type === "XP" ? xpMax - 1 : 0);
  const claims = await Promise.all([earned(id, type === "XP" ? 1 : 0, type === "SP" ? 1 : 0), earned(id, type === "XP" ? 1 : 0, type === "SP" ? 1 : 0)]);
  const repo = new DrizzleMissionClaimRepository(db), result = await Promise.allSettled(claims.map(claim => repo.claim(claim)));
  expect(result.filter(row => row.status === "fulfilled")).toHaveLength(1);
  expect(result.find(row => row.status === "rejected")).toMatchObject({ reason: { code: "MISSION_CAPACITY_PENDING" } });
  expect(await db.select().from(s.missionClaims).where(eq(s.missionClaims.playerId, id))).toHaveLength(1);
  const progress = await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.playerId, id));
  expect(progress.map(row => row.status).sort()).toEqual(["CLAIMABLE", "CLAIMED"]);
});
it("concurrent duplicate claim keys award once and return the same safe receipt", async () => {
  const id = await player(), claim = await earned(id, 1, 1), repo = new DrizzleMissionClaimRepository(db);
  const results = await Promise.all([repo.claim(claim), repo.claim(claim)]);
  expect(results[0].missionClaimId).toBe(results[1].missionClaimId); expect(results.filter(row => row.idempotent)).toHaveLength(1);
  expect(await db.select().from(s.missionClaims).where(eq(s.missionClaims.playerId, id))).toHaveLength(1);
});
it("rolls back a chest claim and its SP credit when the following XP grant is unsafe", async () => {
  const id = await player(0, xpMax), rewards = freezeRewards([{ rewardType: "XP", amount: 1 }, { rewardType: "SYNAPSE_POINTS", amount: 1 }]);
  const [chest] = await db.insert(c.missionChests).values({ title: "Synthetic unlocked fixture", periodType: "DAILY", targetCount: 1, active: false, rewards }).returning();
  await db.insert(c.playerMissionChests).values({ playerId: id, chestId: chest.chestId, periodKey: "2030-02-10", currentCount: 1, targetCountSnapshot: 1, periodStartsAt: new Date("2030-02-10Z"), periodEndsAt: new Date("2030-02-11Z"), claimDeadline: new Date("2030-02-12Z"), unlockedAt: now, rewardSnapshot: rewards });
  const before = await state();
  await expect(new MissionChestService(db).claim({ playerId: id, chestId: chest.chestId, periodKey: "2030-02-10", idempotencyKey: crypto.randomUUID(), now })).rejects.toMatchObject({ code: "CHEST_CAPACITY_PENDING" });
  expect(await state()).toEqual(before);
});
