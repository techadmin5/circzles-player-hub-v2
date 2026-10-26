import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { missions, playerMissionProgress as progress, missionClaims as claims } from "../db/schema.js";
import { missionCapacityExceptions as exceptions, missionCapacityEvents as events } from "../db/missionAdminSchema.js";
import { AppError, validationFailed } from "./errors.js";
import { snapshotTotals } from "./missionLifecycle.js";

export interface PlayerMissionHistoryEntry {
  entitlementId: string; missionId: string; title: string; titleSource: "CURRENT_DEFINITION"; periodKey: string;
  state: "IN_PROGRESS" | "UNCLAIMED" | "EXPIRED" | "CAPACITY_PENDING" | "CAPACITY_BLOCKED" | "RECOVERED" | "PAID" | "REVIEW_REQUIRED";
  completionState: "IN_PROGRESS" | "CLAIMABLE" | "CLAIMED";
  claimState: "UNCLAIMED" | "PAID" | "UNKNOWN";
  progress: { current: number; target: number };
  rewards: { xp: number; synapsePoints: number } | null;
  rewardSource: "CLAIM_SNAPSHOT" | "EARNED_SNAPSHOT" | "CAPACITY_SNAPSHOT" | "UNAVAILABLE";
  recordedAt: string; completedAt: string | null; claimedAt: string | null;
  periodStartsAt: string | null; periodEndsAt: string | null; claimDeadline: string | null;
  capacity: { status: "PENDING" | "BLOCKED" | "RECOVERED"; arrivedAt: string; recordedAt: string; updatedAt: string | null } | null;
}
export interface PlayerMissionHistoryPage { entries: PlayerMissionHistoryEntry[]; nextCursor: string | null }
const cursorShape = z.object({ at: z.string().datetime({ precision: 6 }).refine(value => !value.startsWith("0000-")), id: z.string().uuid() }).strict();
const pageShape = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional() }).strict();
const historicalRewardShape = z.object({ version: z.literal(1), rewards: z.array(z.object({ type: z.enum(["XP", "SYNAPSE_POINTS"]), amount: z.number().int().positive() })) });
export function parseMissionHistoryQuery(input: unknown) {
  const parsed = pageShape.safeParse(input);
  if (!parsed.success) throw validationFailed("History accepts only a limit from 1 to 100 and an optional history cursor.");
  let cursor: z.infer<typeof cursorShape> | undefined;
  if (parsed.data.cursor) {
    try {
      if (Buffer.from(parsed.data.cursor, "base64url").toString("base64url") !== parsed.data.cursor) throw new Error("Invalid encoding");
      cursor = cursorShape.parse(JSON.parse(Buffer.from(parsed.data.cursor, "base64url").toString("utf8")));
    } catch { throw validationFailed("Invalid mission history cursor. Refresh history to start again."); }
  }
  return { limit: parsed.data.limit, cursor };
}

export async function readPlayerMissionHistory(db: Database, playerId: string, query: unknown, now = new Date()): Promise<PlayerMissionHistoryPage> {
  const { limit, cursor } = parseMissionHistoryQuery(query);
  // One SELECT gives a consistent view of receipt and immutable capacity transition.
  // Preserve PostgreSQL microseconds in cursors; JS Date truncation could skip rows.
  const rows = await db.select({ progress, title: missions.title, claim: claims, exception: exceptions,
    cursorAt: sql<string>`to_char(${progress.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    capacityAction: sql<string | null>`(SELECT ${events.action} FROM ${events} WHERE ${events.exceptionId} = ${exceptions.exceptionId} ORDER BY ${events.eventId} DESC LIMIT 1)`,
    capacityUpdatedAt: sql<string | null>`(SELECT to_char(${events.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM ${events} WHERE ${events.exceptionId} = ${exceptions.exceptionId} ORDER BY ${events.eventId} DESC LIMIT 1)`,
  }).from(progress).innerJoin(missions, eq(missions.missionId, progress.missionId))
    .leftJoin(claims, and(eq(claims.playerMissionProgressId, progress.playerMissionProgressId), eq(claims.playerId, playerId)))
    .leftJoin(exceptions, and(eq(exceptions.progressId, progress.playerMissionProgressId), eq(exceptions.playerId, playerId)))
    .where(and(eq(progress.playerId, playerId), cursor ? sql`(${progress.createdAt}, ${progress.playerMissionProgressId}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : undefined))
    .orderBy(desc(progress.createdAt), desc(progress.playerMissionProgressId)).limit(limit + 1);
  const entries = rows.slice(0, limit).map(({ progress: p, title, claim, exception, capacityAction, capacityUpdatedAt }): PlayerMissionHistoryEntry => {
    let rewards: PlayerMissionHistoryEntry["rewards"] = null, rewardSource: PlayerMissionHistoryEntry["rewardSource"] = "UNAVAILABLE";
    if (claim) { rewards = { xp: claim.xpRewardSnapshot, synapsePoints: claim.synapseRewardSnapshot }; rewardSource = "CLAIM_SNAPSHOT"; }
    else for (const [snapshot, source] of [[p.rewardSnapshot, "EARNED_SNAPSHOT"], [exception?.rewardSnapshot, "CAPACITY_SNAPSHOT"]] as const) {
      if (!snapshot) continue;
      const parsed = historicalRewardShape.safeParse(snapshot);
      if (!parsed.success) continue;
      try { rewards = snapshotTotals(parsed.data); rewardSource = source; break; }
      catch (error) { if (!(error instanceof AppError)) throw error; } // Report missing/corrupt legacy evidence, never substitute current rewards.
    }
    const capacity: PlayerMissionHistoryEntry["capacity"] = exception ? { status: capacityAction === "RECOVERED" ? "RECOVERED" : capacityAction === "RECOVERY_BLOCKED" ? "BLOCKED" : "PENDING", arrivedAt: exception.arrivedAt.toISOString(), recordedAt: exception.recordedAt.toISOString(), updatedAt: capacityUpdatedAt } : null;
    const state: PlayerMissionHistoryEntry["state"] = claim ? capacity?.status === "RECOVERED" ? "RECOVERED" : "PAID"
      : p.status === "CLAIMED" || capacity?.status === "RECOVERED" ? "REVIEW_REQUIRED"
      : capacity ? capacity.status === "BLOCKED" ? "CAPACITY_BLOCKED" : "CAPACITY_PENDING"
      : p.status === "IN_PROGRESS" ? "IN_PROGRESS"
      : p.expiredAt || (p.claimDeadline && now >= p.claimDeadline) ? "EXPIRED" : "UNCLAIMED";
    return { entitlementId: p.playerMissionProgressId, missionId: p.missionId, title, titleSource: "CURRENT_DEFINITION", periodKey: p.periodKey, state,
      completionState: p.status as PlayerMissionHistoryEntry["completionState"], claimState: claim ? "PAID" : state === "REVIEW_REQUIRED" ? "UNKNOWN" : "UNCLAIMED",
      progress: { current: p.currentCount, target: p.targetCountSnapshot }, rewards, rewardSource,
      recordedAt: p.createdAt.toISOString(), completedAt: p.completedAt?.toISOString() ?? null, claimedAt: claim?.createdAt.toISOString() ?? p.claimedAt?.toISOString() ?? null,
      periodStartsAt: p.periodStartsAt?.toISOString() ?? null, periodEndsAt: p.periodEndsAt?.toISOString() ?? null,
      claimDeadline: (exception ? exception.claimDeadline : p.claimDeadline)?.toISOString() ?? null, capacity };
  });
  const last = rows[limit - 1];
  return { entries, nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ at: last.cursorAt, id: last.progress.playerMissionProgressId })).toString("base64url") : null };
}
