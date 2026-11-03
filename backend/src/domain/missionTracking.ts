import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { missionEventContributions, missionTrackingConfigs, missionEarnedCollectibles } from "../db/missionStarterSchema.js";
import { missions, missionRules, rewardDefinitions, playerInventoryItems, gameEvents } from "../db/schema.js";
import type { GameStateTransaction } from "./gameState.js";
import { validationFailed } from "./errors.js";
import { grantInventoryItemInTransaction } from "./inventory.js";

export const trackingInput = z.object({
  mode: z.enum(["EVENT_COUNT", "DISTINCT_UTC_DAYS", "DISTINCT_MISSIONS"]),
  firstEver: z.boolean(), eligibleMissionIds: z.array(z.string().uuid()).max(100), collectibleId: z.string().uuid().nullable(),
}).strict();
export type MissionTracking = z.infer<typeof trackingInput>;
export async function readTracking(tx: Pick<GameStateTransaction, "select">, id: string) {
  const [row] = await tx.select().from(missionTrackingConfigs).where(eq(missionTrackingConfigs.missionId, id));
  return row ?? null;
}
export async function validateTracking(tx: GameStateTransaction, mission: { missionId: string; periodType: string }, rule: { eventType: string; targetCount: number }, config: MissionTracking | null) {
  if (!config) { if (rule.eventType === "mission.completed") throw validationFailed("Mission aggregation requires an explicit eligible mission list."); return; }
  const parsed = trackingInput.safeParse(config);
  if (!parsed.success) throw validationFailed("Unsupported mission tracking configuration.");
  if (config.firstEver && (mission.periodType !== "LIFETIME" || rule.targetCount !== 1 || config.mode !== "EVENT_COUNT" || !["puzzle.added", "submission.created", "submission.approved"].includes(rule.eventType))) throw validationFailed("First-ever tracking requires a lifetime, single-action puzzle/submission achievement.");
  if (config.mode === "DISTINCT_UTC_DAYS" && (mission.periodType !== "WEEKLY" || rule.targetCount > 7 || !["reward_wheel.spun", "player.checked_in"].includes(rule.eventType))) throw validationFailed("Distinct-day tracking supports weekly successful spins or explicit check-ins, at most seven UTC dates.");
  if (config.mode === "DISTINCT_MISSIONS") {
    if (rule.eventType !== "mission.completed" || mission.periodType !== "WEEKLY" || config.eligibleMissionIds.length < rule.targetCount || new Set(config.eligibleMissionIds).size !== config.eligibleMissionIds.length || config.eligibleMissionIds.includes(mission.missionId)) throw validationFailed("Choose enough unique, nonrecursive eligible missions for weekly completion tracking.");
    for (const id of config.eligibleMissionIds) {
      const [source] = await tx.select({ period: missions.periodType, event: missionRules.eventType }).from(missions).innerJoin(missionRules, eq(missionRules.missionId, missions.missionId)).where(eq(missions.missionId, id));
      if (!source || !["DAILY", "WEEKLY"].includes(source.period) || source.event.startsWith("mission.")) throw validationFailed("Eligible missions must have nonaggregate daily/weekly gameplay rules.");
    }
  } else if (config.eligibleMissionIds.length || rule.eventType === "mission.completed") throw validationFailed("Eligible mission lists are exclusive to distinct-mission tracking.");
  if (config.collectibleId) {
    const [reward] = await tx.select().from(rewardDefinitions).where(eq(rewardDefinitions.rewardDefinitionId, config.collectibleId));
    if (!reward?.active || !["BADGE", "FRAME"].includes(reward.rewardType) || mission.periodType !== "LIFETIME") throw validationFailed("Choose an active badge/frame catalog definition for a lifetime achievement.");
  }
}
export function contributionKey(config: MissionTracking, event: Pick<typeof gameEvents.$inferSelect, "gameEventId" | "createdAt" | "payload">) {
  if (config.mode === "DISTINCT_UTC_DAYS") return event.createdAt.toISOString().slice(0, 10);
  if (config.mode === "DISTINCT_MISSIONS") return typeof event.payload.missionId === "string" && config.eligibleMissionIds.includes(event.payload.missionId) ? event.payload.missionId : null;
  return event.gameEventId;
}
// Consult authoritative retained history, including pre-event-migration records. No backfill.
export async function isFirstAction(tx: GameStateTransaction, event: typeof gameEvents.$inferSelect) {
  const prior = await tx.execute(sql`SELECT EXISTS(SELECT 1 FROM game_events WHERE player_id=${event.playerId} AND event_type=${event.eventType} AND (created_at,game_event_id)<(${event.createdAt},${event.gameEventId}::uuid)) AS found`);
  if ((prior.rows[0] as { found: boolean }).found) return false;
  let result;
  if (event.eventType === "puzzle.added") result = await tx.execute(sql`SELECT EXISTS(SELECT 1 FROM player_puzzles WHERE player_id=${event.playerId} AND created_at <= ${event.createdAt} AND puzzle_claim_id::text IS DISTINCT FROM ${event.sourceId}) AS found`);
  else if (event.eventType === "submission.created") result = await tx.execute(sql`SELECT EXISTS(SELECT 1 FROM submissions WHERE player_id=${event.playerId} AND submission_id::text <> ${event.sourceId} AND submitted_at <= ${event.createdAt}) AS found`);
  else result = await tx.execute(sql`SELECT EXISTS(SELECT 1 FROM submission_reviews r JOIN submissions s USING(submission_id) WHERE s.player_id=${event.playerId} AND r.decision='APPROVED' AND r.submission_review_id::text <> ${event.sourceId} AND r.created_at <= ${event.createdAt}) OR EXISTS(SELECT 1 FROM submissions s WHERE s.player_id=${event.playerId} AND s.status='APPROVED' AND s.submission_id::text <> ${String(event.payload.submissionId ?? "")} AND s.updated_at <= ${event.createdAt}) AS found`);
  return !(result.rows[0] as { found: boolean }).found;
}
export async function recordContribution(tx: GameStateTransaction, config: MissionTracking, event: typeof gameEvents.$inferSelect, missionId: string, periodKey: string) {
  if (config.firstEver && !await isFirstAction(tx, event)) return false;
  const key = contributionKey(config, event);
  if (key === null) return false;
  if (config.mode === "DISTINCT_MISSIONS") {
    // Never accept an invented mission.completed payload; require the actual earned entitlement.
    const result = await tx.execute(sql`SELECT EXISTS(SELECT 1 FROM player_mission_progress p JOIN mission_rules r USING(mission_id) WHERE p.player_mission_progress_id::text=${event.sourceId} AND p.player_id=${event.playerId} AND p.mission_id::text=${key} AND p.completed_at = ${event.createdAt} AND p.period_key = ${String(event.payload.periodKey ?? "")} AND r.event_type NOT LIKE 'mission.%') AS found`);
    if (!(result.rows[0] as { found: boolean }).found) return false;
  }
  const inserted = await tx.insert(missionEventContributions).values({ playerId: event.playerId, missionId, periodKey, contributionKey: key, gameEventId: event.gameEventId }).onConflictDoNothing().returning();
  return inserted.length > 0;
}
export async function freezeCollectible(tx: GameStateTransaction, progressId: string, config: MissionTracking | null) {
  if (!config?.collectibleId) return;
  const [reward] = await tx.select().from(rewardDefinitions).where(eq(rewardDefinitions.rewardDefinitionId, config.collectibleId)).for("share");
  if (!reward?.active || (reward.rewardType !== "BADGE" && reward.rewardType !== "FRAME")) throw validationFailed("Achievement collectible is unavailable.");
  await tx.insert(missionEarnedCollectibles).values({ progressId, rewardDefinitionId: reward.rewardDefinitionId, rewardType: reward.rewardType });
}
export async function deliverCollectible(tx: GameStateTransaction, progressId: string, playerId: string) {
  const [earned] = await tx.select().from(missionEarnedCollectibles).where(eq(missionEarnedCollectibles.progressId, progressId)).for("update");
  if (!earned || earned.disposition !== "PENDING") return;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${playerId}:${earned.rewardDefinitionId}`}, 0))`);
  const [owned] = await tx.select().from(playerInventoryItems).where(and(eq(playerInventoryItems.playerId, playerId), eq(playerInventoryItems.rewardDefinitionId, earned.rewardDefinitionId))).for("update");
  if (!owned?.quantity) await grantInventoryItemInTransaction(tx, { playerId, rewardDefinitionId: earned.rewardDefinitionId, rewardType: earned.rewardType, quantity: 1, sourceType: "MISSION_REWARD", sourceId: progressId, idempotencyKey: `mission.collectible:${progressId}` });
  await tx.update(missionEarnedCollectibles).set({ disposition: owned?.quantity ? "ALREADY_OWNED" : "GRANTED" }).where(eq(missionEarnedCollectibles.progressId, progressId));
}
