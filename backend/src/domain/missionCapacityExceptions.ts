import { createHash } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { adminUsers, missionClaims, playerMissionProgress } from "../db/schema.js";
import { missionCapacityExceptions as exceptions, missionCapacityRequests as requests, missionCapacityEvents as events } from "../db/missionAdminSchema.js";
import { AppError, forbidden, validationFailed } from "./errors.js";
import type { GameStateTransaction } from "./gameState.js";
import { claimResult, payEarnedMission, type MissionClaimInput, type MissionClaimResult } from "./missions.js";
import { snapshotTotals } from "./missionLifecycle.js";

export function capacityDigest(value: unknown): string {
  function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, item]) => [k, canonical(item)]));
    return v;
  }
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export const pendingCapacityError = (id: string) => new AppError("MISSION_CAPACITY_PENDING", "Your on-time claim is recorded for administrator recovery. No XP/SP was awarded. Its original deadline and reward are preserved.", 409, { exceptionId: id });
export async function recordMissionCapacityException(tx: GameStateTransaction, p: typeof playerMissionProgress.$inferSelect, key: string, arrivedAt: Date, errorCode: string) {
  if (!p.completedAt || p.completedAt > arrivedAt || (p.claimDeadline && arrivedAt >= p.claimDeadline)) throw new AppError("MISSION_CAPACITY_NOT_ELIGIBLE", "No qualifying on-time earned claim exists.", 409);
  const totals = snapshotTotals(p.rewardSnapshot);
  const recordedAt = new Date();
  const [row] = await tx.insert(exceptions).values({ progressId: p.playerMissionProgressId, playerId: p.playerId, missionId: p.missionId, periodKey: p.periodKey, originalKey: key, arrivedAt, recordedAt, claimDeadline: p.claimDeadline, rewardSnapshot: p.rewardSnapshot!, digest: capacityDigest(p.rewardSnapshot), ...totals }).returning();
  await tx.insert(requests).values({ exceptionId: row.exceptionId, playerId: p.playerId, key });
  await tx.insert(events).values({ exceptionId: row.exceptionId, action: "OPENED", occurredAt: recordedAt, errorCode, reason: "Eligible on-time claim exceeded payout capacity." });
  return row.exceptionId;
}
export async function findMissionCapacityException(tx: GameStateTransaction, input: MissionClaimInput, progress?: typeof playerMissionProgress.$inferSelect): Promise<MissionClaimResult | { capacityExceptionId: string } | null> {
  const [row] = progress ? await tx.select().from(exceptions).where(eq(exceptions.progressId, progress.playerMissionProgressId)) : await tx.select({ exception: exceptions }).from(requests).innerJoin(exceptions, eq(exceptions.exceptionId, requests.exceptionId)).where(and(eq(requests.playerId, input.playerId), eq(requests.key, input.idempotencyKey))).then(rows => rows.map(r => r.exception));
  if (!row) return null;
  if (row.playerId !== input.playerId || row.missionId !== input.missionId || (input.periodKey && input.periodKey !== row.periodKey)) throw new AppError("IDEMPOTENCY_CONFLICT", "Claim key belongs to a different entitlement.", 409);
  if (!progress) await tx.select().from(playerMissionProgress).where(eq(playerMissionProgress.playerMissionProgressId, row.progressId)).for("update");
  const [claim] = await tx.select().from(missionClaims).where(eq(missionClaims.playerMissionProgressId, row.progressId));
  if (claim) return claimResult(tx, claim, true);
  await tx.insert(requests).values({ exceptionId: row.exceptionId, playerId: input.playerId, key: input.idempotencyKey }).onConflictDoNothing();
  return { capacityExceptionId: row.exceptionId };
}
const recoveryInput = z.object({
  expectedEventId: z.string().regex(/^[1-9]\d{0,18}$/).refine(v => BigInt(v) <= 9223372036854775807n),
  digest: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(1).max(2000), idempotencyKey: z.string().uuid(),
}).strict();
export class MissionCapacityService {
  constructor(private db: Database) {}
  private async actor(tx: GameStateTransaction, id: string) {
    const [actor] = await tx.select().from(adminUsers).where(eq(adminUsers.adminUserId, id)).for("share");
    if (!actor?.active || actor.role !== "SUPER_ADMIN") throw forbidden("Only an active SUPER_ADMIN may inspect or recover capacity exceptions.");
  }
  async list(missionId: string, actor: string, limit = 25, offset = 0) {
    return this.db.transaction(async tx => {
      await this.actor(tx, actor);
      const rows = await tx.select().from(exceptions).where(eq(exceptions.missionId, missionId)).orderBy(desc(exceptions.recordedAt), asc(exceptions.exceptionId)).limit(limit + 1).offset(offset);
      return { entries: await Promise.all(rows.slice(0, limit).map(row => this.read(tx, row.exceptionId))), hasMore: rows.length > limit, limit, offset };
    });
  }
  detail(id: string, actor: string) { return this.db.transaction(async tx => { await this.actor(tx, actor); return this.read(tx, id); }, { isolationLevel: "repeatable read" }); }
  private async read(tx: GameStateTransaction, id: string) {
    const [row] = await tx.select().from(exceptions).where(eq(exceptions.exceptionId, id));
    if (!row) throw new AppError("MISSION_EXCEPTION_NOT_FOUND", "Capacity exception was not found.", 404);
    const history = await tx.select().from(events).where(eq(events.exceptionId, id)).orderBy(asc(events.eventId));
    return { exceptionId: id, missionId: row.missionId, playerId: row.playerId, progressId: row.progressId, periodKey: row.periodKey, arrivedAt: row.arrivedAt.toISOString(), recordedAt: row.recordedAt.toISOString(), claimDeadline: row.claimDeadline?.toISOString() ?? null, xp: row.xp, synapsePoints: row.synapsePoints, digest: row.digest, status: history.at(-1)?.action === "RECOVERED" ? "RECOVERED" as const : "PENDING" as const, revision: history.at(-1)!.eventId.toString(), history: history.map(e => ({ eventId: e.eventId.toString(), action: e.action, actorAdminUserId: e.actorAdminUserId, occurredAt: e.occurredAt.toISOString(), reason: e.reason, errorCode: e.errorCode, claimId: e.claimId })) };
  }
  async recover(id: string, input: unknown, actor: string) {
    const parsed = recoveryInput.safeParse(input);
    if (!parsed.success) throw validationFailed("Provide the loaded event revision/digest, a reason and a unique recovery UUID only.");
    const { idempotencyKey: key, ...request } = parsed.data;
    return this.db.transaction(async tx => {
      const [row] = await tx.select().from(exceptions).where(eq(exceptions.exceptionId, id));
      if (!row) throw new AppError("MISSION_EXCEPTION_NOT_FOUND", "Capacity exception was not found.", 404);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${row.playerId}:${row.originalKey}`}, 0))`);
      const [progress] = await tx.select().from(playerMissionProgress).where(eq(playerMissionProgress.playerMissionProgressId, row.progressId)).for("update");
      await this.actor(tx, actor);
      const [previous] = await tx.select().from(events).where(and(eq(events.exceptionId, id), eq(events.key, key)));
      if (previous) {
        if (previous.actorAdminUserId !== actor || capacityDigest(previous.request) !== capacityDigest(request)) throw new AppError("IDEMPOTENCY_CONFLICT", "Recovery key belongs to another operation.", 409);
        return { ...await this.read(tx, id), idempotent: true };
      }
      const current = await this.read(tx, id);
      if (current.revision !== request.expectedEventId || row.digest !== request.digest) throw new AppError("MISSION_EXCEPTION_CONFLICT", "Exception history changed. Reload before authorizing recovery.", 409);
      if (current.status === "RECOVERED") throw new AppError("MISSION_EXCEPTION_RESOLVED", "This exception was already recovered.", 409);
      if (!progress || progress.playerId !== row.playerId || progress.missionId !== row.missionId || progress.periodKey !== row.periodKey || progress.status !== "CLAIMABLE" || capacityDigest(progress.rewardSnapshot) !== row.digest || progress.claimDeadline?.getTime() !== row.claimDeadline?.getTime() || !progress.completedAt || progress.completedAt > row.arrivedAt || (row.claimDeadline && row.arrivedAt >= row.claimDeadline)) throw new AppError("MISSION_EXCEPTION_INVALID", "Original entitlement evidence does not match; recovery requires investigation.", 409);
      const totals = snapshotTotals(progress.rewardSnapshot);
      if (totals.xp !== row.xp || totals.synapsePoints !== row.synapsePoints) throw new AppError("MISSION_EXCEPTION_INVALID", "Frozen reward amounts do not match.", 409);
      let claim: MissionClaimResult | undefined, errorCode: string | null = null;
      try { claim = await tx.transaction(nested => payEarnedMission(nested, progress, row.originalKey)); }
      catch (error) {
        if (!(error instanceof AppError) || !["SP_BALANCE_LIMIT_EXCEEDED", "XP_TOTAL_LIMIT_EXCEEDED"].includes(error.code)) throw error;
        errorCode = error.code;
      }
      await tx.insert(events).values({ exceptionId: id, actorAdminUserId: actor, occurredAt: new Date(), action: claim ? "RECOVERED" : "RECOVERY_BLOCKED", reason: request.reason, request, key, errorCode, claimId: claim?.missionClaimId ?? null });
      return { ...await this.read(tx, id), idempotent: false };
    });
  }
}
