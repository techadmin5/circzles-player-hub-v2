import { missionActivationPolicyBlocker } from "./missionActivationPolicy.js";
import { and, eq, isNull, sql } from "drizzle-orm";
import { readMissionApprovalContractInTransaction } from "./missionApprovalContract.js";
import type { GameStateTransaction } from "./gameState.js";
import type { Database } from "../db/client.js";
import { missions, missionRules, missionRewards, puzzles, puzzleDesigns } from "../db/schema.js";
import { missionChestEligibility, missionChests } from "../db/missionChestSchema.js";
import { AppError, validationFailed } from "./errors.js";
import { validateMissionDefinition, validateMissionRule } from "./missions.js";
import { adminMissionRuleOptions, parseAdminMissionRule } from "./adminMissionRules.js";
import { parseAdminMissionSchedule, validateAdminMissionSchedule } from "./adminMissionScheduling.js";
import { claimDeadlineFor, freezeRewards, periodBounds, periodKeyFor, snapshotTotals, type PeriodType } from "./missionLifecycle.js";

export interface AdminMissionReadinessCheck {
  code: string; status: "PASS" | "BLOCKED" | "WARNING";
  category: "CONFIGURATION" | "SAFETY" | "PRODUCT" | "ADVISORY";
  field: string; message: string;
}
export interface AdminMissionReadinessDto {
  missionId: string; missionRevision: string; evaluatedAt: string;
  configurationStatus: "PASS" | "BLOCKED";
  overallStatus: "PASS" | "BLOCKED" | "WARNING";
  activationReady: boolean; productApproval: "NOT_RECORDED" | "APPROVED";
  rewardSafety: { xp: number | null; synapsePoints: number | null; spWalletLimit: number; maximumSafeSpBalance: number | null; maximumSafeXpTotal: number | null; balancesInspected: false };
  checks: AdminMissionReadinessCheck[];
}

// No row locks, writes, claim calls, approval assertions or player-balance reads.
// Repeatable-read keeps the definition and related configuration in one coherent snapshot.
export async function readMissionReadiness(db: Database, id: string, now = new Date()): Promise<AdminMissionReadinessDto> {
  return db.transaction(tx => evaluateMissionReadiness(tx, id, now), { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function evaluateMissionReadiness(tx: GameStateTransaction, id: string, now = new Date()): Promise<AdminMissionReadinessDto> {
    const approvalContract = await readMissionApprovalContractInTransaction(tx, id, now);
    const productApproved = approvalContract.categories.find(category => category.category === "PRODUCT")?.status === "APPROVED";
    const budgetApproved = approvalContract.categories.find(category => category.category === "REWARD_BUDGET")?.status === "APPROVED";
    const [row] = await tx.select().from(missions).where(eq(missions.missionId, id));
    if (!row) throw new AppError("MISSION_NOT_FOUND", "Mission was not found.", 404);
    const [rule] = await tx.select().from(missionRules).where(eq(missionRules.missionId, id));
    const rewards = await tx.select().from(missionRewards).where(eq(missionRewards.missionId, id));
    const links = await tx.select({ id: missionChests.chestId }).from(missionChestEligibility)
      .innerJoin(missionChests, eq(missionChests.chestId, missionChestEligibility.chestId))
      .where(and(eq(missionChestEligibility.missionId, id), eq(missionChestEligibility.active, true)));
    const checks: AdminMissionReadinessCheck[] = [];
    function add(code: string, status: AdminMissionReadinessCheck["status"], category: AdminMissionReadinessCheck["category"], field: string, message: string) { checks.push({ code, status, category, field, message }); }
    function validate(code: string, field: string, message: string, action: () => unknown) {
      try { action(); add(code, "PASS", "CONFIGURATION", field, message); return true; }
      catch (error) { if (!(error instanceof AppError)) throw error; add(code, "BLOCKED", "CONFIGURATION", field, error.message); return false; }
    }
    const revision = row.updatedAt.toISOString();
    const utc = (date: Date | null) => {
      if (date && !Number.isFinite(date.getTime())) throw validationFailed("Stored schedule timestamps must be finite UTC dates.");
      return date?.toISOString() ?? null;
    };
    add("MISSION_INACTIVE", row.active ? "BLOCKED" : "PASS", "CONFIGURATION", "active", row.active ? "This definition is active. This preview is for inactive missions; it will not deactivate it." : "The mission remains inactive. This preview cannot activate it.");
    validate("METADATA_VALID", "title,description", "Title and description meet the existing builder limits.", () => {
      if (!row.title.trim() || row.title.trim().length > 200 || row.description.length > 4000) throw validationFailed("Provide a nonblank title up to 200 characters and description up to 4000 characters.");
    });
    const definitionValid = validate("LIFECYCLE_VALID", "category,periodType,displayOrder", "M1 category, period and definition constraints pass.", () => validateMissionDefinition(row));
    validate("SCHEDULE_VALID", "startsAt,endsAt,claimDeadline,activationEffectiveAt", "Stored UTC dates and deadline relationships satisfy M1 and the scheduling editor.", () => {
      parseAdminMissionSchedule({ startsAt: utc(row.startsAt), endsAt: utc(row.endsAt), claimDeadline: utc(row.claimDeadline), expectedUpdatedAt: revision });
      validateAdminMissionSchedule(row, row);
    });
    add("AVAILABILITY_NOT_EXPIRED", row.endsAt && row.endsAt <= now ? "BLOCKED" : "PASS", "CONFIGURATION", "endsAt", row.endsAt && row.endsAt <= now ? "Availability has ended. A future activation cannot accept events in an expired window; review the schedule." : "Availability has not ended at evaluation time.");
    add("CLAIM_DEADLINE_NOT_EXPIRED", row.claimDeadline && row.claimDeadline <= now ? "BLOCKED" : "PASS", "CONFIGURATION", "claimDeadline", row.claimDeadline && row.claimDeadline <= now ? "The explicit claim deadline has expired. Review it before any activation." : "No explicit claim deadline has expired at evaluation time.");
    if ((row.startsAt && row.startsAt > now) || row.activationEffectiveAt > now) add("FUTURE_EVENT_WINDOW", "WARNING", "ADVISORY", "startsAt,activationEffectiveAt", "Eligible events begin only after both the start and event cutoff. A future date does not activate this mission automatically.");
    if (definitionValid) validate("UTC_PERIOD_CONTRACT", "periodType", "Daily periods use UTC midnight; ISO weeks start Monday UTC. Recurring mission/chest grace is 24 hours after their own period end; fixed/lifetime claims use the explicit deadline. Earned snapshots are unchanged.", () => {
      const type = row.periodType as PeriodType;
      const bounds = periodBounds(type, periodKeyFor(type, now, id), id, row.startsAt, row.endsAt);
      claimDeadlineFor(type, bounds.end, row.claimDeadline);
    });
    if (!rule) add("RULE_MISSING", "BLOCKED", "CONFIGURATION", "rule", "Configure an enabled supported event rule; this draft has no rule.");
    else {
      add("RULE_ENABLED", rule.active ? "PASS" : "BLOCKED", "CONFIGURATION", "rule.active", rule.active ? "The rule is enabled; the mission is still inactive." : "Enable the configured rule while leaving the mission inactive.");
      validate("RULE_M1_VALID", "rule", "M1 event, count and level validation passes.", () => validateMissionRule(rule));
      const supported = adminMissionRuleOptions.some(option => option.eventType === rule.eventType);
      add("RULE_EVENT_SUPPORTED", supported ? "PASS" : "BLOCKED", "CONFIGURATION", "rule.eventType", supported ? "This event is one of the six verified builder event types." : "This event is outside the six verified builder types. Review supported event semantics before activation; M1 recognition alone is not approval.");
      const emptyConditions = typeof rule.conditions === "object" && rule.conditions !== null && !Array.isArray(rule.conditions) && Object.keys(rule.conditions).length === 0;
      add("ADVANCED_CONDITIONS_UNSUPPORTED", emptyConditions ? "PASS" : "BLOCKED", "CONFIGURATION", "rule.conditions", emptyConditions ? "No unsupported advanced conditions are configured." : "Advanced conditions are not approved by this builder; M1 also has a known short-circuit validation gap. Review them separately, without silently discarding conditions.");
      if (supported) validate("RULE_PARAMETERS_VALID", "rule.sourceType,rule.targetCount,rule.puzzleId,rule.levelId", "Rule parameters satisfy the existing strict builder contract.", () => parseAdminMissionRule({ eventType: rule.eventType, targetCount: rule.targetCount, sourceType: rule.sourceType, puzzleId: rule.puzzleId, levelId: rule.levelId, conditions: rule.conditions, active: rule.active, expectedUpdatedAt: revision }));
      if (rule.puzzleId || rule.levelId !== null) {
        const [match] = await tx.select({ id: puzzles.puzzleId }).from(puzzles).innerJoin(puzzleDesigns, eq(puzzleDesigns.puzzleDesignId, puzzles.puzzleDesignId)).where(and(
          eq(puzzles.status, "ACTIVE"), isNull(puzzles.deletedAt), eq(puzzleDesigns.status, "ACTIVE"), isNull(puzzleDesigns.deletedAt),
          rule.puzzleId ? eq(puzzles.puzzleId, rule.puzzleId) : undefined, rule.levelId !== null ? eq(puzzles.levelId, rule.levelId) : undefined,
        )).limit(1);
        add("RULE_FILTER_RESOLVES", match ? "PASS" : "BLOCKED", "CONFIGURATION", "rule.puzzleId,rule.levelId", match ? "The filters resolve to a currently active canonical CircZles and design." : "The filters match no currently active canonical CircZles/design. Check the ID, level and catalog availability.");
      }
    }
    let rewardTotals: { xp: number; synapsePoints: number } | null = null;
    try {
      rewardTotals = snapshotTotals(freezeRewards(rewards.filter(reward => reward.active)));
      add("REWARDS_VALID", "PASS", "CONFIGURATION", "rewards", "Enabled XP/SP rewards satisfy M1 positive-integer and per-currency aggregate limits. This is not an approved reward budget.");
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      add("REWARDS_VALID", "BLOCKED", "CONFIGURATION", "rewards", error.message);
    }
    if (rewards.some(reward => reward.rewardType !== "XP" && reward.rewardType !== "SYNAPSE_POINTS")) add("REWARD_TYPES_UNSUPPORTED", "BLOCKED", "CONFIGURATION", "rewards.rewardType", "The definition contains reward types outside the XP/SP builder, including disabled rows. Review them separately.");
    if (rewardTotals) {
      add("SP_INTEGER_OVERFLOW_EXPOSURE", rewardTotals.synapsePoints ? "WARNING" : "PASS", "SAFETY", "rewards.SYNAPSE_POINTS", rewardTotals.synapsePoints ? `SP balances above ${2147483647 - rewardTotals.synapsePoints} cannot accept this reward. The locked grant boundary now uses exact arithmetic and rejects the entire transaction before overflow; it never clamps or partially awards. Rejected claims retain earned eligibility and their original deadline; no automatic compensation or extension is provided.` : "This configuration grants no SP, so it introduces no SP wallet addition.");
      add("XP_PRECISION_EXPOSURE", rewardTotals.xp ? "WARNING" : "PASS", "SAFETY", "rewards.XP", rewardTotals.xp ? `XP totals above ${Number.MAX_SAFE_INTEGER - rewardTotals.xp} cannot safely accept this grant. Exact database-text reads and locked BigInt arithmetic now reject unsafe totals atomically rather than rounding. Eligible on-time failures are durably recorded for explicit SUPER_ADMIN recovery.` : "This configuration grants no XP, so it introduces no cumulative XP addition.");
    }
    if (!["DAILY", "WEEKLY"].includes(row.periodType) && !row.claimDeadline) add("OPEN_CLAIM_WINDOW_UNAPPROVED", productApproved ? "PASS" : "BLOCKED", "PRODUCT", "claimDeadline", productApproved ? "Product approval covers this exact open claim window." : "M1 permits an open claim window; product approval of this exact configuration is required.");
    add("CHEST_LINK_REVIEW", links.length ? "BLOCKED" : "PASS", "SAFETY", "chestEligibility", links.length ? "Enabled chest eligibility exists. M1 requires matching periods, active missions for active chests, and eligibility at/after both activation cutoffs. Future activation clamps the mission cutoff to activation time; reviewed alignment must be established before activation." : "No enabled chest eligibility links require activation-time alignment.");
    add("REWARD_BUDGET_APPROVAL_MISSING", budgetApproved ? "PASS" : "BLOCKED", "PRODUCT", "rewards", budgetApproved ? "Current reward-budget approval covers these exact XP/SP amounts; no global budget cap is implied." : "This exact revision and XP/SP amounts require a current reward-budget approval. Storage limits are not budgets.");
    add("MISSION_PRODUCT_APPROVAL_MISSING", productApproved ? "PASS" : "BLOCKED", "PRODUCT", "approval", productApproved ? "Product approval matches this exact revision and configuration digest." : "Current product approval is required; missing, revoked or invalidated records do not qualify.");
    add("POINT_IN_TIME_ONLY", "WARNING", "ADVISORY", "missionRevision,evaluatedAt", "This is a read-only point-in-time preview, not activation authorization. Recheck after configuration, catalog, chest, policy or time changes; deployment controls are not verified here.");
    const capacitySchema = await tx.execute(sql`SELECT to_regclass('public.mission_capacity_exceptions') IS NOT NULL AND to_regclass('public.mission_capacity_requests') IS NOT NULL AND to_regclass('public.mission_capacity_events') IS NOT NULL AS available`);
    const capacityAvailable = (capacitySchema.rows[0] as { available: boolean } | undefined)?.available === true;
    checks.push({ ...missionActivationPolicyBlocker, status: capacityAvailable ? "PASS" : "BLOCKED", message: capacityAvailable ? missionActivationPolicyBlocker.message : "Mission capacity recovery requires migration 0033 before activation." });
    const configurationStatus = checks.some(check => check.category === "CONFIGURATION" && check.status === "BLOCKED") ? "BLOCKED" : "PASS";
    const overallStatus = checks.some(check => check.status === "BLOCKED") ? "BLOCKED" : checks.some(check => check.status === "WARNING") ? "WARNING" : "PASS";
    return { missionId: id, missionRevision: revision, evaluatedAt: now.toISOString(), configurationStatus, overallStatus, activationReady: overallStatus !== "BLOCKED", productApproval: productApproved ? "APPROVED" : "NOT_RECORDED",
      rewardSafety: { xp: rewardTotals?.xp ?? null, synapsePoints: rewardTotals?.synapsePoints ?? null, spWalletLimit: 2147483647, maximumSafeSpBalance: rewardTotals?.synapsePoints ? 2147483647 - rewardTotals.synapsePoints : null, maximumSafeXpTotal: rewardTotals?.xp ? Number.MAX_SAFE_INTEGER - rewardTotals.xp : null, balancesInspected: false }, checks };
}
