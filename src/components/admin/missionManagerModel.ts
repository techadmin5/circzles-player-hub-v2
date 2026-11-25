import { ApiClientError, request } from "@/lib/apiClient";
import type { AdminMissionCollectibleDto, AdminMissionDto, AdminMissionPage, AdminMissionReadinessDto, MissionApprovalContractDto } from "@/types/adminMissions";
export interface MissionTrackingDto { mode: "EVENT_COUNT" | "DISTINCT_UTC_DAYS" | "DISTINCT_MISSIONS"; firstEver: boolean; eligibleMissionIds: string[]; collectibleId: string | null }
export type MissionCollectible = AdminMissionCollectibleDto;
export interface MissionInspection { revision: string; readiness: AdminMissionReadinessDto; approval: MissionApprovalContractDto; tracking: MissionTrackingDto | null; lastLifecycleAction: string | null }
export const activityLabels: Record<string, string> = {
  "player.checked_in": "Daily Check-In", "reward_wheel.spun": "Successful Reward Wheel Spin", "submission.created": "Puzzle Attempt Submitted",
  "submission.approved": "Puzzle Attempt Approved", "puzzle.added": "CircZle Added to Collection", "personal_best.improved": "New Personal Best",
  "mission.completed": "Eligible Mission Completed", "submission.rejected": "Puzzle Attempt Rejected", "submission.resubmission_required": "Puzzle Attempt Returned for Changes",
};
export const trackingLabels = { EVENT_COUNT: "Count qualifying player activities", DISTINCT_UTC_DAYS: "Complete activity on different days", DISTINCT_MISSIONS: "Complete different eligible missions" };
export const categoryLabel = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();
export const utc = (value: string | null) => value ? new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC").replace("Z", " UTC") : "No limit";
export function totals(m: AdminMissionDto) {
  const rows = m.rewards.filter(r => r.active);
  return { xp: rows.filter(r => r.rewardType === "XP").reduce((n, r) => n + r.amount, 0), sp: rows.filter(r => r.rewardType === "SYNAPSE_POINTS").reduce((n, r) => n + r.amount, 0), configured: rows.some(r => ["XP", "SYNAPSE_POINTS"].includes(r.rewardType) && Number.isInteger(r.amount) && r.amount > 0) };
}
export function approvalBindingMatches(m: AdminMissionDto, approval?: MissionApprovalContractDto | null) {
  return !!approval && approval.binding?.missionId === m.missionId
    && approval.binding.approvedConfigurationRevision === m.updatedAt
    && typeof approval.binding.configurationDigest === "string" && /^[a-f0-9]{64}$/.test(approval.binding.configurationDigest)
    && Array.isArray(approval.categories);
}
export function readinessBindingMatches(m: AdminMissionDto, readiness?: AdminMissionReadinessDto | null) {
  return !!readiness && readiness.missionId === m.missionId && readiness.missionRevision === m.updatedAt
    && Array.isArray(readiness.checks);
}
export function currentApprovals(m: AdminMissionDto, approval?: MissionApprovalContractDto | null) {
  if (!approvalBindingMatches(m, approval) || !approval?.rewards) return false;
  const amounts = totals(m);
  if (approval.rewards.xp !== amounts.xp || approval.rewards.synapsePoints !== amounts.sp) return false;
  return ["PRODUCT", "REWARD_BUDGET"].every(category => {
    const matches = approval.categories.filter(item => item?.category === category);
    if (matches.length !== 1) return false;
    const item = matches[0], record = item.recordedApproval;
    return item.status === "APPROVED" && !!record && record.approvalCategory === category
      && record.missionId === m.missionId && record.approvedConfigurationRevision === m.updatedAt
      && record.configurationDigest === approval.binding.configurationDigest
      && record.revocationId === null && record.revokedAt === null
      && record.xp === amounts.xp && record.synapsePoints === amounts.sp;
  });
}
export function activationAllowed(m: AdminMissionDto, readiness?: AdminMissionReadinessDto | null, approval?: MissionApprovalContractDto | null) {
  return !m.active && totals(m).configured && readinessBindingMatches(m, readiness) && approvalBindingMatches(m, approval)
    && readiness?.activationReady === true && readiness.configurationStatus === "PASS"
    && ["PASS", "WARNING"].includes(readiness.overallStatus) && readiness.checks.length > 0
    && readiness.checks.every(check => check && ["PASS", "WARNING"].includes(check.status))
    && approval?.missionInactive === true && currentApprovals(m, approval);
}
export function fresh(m: AdminMissionDto, i?: MissionInspection) {
  return !!i && i.revision === m.updatedAt && readinessBindingMatches(m, i.readiness) && approvalBindingMatches(m, i.approval);
}
export type MissionGroup = "active" | "incomplete" | "approval" | "ready" | "blocked" | "unchecked";
export function missionGroup(m: AdminMissionDto, i?: MissionInspection): MissionGroup {
  if (m.active) return "active";
  if (!fresh(m, i)) return "unchecked";
  if (!totals(m).configured || i!.readiness.configurationStatus === "BLOCKED") return "incomplete";
  const approved = currentApprovals(m, i!.approval);
  if (activationAllowed(m, i!.readiness, i!.approval)) return "ready";
  if (!approved) return "approval";
  return "blocked";
}
export const groupLabels: Record<MissionGroup, string> = { active: "Active", incomplete: "Needs configuration", approval: "Needs approval", ready: "Ready to activate", blocked: "Readiness blocked", unchecked: "Review not loaded" };
export const nextActions: Record<MissionGroup, string> = { active: "Monitor mission", incomplete: "Finish configuration", approval: "Review & approve", ready: "Review activation", blocked: "Resolve readiness issues", unchecked: "Refresh review" };
export function objective(m: AdminMissionDto, tracking?: MissionTrackingDto | null) {
  if (!m.rule) return "Choose a player activity to track.";
  const name = activityLabels[m.rule.eventType] ?? "Unsupported player activity";
  return name + " / " + m.rule.targetCount + " " + (tracking?.mode === "DISTINCT_UTC_DAYS" ? "different UTC days" : tracking?.mode === "DISTINCT_MISSIONS" ? "different eligible missions" : m.rule.targetCount === 1 ? "qualifying activity" : "qualifying activities");
}
export function friendlyIssue(code: string, fallback?: string) {
  if (/REVISION|DIGEST|STALE|CONFLICT/.test(code)) return "This mission has changed. Reload its details and review the current configuration before trying again.";
  if (/FORBIDDEN|UNAUTHORIZED/.test(code)) return "An active SUPER_ADMIN session is required. Sign in with the appropriate account.";
  if (/LOCKED/.test(code)) return "This configuration is locked. Reload its current state and review the listed restrictions.";
  if (/REWARD_BUDGET|BUDGET_APPROVAL/.test(code)) return "Review and approve the exact reward budget.";
  if (/PRODUCT_APPROVAL/.test(code)) return "Review and approve the mission's player objective and schedule.";
  if (/REWARD.*(MISSING|VALID|CONFIG)|REWARDS_M1/.test(code)) return "Configure at least one supported currency reward with an explicitly entered amount.";
  if (/TRACKING|RULE/.test(code)) return "Finish the supported player activity and counting configuration.";
  return fallback ?? "This mission cannot go live until this requirement is resolved.";
}
export function readinessMessage(check: { code: string; status: string; message: string }) {
  if (check.status === "WARNING") return check.message;
  if (check.status !== "PASS") return friendlyIssue(check.code, check.message);
  const passed: Record<string,string> = {
    MISSION_INACTIVE: "The mission is inactive and available for review.",
    METADATA_VALID: "The mission name and description are valid.",
    LIFECYCLE_VALID: "The category and frequency are compatible.",
    SCHEDULE_VALID: "Availability and claim deadlines are consistent in UTC.",
    AVAILABILITY_NOT_EXPIRED: "The availability window has not ended.",
    CLAIM_DEADLINE_NOT_EXPIRED: "The claim window has not expired.",
    UTC_PERIOD_CONTRACT: "The UTC period settings are valid.",
    RULE_EVENT_SUPPORTED: "This player activity is supported.",
    RULE_M1_VALID: "The player activity rule is valid.",
    TRACKING_VALID: "The progress-counting configuration is valid.",
    REWARDS_M1_VALID: "The exact currency rewards are configured.",
    REWARD_BUDGET_APPROVAL_MISSING: "The exact current reward budget is approved.",
    MISSION_PRODUCT_APPROVAL_MISSING: "Product approval matches this exact configuration."
  };
  return passed[check.code] ?? check.message;
}
export function errorMessage(error: unknown) {
  if (error instanceof ApiClientError) return { code: error.code, message: friendlyIssue(error.code, error.message) };
  return { code: "REQUEST_FAILED", message: error instanceof Error ? error.message : "The request could not be completed. Refresh before trying again." };
}
export async function loadMissionLibrary(signal: AbortSignal) {
  const all: AdminMissionDto[] = [], seen = new Set<string>();
  for (let offset = 0; offset <= 1000000; offset += 100) {
    const p = await request<AdminMissionPage>("/api/admin/missions?limit=100&offset=" + offset, { signal, cache: "no-store" });
    for (const m of p.missions) { if (seen.has(m.missionId)) throw new Error("The mission list changed while loading. Refresh to get a complete list."); seen.add(m.missionId); all.push(m); }
    if (!p.hasMore) return all;
    if (!p.missions.length) throw new Error("The server returned an incomplete page. Refresh the mission library.");
  }
  throw new Error("The library is too large to load completely. No summary totals are shown.");
}
async function lastLifecycleAction(base: string, signal?: AbortSignal): Promise<string | null> {
  for (let offset=0;offset<=1000000;offset+=100) {
    const page=await request<{entries:{action:string}[];hasMore:boolean}>(base+"/history?limit=100&offset="+offset,{signal,cache:"no-store"});
    const action=page.entries.find(e=>["MISSION_ACTIVATED","MISSION_DEACTIVATED"].includes(e.action))?.action;
    if(action)return action;
    if(!page.hasMore)return null;
    if(!page.entries.length)throw new Error("Incomplete mission history. Reload to verify its lifecycle.");
  }
  throw new Error("Lifecycle history could not be verified completely.");
}
export async function inspectMission(m: AdminMissionDto, signal?: AbortSignal): Promise<MissionInspection> {
  const options = { signal, cache: "no-store" as const }, base = "/api/admin/missions/" + m.missionId;
  const [readiness, approval, tracking, history] = await Promise.all([
    request<AdminMissionReadinessDto>(base + "/readiness", options), request<MissionApprovalContractDto>(base + "/approval-contract", options),
    request<MissionTrackingDto | null>(base + "/tracking", options), lastLifecycleAction(base, signal),
  ]);
  return { revision: m.updatedAt, readiness, approval, tracking, lastLifecycleAction: history };
}
export function filterMissions(rows: AdminMissionDto[], inspections: Record<string, MissionInspection>, search: string, category: string, status: string, sort: string) {
  return rows.filter(m => {
    const i = inspections[m.missionId], g = missionGroup(m, i);
    return m.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) && (!category || m.category === category)
      && (!status || (status === "inactive" ? !m.active : status === "deactivated" ? !m.active && fresh(m, i) && i.lastLifecycleAction === "MISSION_DEACTIVATED" : g === status));
  }).sort((a, b) => (sort === "name" ? a.title.localeCompare(b.title) : sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt) : a.displayOrder - b.displayOrder) || a.missionId.localeCompare(b.missionId));
}
