import { it, expect } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../../src/db/client.js";
import * as s from "../../src/db/schema.js";
import { missionCapacityEvents, missionCapacityExceptions, missionCapacityRequests } from "../../src/db/missionAdminSchema.js";
import { MissionCapacityService } from "../../src/domain/missionCapacityExceptions.js";
import { DrizzleMissionClaimRepository } from "../../src/domain/missions.js";

export const arrival = new Date("2020-02-10T12:00:00Z"), deadline = new Date("2020-02-10T12:00:01Z");
export async function capacityFixture(db: Database, xp = 7, sp = 3, balance = 2147483647, totalXp = 0, timing = { arrival, deadline }) {
  await db.insert(s.progressionLevels).values({ progressionLevel: 1, rankName: "Synthetic", xpRequired: 0, rewards: [] }).onConflictDoNothing();
  const [user] = await db.insert(s.users).values({ verifiedEmail: crypto.randomUUID() + "@test.invalid" }).returning();
  const [player] = await db.insert(s.players).values({ userId: user.userId, displayName: "Synthetic capacity" }).returning();
  await db.insert(s.wallets).values({ playerId: player.playerId, balance });
  await db.insert(s.playerProgression).values({ playerId: player.playerId, totalXp, progressionLevel: 1, rankName: "Synthetic" });
  const [mission] = await db.insert(s.missions).values({ title: "Synthetic earned", description: "", category: "DAILY", periodType: "DAILY", active: false }).returning();
  const [progress] = await db.insert(s.playerMissionProgress).values({ playerId: player.playerId, missionId: mission.missionId, periodKey: "2020-02-10", status: "CLAIMABLE", currentCount: 1, targetCountSnapshot: 1, completedAt: new Date(timing.arrival.getTime() - 1000), claimDeadline: timing.deadline, rewardSnapshot: { version: 1, rewards: [...(xp ? [{ type: "XP" as const, amount: xp }] : []), ...(sp ? [{ type: "SYNAPSE_POINTS" as const, amount: sp }] : [])] } }).returning();
  const [adminUser] = await db.insert(s.users).values({ verifiedEmail: crypto.randomUUID() + "@test.invalid" }).returning();
  const [admin] = await db.insert(s.adminUsers).values({ userId: adminUser.userId, role: "SUPER_ADMIN" }).returning();
  return { input: { playerId: player.playerId, missionId: mission.missionId, periodKey: progress.periodKey, idempotencyKey: crypto.randomUUID(), arrivedAt: timing.arrival }, progress, actor: admin.adminUserId, claims: new DrizzleMissionClaimRepository(db), service: new MissionCapacityService(db) };
}
export async function openCapacity(db: Database, fixture: Awaited<ReturnType<typeof capacityFixture>>) {
  await expect(fixture.claims.claim(fixture.input)).rejects.toMatchObject({ code: "MISSION_CAPACITY_PENDING" });
  const [row] = await db.select().from(missionCapacityExceptions).where(eq(missionCapacityExceptions.progressId, fixture.progress.playerMissionProgressId));
  return fixture.service.detail(row.exceptionId, fixture.actor);
}
export const recoveryRequest = (row: { revision: string; digest: string }) => ({ expectedEventId: row.revision, digest: row.digest, reason: "Explicit synthetic recovery authorization", idempotencyKey: crypto.randomUUID() });
export function capacityCases(getDb: () => Database) {
  it("records an on-time exception once, preserving original frozen evidence and no reward effects", async () => {
    const db = getDb(), f = await capacityFixture(db), pending = await openCapacity(db, f);
    expect(pending).toMatchObject({ status: "PENDING", xp: 7, synapsePoints: 3, arrivedAt: arrival.toISOString(), claimDeadline: deadline.toISOString() });
    const alias = { ...f.input, idempotencyKey: crypto.randomUUID(), arrivedAt: new Date("2040-01-01Z") };
    await expect(f.claims.claim(alias)).rejects.toMatchObject({ code: "MISSION_CAPACITY_PENDING" });
    await expect(f.claims.claim(f.input)).rejects.toMatchObject({ code: "MISSION_CAPACITY_PENDING" });
    expect(await f.service.detail(pending.exceptionId, f.actor)).toEqual(pending);
    expect(await db.select().from(missionCapacityRequests).where(eq(missionCapacityRequests.exceptionId, pending.exceptionId))).toHaveLength(2);
    expect(await db.select().from(s.missionClaims).where(eq(s.missionClaims.playerId, f.input.playerId))).toEqual([]);
    expect((await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.playerMissionProgressId, f.progress.playerMissionProgressId)))[0]).toEqual(f.progress);
  });
  it("XP failure rolls back prior SP/ledger/events; explicit recovery pays once after the unchanged deadline", async () => {
    const db = getDb(), f = await capacityFixture(db, 7, 3, 10, Number.MAX_SAFE_INTEGER), row = await openCapacity(db, f);
    expect((await db.select().from(s.wallets).where(eq(s.wallets.playerId, f.input.playerId)))[0].balance).toBe(10);
    for (const table of [s.pointTransactions, s.xpTransactions, s.gameEvents]) expect(await db.select().from(table).where(eq(table.playerId, f.input.playerId))).toEqual([]);
    const request = recoveryRequest(row);
    const blocked = await f.service.recover(row.exceptionId, request, f.actor);
    expect(blocked.status).toBe("PENDING"); expect(blocked.history.at(-1)?.action).toBe("RECOVERY_BLOCKED");
    expect((await f.service.recover(row.exceptionId, request, f.actor)).idempotent).toBe(true);
    // Synthetic fixture capacity setup only; no runtime balance-manipulation endpoint exists.
    await db.update(s.playerProgression).set({ totalXp: 0 }).where(eq(s.playerProgression.playerId, f.input.playerId));
    const recovered = await f.service.recover(row.exceptionId, recoveryRequest(blocked), f.actor);
    expect(recovered.status).toBe("RECOVERED");
    expect((await f.claims.claim({ ...f.input, arrivedAt: new Date("2040-01-01Z") })).awarded).toEqual({ xp: 7, synapsePoints: 3 });
    expect((await db.select().from(s.wallets).where(eq(s.wallets.playerId, f.input.playerId)))[0].balance).toBe(13);
    expect(await db.select().from(s.pointTransactions).where(eq(s.pointTransactions.playerId, f.input.playerId))).toHaveLength(1);
    expect(await db.select().from(s.xpTransactions).where(eq(s.xpTransactions.playerId, f.input.playerId))).toHaveLength(1);
  });
  it.each(["2020-02-10T12:00:01Z", "2020-02-11Z"])("late/equal ordinary arrival %s cannot create an exception", async time => {
    const db = getDb(), f = await capacityFixture(db);
    await expect(f.claims.claim({ ...f.input, arrivedAt: new Date(time) })).rejects.toMatchObject({ code: "MISSION_CLAIM_EXPIRED" });
    expect(await db.select().from(missionCapacityExceptions).where(eq(missionCapacityExceptions.progressId, f.progress.playerMissionProgressId))).toEqual([]);
  });
  it("unsafe stored XP is not treated as a valid capacity exception", async () => {
    const db = getDb(), f = await capacityFixture(db, 7, 3, 2147483647);
    await db.execute(sql`UPDATE player_progression SET total_xp=9007199254740992 WHERE player_id=${f.input.playerId}`);
    await expect(f.claims.claim(f.input)).rejects.toMatchObject({ code: "XP_TOTAL_UNSAFE" });
    expect(await db.select().from(missionCapacityExceptions).where(eq(missionCapacityExceptions.progressId, f.progress.playerMissionProgressId))).toEqual([]);
  });
  it("same-key recovery replay is bound to actor, payload and event revision", async () => {
    const db = getDb(), f = await capacityFixture(db), row = await openCapacity(db, f), request = recoveryRequest(row);
    await f.service.recover(row.exceptionId, request, f.actor);
    await expect(f.service.recover(row.exceptionId, { ...request, reason: "Different" }, f.actor)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(f.service.recover(row.exceptionId, recoveryRequest(row), f.actor)).rejects.toMatchObject({ code: "MISSION_EXCEPTION_CONFLICT" });
  });
  it.each(["actor", "amount", "timestamp", "digest"])("rejects untrusted recovery %s", async field => {
    const db = getDb(), f = await capacityFixture(db), row = await openCapacity(db, f), request = recoveryRequest(row);
    const payload = field === "digest" ? { ...request, digest: "0".repeat(64) } : { ...request, [field]: "forged" };
    await expect(f.service.recover(row.exceptionId, payload, f.actor)).rejects.toMatchObject({ code: field === "digest" ? "MISSION_EXCEPTION_CONFLICT" : "VALIDATION_FAILED" });
  });
  it("SUPER_ADMIN is enforced independently for inspection and recovery", async () => {
    const db = getDb(), f = await capacityFixture(db), row = await openCapacity(db, f);
    await db.update(s.adminUsers).set({ role: "REVIEWER" }).where(eq(s.adminUsers.adminUserId, f.actor));
    await expect(f.service.detail(row.exceptionId, f.actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.service.recover(row.exceptionId, recoveryRequest(row), f.actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("frozen evidence tampering fails closed and cannot replace an exception reward", async () => {
    const db = getDb(), f = await capacityFixture(db), row = await openCapacity(db, f);
    await expect(db.update(s.playerMissionProgress).set({ rewardSnapshot: { version: 1, rewards: [{ type: "XP", amount: 8 }] } }).where(eq(s.playerMissionProgress.playerMissionProgressId, f.progress.playerMissionProgressId))).rejects.toThrow();
    await expect(f.service.recover(row.exceptionId, { ...recoveryRequest(row), digest: "0".repeat(64) }, f.actor)).rejects.toMatchObject({ code: "MISSION_EXCEPTION_CONFLICT" });
    expect(await db.select().from(missionCapacityEvents).where(eq(missionCapacityEvents.exceptionId, row.exceptionId))).toHaveLength(1);
  });
}
