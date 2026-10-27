import { validationFailed } from "./errors.js";

export type PeriodType = "DAILY" | "WEEKLY" | "LIFETIME" | "FIXED";
export interface RewardSnapshot {
  version: 1;
  rewards: Array<{ type: "XP" | "SYNAPSE_POINTS"; amount: number }>;
}
export const CLAIM_GRACE_MS = 24 * 60 * 60 * 1000;
export function periodKeyFor(type: PeriodType, at: Date, id: string): string {
  if (!Number.isFinite(at.getTime())) throw validationFailed("Invalid period timestamp.");
  if (type === "LIFETIME") return "lifetime";
  if (type === "FIXED") return `fixed:${id}`;
  if (type === "DAILY") return at.toISOString().slice(0, 10);
  const date = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const year = date.getUTCFullYear();
  const week = Math.ceil(((date.getTime() - Date.UTC(year, 0, 1)) / CLAIM_GRACE_MS + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}
export function periodBounds(type: PeriodType, key: string, id: string, startsAt: Date | null = null, endsAt: Date | null = null) {
  if (type === "LIFETIME" || type === "FIXED") {
    if (key !== (type === "LIFETIME" ? "lifetime" : `fixed:${id}`)) throw validationFailed("Invalid mission period key.");
    return { start: startsAt, end: endsAt };
  }
  let start: Date;
  if (type === "DAILY") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw validationFailed("Invalid daily period key.");
    start = new Date(`${key}T00:00:00Z`);
  } else {
    if (!/^\d{4}-W\d{2}$/.test(key)) throw validationFailed("Invalid weekly period key.");
    const year = Number(key.slice(0, 4)), week = Number(key.slice(6));
    start = new Date(Date.UTC(year, 0, 4));
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() || 7) + 1 + (week - 1) * 7);
  }
  if (!Number.isFinite(start.getTime()) || periodKeyFor(type, start, id) !== key) throw validationFailed("Invalid period key.");
  return { start, end: new Date(start.getTime() + CLAIM_GRACE_MS * (type === "DAILY" ? 1 : 7)) };
}
export function claimDeadlineFor(type: PeriodType, end: Date | null, explicit: Date | null) {
  return type === "DAILY" || type === "WEEKLY" ? new Date(end!.getTime() + CLAIM_GRACE_MS) : explicit;
}
export function freezeRewards(rows: Array<{ rewardType: string; amount: number }>): RewardSnapshot {
  const totals = { XP: 0, SYNAPSE_POINTS: 0 };
  for (const row of rows) {
    if (!(row.rewardType === "XP" || row.rewardType === "SYNAPSE_POINTS") || !Number.isSafeInteger(row.amount) || row.amount <= 0) throw validationFailed("Unsupported or unsafe mission reward.");
    totals[row.rewardType] += row.amount;
  }
  if ((!totals.XP && !totals.SYNAPSE_POINTS) || Object.values(totals).some(value => value > 2_147_483_647)) throw validationFailed("Invalid mission reward total.");
  return { version: 1, rewards: (Object.keys(totals) as Array<keyof typeof totals>).filter(type => totals[type] > 0).map(type => ({ type, amount: totals[type] })) };
}
export function snapshotTotals(snapshot: RewardSnapshot | null) {
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.rewards)) throw validationFailed("Earned reward snapshot is missing; an explicit reconciliation is required.");
  const checked = freezeRewards(snapshot.rewards.map(row => ({ rewardType: row.type, amount: row.amount })));
  return { xp: checked.rewards.find(row => row.type === "XP")?.amount ?? 0, synapsePoints: checked.rewards.find(row => row.type === "SYNAPSE_POINTS")?.amount ?? 0 };
}
