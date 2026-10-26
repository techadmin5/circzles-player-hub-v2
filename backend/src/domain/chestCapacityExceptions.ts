import { capacityDigest } from "./missionCapacityExceptions.js";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { adminUsers } from "../db/schema.js";
import { missionChests, missionChestClaims, playerMissionChests } from "../db/missionChestSchema.js";
import { chestCapacityExceptions as exceptions, chestCapacityRequests as requests, chestCapacityEvents as events } from "../db/missionChestSchema.js";
import { AppError, forbidden, validationFailed } from "./errors.js";
import type { GameStateTransaction } from "./gameState.js";
import { chestClaimResult, payUnlockedChest, type ChestClaimInput, type ChestClaimResult } from "./missionChests.js";
import { snapshotTotals } from "./missionLifecycle.js";

export const pendingCapacityError = (id: string) => new AppError("CHEST_CAPACITY_PENDING", "Your on-time claim is recorded for administrator recovery. No XP/SP was awarded. Its original deadline and reward are preserved.", 409, { exceptionId: id });
export async function recordChestCapacityException(tx: GameStateTransaction, p: typeof playerMissionChests.$inferSelect, key: string, arrivedAt: Date, errorCode: string) {
  if (!p.unlockedAt || p.unlockedAt > arrivedAt || (p.claimDeadline && arrivedAt >= p.claimDeadline)) throw new AppError("CHEST_CAPACITY_NOT_ELIGIBLE", "No qualifying on-time earned claim exists.", 409);
  const totals = snapshotTotals(p.rewardSnapshot);
  const recordedAt = new Date();
  const [chest] = await tx.select().from(missionChests).where(eq(missionChests.chestId,p.chestId));
  const [row] = await tx.insert(exceptions).values({ periodType: chest.periodType, progressId: p.playerChestId, playerId: p.playerId, chestId: p.chestId, periodKey: p.periodKey, originalKey: key, arrivedAt, recordedAt, claimDeadline: p.claimDeadline, rewardSnapshot: p.rewardSnapshot!, digest: capacityDigest(p.rewardSnapshot), ...totals }).returning();
  await tx.insert(requests).values({ exceptionId: row.exceptionId, playerId: p.playerId, key });
  await tx.insert(events).values({ exceptionId: row.exceptionId, action: "OPENED", occurredAt: recordedAt, errorCode, reason: "Eligible on-time claim exceeded payout capacity." });
  return row.exceptionId;
}
export async function findChestCapacityException(tx: GameStateTransaction, input: ChestClaimInput, progress?: typeof playerMissionChests.$inferSelect): Promise<ChestClaimResult | { capacityExceptionId: string } | null> {
  const [row] = progress ? await tx.select().from(exceptions).where(eq(exceptions.progressId, progress.playerChestId)) : await tx.select({ exception: exceptions }).from(requests).innerJoin(exceptions, eq(exceptions.exceptionId, requests.exceptionId)).where(and(eq(requests.playerId, input.playerId), eq(requests.key, input.idempotencyKey))).then(rows => rows.map(r => r.exception));
  if (!row) return null;
  if (row.playerId !== input.playerId || row.chestId !== input.chestId || (input.periodKey && input.periodKey !== row.periodKey)) throw new AppError("IDEMPOTENCY_CONFLICT", "Claim key belongs to a different entitlement.", 409);
  if (!progress) await tx.select().from(playerMissionChests).where(eq(playerMissionChests.playerChestId, row.progressId)).for("update");
  const [claim] = await tx.select().from(missionChestClaims).where(eq(missionChestClaims.playerChestId, row.progressId));
  if (claim) return chestClaimResult(tx, claim, true);
  await tx.insert(requests).values({ exceptionId: row.exceptionId, playerId: input.playerId, key: input.idempotencyKey }).onConflictDoNothing();
  return { capacityExceptionId: row.exceptionId };
}
const recoveryInput = z.object({
  expectedEventId: z.string().regex(/^[1-9]\d{0,18}$/).refine(v => BigInt(v) <= 9223372036854775807n),
  digest: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(1).max(2000), idempotencyKey: z.string().uuid(),
}).strict();
export class ChestCapacityService {
  constructor(private db: Database) {}
  private async actor(tx: GameStateTransaction, id: string) {
    const [actor] = await tx.select().from(adminUsers).where(eq(adminUsers.adminUserId, id)).for("share");
    if (!actor?.active || actor.role !== "SUPER_ADMIN") throw forbidden("Only an active SUPER_ADMIN may inspect or recover capacity exceptions.");
  }
  async list(chestId: string, actor: string, limit = 25, offset = 0) {
    return this.db.transaction(async tx => {
      await this.actor(tx, actor);
      const rows = await tx.select().from(exceptions).where(eq(exceptions.chestId, chestId)).orderBy(desc(exceptions.recordedAt), asc(exceptions.exceptionId)).limit(limit + 1).offset(offset);
      return { entries: await Promise.all(rows.slice(0, limit).map(row => this.read(tx, row.exceptionId))), hasMore: rows.length > limit, limit, offset };
    });
  }
  detail(id: string, actor: string) { return this.db.transaction(async tx => { await this.actor(tx, actor); return this.read(tx, id); }, { isolationLevel: "repeatable read" }); }
  private async read(tx: GameStateTransaction, id: string) {
    const [row] = await tx.select().from(exceptions).where(eq(exceptions.exceptionId, id));
    if (!row) throw new AppError("CHEST_EXCEPTION_NOT_FOUND", "Capacity exception was not found.", 404);
    const history = await tx.select().from(events).where(eq(events.exceptionId, id)).orderBy(asc(events.eventId));
    return { exceptionId: id, chestId: row.chestId, playerId: row.playerId, progressId: row.progressId, periodKey: row.periodKey, arrivedAt: row.arrivedAt.toISOString(), recordedAt: row.recordedAt.toISOString(), claimDeadline: row.claimDeadline?.toISOString() ?? null, xp: row.xp, synapsePoints: row.synapsePoints, digest: row.digest, status: history.at(-1)?.action === "RECOVERED" ? "RECOVERED" as const : "PENDING" as const, revision: history.at(-1)!.eventId.toString(), history: history.map(e => ({ eventId: e.eventId.toString(), action: e.action, actorAdminUserId: e.actorAdminUserId, occurredAt: e.occurredAt.toISOString(), reason: e.reason, errorCode: e.errorCode, claimId: e.claimId })) };
  }
  async recover(id: string, input: unknown, actor: string) {
    const parsed = recoveryInput.safeParse(input);
    if (!parsed.success) throw validationFailed("Provide the loaded event revision/digest, a reason and a unique recovery UUID only.");
    const { idempotencyKey: key, ...request } = parsed.data;
    return this.db.transaction(async tx => {
      const [row] = await tx.select().from(exceptions).where(eq(exceptions.exceptionId, id));
      if (!row) throw new AppError("CHEST_EXCEPTION_NOT_FOUND", "Capacity exception was not found.", 404);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`chest-key:${row.playerId}:${row.originalKey}`}, 0))`);
      await tx.select().from(missionChests).where(eq(missionChests.chestId,row.chestId)).for("share");
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`chest-period:${row.playerId}:${row.periodType}:${row.periodKey}`},0))`);
      const [progress] = await tx.select().from(playerMissionChests).where(eq(playerMissionChests.playerChestId, row.progressId)).for("update");
      await this.actor(tx, actor);
      const [previous] = await tx.select().from(events).where(and(eq(events.exceptionId, id), eq(events.key, key)));
      if (previous) {
        if (previous.actorAdminUserId !== actor || capacityDigest(previous.request) !== capacityDigest(request)) throw new AppError("IDEMPOTENCY_CONFLICT", "Recovery key belongs to another operation.", 409);
        return { ...await this.read(tx, id), idempotent: true };
      }
      const current = await this.read(tx, id);
      if (current.revision !== request.expectedEventId || row.digest !== request.digest) throw new AppError("CHEST_EXCEPTION_CONFLICT", "Exception history changed. Reload before authorizing recovery.", 409);
      if (current.status === "RECOVERED") throw new AppError("CHEST_EXCEPTION_RESOLVED", "This exception was already recovered.", 409);
      if (!progress || progress.playerId !== row.playerId || progress.chestId !== row.chestId || progress.periodKey !== row.periodKey || !!progress.claimedAt || capacityDigest(progress.rewardSnapshot) !== row.digest || progress.claimDeadline?.getTime() !== row.claimDeadline?.getTime() || !progress.unlockedAt || progress.unlockedAt > row.arrivedAt || (row.claimDeadline && row.arrivedAt >= row.claimDeadline)) throw new AppError("CHEST_EXCEPTION_INVALID", "Original entitlement evidence does not match; recovery requires investigation.", 409);
      const totals = snapshotTotals(progress.rewardSnapshot);
      if (totals.xp !== row.xp || totals.synapsePoints !== row.synapsePoints) throw new AppError("CHEST_EXCEPTION_INVALID", "Frozen reward amounts do not match.", 409);
      let claim: ChestClaimResult | undefined, errorCode: string | null = null;
      try { claim = await tx.transaction(nested => payUnlockedChest(nested, progress, row.originalKey)); }
      catch (error) {
        if (!(error instanceof AppError) || !["SP_BALANCE_LIMIT_EXCEEDED", "XP_TOTAL_LIMIT_EXCEEDED"].includes(error.code)) throw error;
        errorCode = error.code;
      }
      await tx.insert(events).values({ exceptionId: id, actorAdminUserId: actor, occurredAt: new Date(), action: claim ? "RECOVERED" : "RECOVERY_BLOCKED", reason: request.reason, request, key, errorCode, claimId: claim?.chestClaimId ?? null });
      return { ...await this.read(tx, id), idempotent: false };
    });
  }
}
