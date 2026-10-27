import { AdminMissionChestService } from "./adminMissionChests.js";
import { ChestCapacityService } from "./chestCapacityExceptions.js";
import { MissionCapacityService } from "./missionCapacityExceptions.js";
import { changeMissionLifecycle } from "./adminMissionLifecycle.js";
import { and, asc, desc, eq, ilike, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { missionRewards, missionRules, missions, puzzles } from "../db/schema.js";
import { parseAdminMissionRule } from "./adminMissionRules.js";
import { parseAdminMissionSchedule, validateAdminMissionSchedule } from "./adminMissionScheduling.js";
import { parseAdminMissionRewards } from "./adminMissionRewards.js";
import { readMissionReadiness } from "./adminMissionReadiness.js";
import { readMissionApprovalContract } from "./missionApprovalContract.js";
import { changeMissionApproval } from "./missionApprovals.js";
import { missionAdminHistory, type MissionAdminSnapshot } from "../db/missionAdminSchema.js";
import { AppError, validationFailed } from "./errors.js";
import { freezeRewards } from "./missionLifecycle.js";
import { missionCategories, validateMissionDefinition, validateMissionRule } from "./missions.js";

export interface AdminMissionDto {
  missionId: string; title: string; description: string; category: string; periodType: string;
  active: boolean; displayOrder: number; updatedAt: string;
  startsAt: string | null; endsAt: string | null; claimDeadline: string | null; activationEffectiveAt: string;
  lifecycle: "INACTIVE" | "SCHEDULED" | "ACTIVE" | "ENDED";
  configurationIssues: string[];
  rule: { eventType: string; targetCount: number; sourceType: string | null; puzzleId: string | null; levelId: number | null; conditions: Record<string, string | number | boolean | null>; active: boolean } | null;
  rewards: { rewardType: string; amount: number; active: boolean }[];
}
export interface AdminMissionPage { missions: AdminMissionDto[]; limit: number; offset: number; hasMore: boolean }
export interface AdminMissionHistoryEntry {
  historyId: string; missionId: string; actorAdminUserId: string;
  action: "DRAFT_CREATED" | "METADATA_UPDATED" | "RULE_CONFIGURED" | "SCHEDULE_CONFIGURED" | "REWARDS_CONFIGURED" | "APPROVAL_GRANTED" | "APPROVAL_REVOKED" | "MISSION_ACTIVATED" | "MISSION_DEACTIVATED"; occurredAt: string;
  before: MissionAdminSnapshot | null; after: MissionAdminSnapshot;
}
export interface AdminMissionHistoryPage { entries: AdminMissionHistoryEntry[]; limit: number; offset: number; hasMore: boolean }
export const adminMissionHistoryFilters = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
}).strict();
export const adminMissionFilters = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
}).strict();
const metadata = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000),
  displayOrder: z.number().int().min(0).max(2147483647),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
}).strict();
const draft = metadata.omit({ expectedUpdatedAt: true }).extend({ category: z.enum(missionCategories) }).strict();

// Drafts have no rule, rewards or player progress. Lifecycle changes use explicit guarded operations.
export class AdminMissionService {
  constructor(private db: Database) {}

  changeLifecycle(id: string, action: "ACTIVATE" | "DEACTIVATE", input: unknown, actor: string, clock?: () => Date) { return changeMissionLifecycle(this.db, id, action, input, actor, clock); }

  chests() { return new AdminMissionChestService(this.db); }
  chestCapacity() { return new ChestCapacityService(this.db); }
  capacity() { return new MissionCapacityService(this.db); }

  readiness(id: string, now = new Date()) { return readMissionReadiness(this.db, id, now); }
  approvalContract(id: string, now = new Date()) { return readMissionApprovalContract(this.db, id, now); }
  changeApproval(id: string, category: unknown, input: unknown, actor: string, revoke = false, now = new Date()) { return changeMissionApproval(this.db, id, category, input, actor, revoke, now); }

  async list(filter: z.infer<typeof adminMissionFilters>, now = new Date()): Promise<AdminMissionPage> {
    const rows = await this.db.select().from(missions)
      .where(filter.search ? ilike(missions.title, `%${filter.search.replace(/[\\%_]/g, "\\$&")}%`) : undefined)
      .orderBy(asc(missions.displayOrder), asc(missions.missionId)).limit(filter.limit + 1).offset(filter.offset);
    const page = rows.slice(0, filter.limit);
    if (!page.length) return { missions: [], limit: filter.limit, offset: filter.offset, hasMore: false };
    const ids = page.map(row => row.missionId);
    const [rules, rewards] = await Promise.all([
      this.db.select().from(missionRules).where(inArray(missionRules.missionId, ids)),
      this.db.select().from(missionRewards).where(inArray(missionRewards.missionId, ids)).orderBy(asc(missionRewards.displayOrder), asc(missionRewards.missionRewardId)),
    ]);
    return { missions: page.map(row => missionDto(row, rules.find(rule => rule.missionId === row.missionId) ?? null, rewards.filter(reward => reward.missionId === row.missionId), now)), limit: filter.limit, offset: filter.offset, hasMore: rows.length > filter.limit };
  }

  async detail(id: string, now = new Date()): Promise<AdminMissionDto> {
    return this.db.transaction(async tx => {
      const [row] = await tx.select().from(missions).where(eq(missions.missionId, id)).for("share");
      if (!row) throw new AppError("MISSION_NOT_FOUND", "Mission was not found.", 404);
      const [rule] = await tx.select().from(missionRules).where(eq(missionRules.missionId, id));
      const rewards = await tx.select().from(missionRewards).where(eq(missionRewards.missionId, id)).orderBy(asc(missionRewards.displayOrder), asc(missionRewards.missionRewardId));
      return missionDto(row, rule ?? null, rewards, now);
    });
  }

  async createDraft(input: unknown, actorAdminUserId: string, now = new Date()): Promise<AdminMissionDto> {
    const parsed = draft.safeParse(input);
    if (!parsed.success) throw validationFailed("Provide a title, description, existing mission category and non-negative display order. Drafts cannot include rules, rewards or activation fields.");
    const category = parsed.data.category;
    // Existing M1 category/period mapping; incomplete FIXED windows remain unset.
    const periodType = category === "DAILY" ? "DAILY" : category === "WEEKLY" ? "WEEKLY" : category === "ACHIEVEMENT" ? "LIFETIME" : "FIXED";
    return this.db.transaction(async tx => {
      const [row] = await tx.insert(missions).values({ ...parsed.data, periodType, active: false, createdAt: now, updatedAt: now, activationEffectiveAt: now }).returning();
      await tx.insert(missionAdminHistory).values({ missionId: row.missionId, actorAdminUserId, action: "DRAFT_CREATED", occurredAt: now, before: null, after: snapshot(row) });
      return missionDto(row, null, [], now);
    });
  }

  async history(id: string, filter: z.infer<typeof adminMissionHistoryFilters>): Promise<AdminMissionHistoryPage> {
    const [row] = await this.db.select({ id: missions.missionId }).from(missions).where(eq(missions.missionId, id));
    if (!row) throw new AppError("MISSION_NOT_FOUND", "Mission was not found.", 404);
    const rows = await this.db.select().from(missionAdminHistory).where(eq(missionAdminHistory.missionId, id))
      .orderBy(desc(missionAdminHistory.historyId)).limit(filter.limit + 1).offset(filter.offset);
    return { entries: rows.slice(0, filter.limit).map(entry => ({ ...entry, historyId: entry.historyId.toString(), occurredAt: entry.occurredAt.toISOString() })), limit: filter.limit, offset: filter.offset, hasMore: rows.length > filter.limit };
  }

  async updateMetadata(id: string, input: unknown, actorAdminUserId: string, now = new Date()) {
    const parsed = metadata.safeParse(input);
    if (!parsed.success) throw validationFailed("Provide a title, description, non-negative display order and the loaded revision. Only these metadata fields can be edited.");
    const { expectedUpdatedAt, ...values } = parsed.data;
    await this.db.transaction(async tx => {
      const [row] = await tx.select().from(missions).where(eq(missions.missionId, id)).for("update");
      if (!row) throw new AppError("MISSION_NOT_FOUND", "Mission was not found.", 404);
      if (row.active) throw new AppError("MISSION_METADATA_LOCKED", "Only inactive mission metadata can be edited.", 409);
      if (row.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) throw new AppError("MISSION_REVISION_CONFLICT", "Mission changed. Reload its details before saving.", 409);
      if (row.title === values.title && row.description === values.description && row.displayOrder === values.displayOrder) return;
      const [updated] = await tx.update(missions).set({ ...values, updatedAt: new Date(Math.max(now.getTime(), row.updatedAt.getTime() + 1)) })
        .where(and(eq(missions.missionId, id), eq(missions.active, false))).returning();
      await tx.insert(missionAdminHistory).values({ missionId: id, actorAdminUserId, action: "METADATA_UPDATED", occurredAt: now, before: snapshot(row), after: snapshot(updated) });
    });
    return this.detail(id, now);
  }

  async updateRule(id: string, input: unknown, actorAdminUserId: string, now = new Date()) {
    const { expectedUpdatedAt, ...values } = parseAdminMissionRule(input);
    await this.db.transaction(async tx => {
      // Same parent-first locking order as M1 processing and metadata editing.
      const [row] = await tx.select().from(missions).where(eq(missions.missionId, id)).for("update");
      if (!row) throw new AppError("MISSION_NOT_FOUND", "Mission was not found.", 404);
      if (row.active) throw new AppError("MISSION_RULE_LOCKED", "Only inactive mission rules can be edited.", 409);
      if (row.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) throw new AppError("MISSION_REVISION_CONFLICT", "Mission changed. Reload its details before saving.", 409);
      if (values.puzzleId) {
        const [puzzle] = await tx.select({ levelId: puzzles.levelId }).from(puzzles).where(eq(puzzles.puzzleId, values.puzzleId)).for("share");
        if (!puzzle || (values.levelId !== null && Number(puzzle.levelId) !== values.levelId)) throw validationFailed("Choose an existing CircZles ID and a matching level filter.");
      }
      const [old] = await tx.select().from(missionRules).where(eq(missionRules.missionId, id)).for("update");
      const before = old ? ruleSnapshot(old) : null;
      if (before && JSON.stringify(before) === JSON.stringify(ruleSnapshot(values))) return;
      const updatedAt = new Date(Math.max(now.getTime(), row.updatedAt.getTime() + 1));
      if (old) await tx.update(missionRules).set({ ...values, updatedAt }).where(eq(missionRules.missionId, id));
      else await tx.insert(missionRules).values({ ...values, missionId: id, createdAt: now, updatedAt });
      const [updated] = await tx.update(missions).set({ updatedAt }).where(eq(missions.missionId, id)).returning();
      await tx.insert(missionAdminHistory).values({ missionId: id, actorAdminUserId, action: "RULE_CONFIGURED", occurredAt: now,
        before: { ...snapshot(row), rule: before }, after: { ...snapshot(updated), rule: ruleSnapshot(values) } });
    });
    return this.detail(id, now);
  }

  async updateSchedule(id: string, input: unknown, actorAdminUserId: string, now = new Date()) {
    const parsed = parseAdminMissionSchedule(input);
    const values = { startsAt: parsed.startsAt === null ? null : new Date(parsed.startsAt), endsAt: parsed.endsAt === null ? null : new Date(parsed.endsAt), claimDeadline: parsed.claimDeadline === null ? null : new Date(parsed.claimDeadline) };
    await this.db.transaction(async tx => {
      const [row] = await tx.select().from(missions).where(eq(missions.missionId, id)).for("update");
      if (!row) throw new AppError("MISSION_NOT_FOUND", "Mission was not found.", 404);
      if (row.active) throw new AppError("MISSION_SCHEDULE_LOCKED", "Only inactive mission schedules can be edited.", 409);
      if (row.updatedAt.getTime() !== new Date(parsed.expectedUpdatedAt).getTime()) throw new AppError("MISSION_REVISION_CONFLICT", "Mission changed. Reload its details before saving.", 409);
      validateAdminMissionSchedule(row, values);
      const before = scheduleSnapshot(row);
      const after = scheduleSnapshot({ ...row, ...values });
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      const [updated] = await tx.update(missions).set({ ...values, updatedAt: new Date(Math.max(now.getTime(), row.updatedAt.getTime() + 1)) }).where(eq(missions.missionId, id)).returning();
      await tx.insert(missionAdminHistory).values({ missionId: id, actorAdminUserId, action: "SCHEDULE_CONFIGURED", occurredAt: now,
        before: { ...snapshot(row), schedule: before }, after: { ...snapshot(updated), schedule: after } });
    });
    return this.detail(id, now);
  }

  async updateRewards(id: string, input: unknown, actorAdminUserId: string, now = new Date()) {
    const parsed = parseAdminMissionRewards(input);
    const desired = [
      ...(parsed.xp === null ? [] : [{ rewardType: "XP", amount: parsed.xp }]),
      ...(parsed.synapsePoints === null ? [] : [{ rewardType: "SYNAPSE_POINTS", amount: parsed.synapsePoints }]),
    ];
    const desiredSnapshot = freezeRewards(desired);
    await this.db.transaction(async tx => {
      const [row] = await tx.select().from(missions).where(eq(missions.missionId, id)).for("update");
      if (!row) throw new AppError("MISSION_NOT_FOUND", "Mission was not found.", 404);
      if (row.active) throw new AppError("MISSION_REWARDS_LOCKED", "Only inactive mission rewards can be edited.", 409);
      if (row.updatedAt.getTime() !== new Date(parsed.expectedUpdatedAt).getTime()) throw new AppError("MISSION_REVISION_CONFLICT", "Mission changed. Reload its details before saving.", 409);
      const old = await tx.select().from(missionRewards).where(eq(missionRewards.missionId, id)).orderBy(asc(missionRewards.displayOrder), asc(missionRewards.missionRewardId)).for("update");
      if (old.some(reward => reward.rewardType !== "XP" && reward.rewardType !== "SYNAPSE_POINTS")) throw new AppError("MISSION_REWARDS_UNSUPPORTED", "This definition contains reward types outside this editor. Review them separately before editing.", 409);
      let currentSnapshot: ReturnType<typeof freezeRewards> | undefined;
      try { currentSnapshot = freezeRewards(old.filter(reward => reward.active)); }
      catch (error) { if (!(error instanceof AppError)) throw error; } // An incomplete/invalid XP/SP configuration can be explicitly repaired.
      if (JSON.stringify(currentSnapshot) === JSON.stringify(desiredSnapshot)) return;
      const updatedAt = new Date(Math.max(now.getTime(), row.updatedAt.getTime() + 1));
      // Retain row IDs; disable omitted/duplicate rows rather than deleting historical configuration.
      await tx.update(missionRewards).set({ active: false, updatedAt }).where(and(eq(missionRewards.missionId, id), eq(missionRewards.active, true)));
      for (const reward of desired) {
        const existing = old.find(old => old.rewardType === reward.rewardType && old.active) ?? old.find(old => old.rewardType === reward.rewardType);
        if (existing) await tx.update(missionRewards).set({ amount: reward.amount, active: true, updatedAt }).where(eq(missionRewards.missionRewardId, existing.missionRewardId));
        else await tx.insert(missionRewards).values({ ...reward, missionId: id, active: true, displayOrder: reward.rewardType === "XP" ? 0 : 1, createdAt: now, updatedAt });
      }
      const after = await tx.select().from(missionRewards).where(eq(missionRewards.missionId, id)).orderBy(asc(missionRewards.displayOrder), asc(missionRewards.missionRewardId));
      const [updated] = await tx.update(missions).set({ updatedAt }).where(eq(missions.missionId, id)).returning();
      await tx.insert(missionAdminHistory).values({ missionId: id, actorAdminUserId, action: "REWARDS_CONFIGURED", occurredAt: now,
        before: { ...snapshot(row), rewards: rewardsSnapshot(old) }, after: { ...snapshot(updated), rewards: rewardsSnapshot(after) } });
    });
    return this.detail(id, now);
  }
}

function rewardsSnapshot(rows: Array<typeof missionRewards.$inferSelect>) {
  return rows.map(reward => ({ rewardType: reward.rewardType, amount: reward.amount, active: reward.active }));
}

function scheduleSnapshot(row: Pick<typeof missions.$inferSelect, "startsAt" | "endsAt" | "claimDeadline" | "activationEffectiveAt">) {
  return { startsAt: row.startsAt?.toISOString() ?? null, endsAt: row.endsAt?.toISOString() ?? null, claimDeadline: row.claimDeadline?.toISOString() ?? null, activationEffectiveAt: row.activationEffectiveAt.toISOString() };
}

function ruleSnapshot(rule: NonNullable<AdminMissionDto["rule"]>): NonNullable<AdminMissionDto["rule"]> {
  return { eventType: rule.eventType, targetCount: rule.targetCount, sourceType: rule.sourceType, puzzleId: rule.puzzleId, levelId: rule.levelId, conditions: rule.conditions, active: rule.active };
}

function snapshot(row: typeof missions.$inferSelect): MissionAdminSnapshot {
  return { title: row.title, description: row.description, displayOrder: row.displayOrder, category: row.category, periodType: row.periodType, active: row.active, updatedAt: row.updatedAt.toISOString() };
}

function missionDto(row: typeof missions.$inferSelect, rule: typeof missionRules.$inferSelect | null, rewards: Array<typeof missionRewards.$inferSelect>, now: Date): AdminMissionDto {
  const issues: string[] = [];
  const check = (validate: () => unknown) => { try { validate(); } catch (error) { if (!(error instanceof AppError)) throw error; issues.push(error.message); } };
  check(() => validateMissionDefinition(row));
  if (!rule?.active) issues.push("An active mission rule is required.");
  else check(() => validateMissionRule(rule));
  check(() => freezeRewards(rewards.filter(reward => reward.active)));
  const lifecycle = !row.active ? "INACTIVE" : row.endsAt && now >= row.endsAt ? "ENDED" : (row.startsAt && now < row.startsAt) || now < row.activationEffectiveAt ? "SCHEDULED" : "ACTIVE";
  return {
    missionId: row.missionId, title: row.title, description: row.description, category: row.category, periodType: row.periodType,
    active: row.active, displayOrder: row.displayOrder, updatedAt: row.updatedAt.toISOString(),
    startsAt: row.startsAt?.toISOString() ?? null, endsAt: row.endsAt?.toISOString() ?? null,
    claimDeadline: row.claimDeadline?.toISOString() ?? null, activationEffectiveAt: row.activationEffectiveAt.toISOString(),
    lifecycle, configurationIssues: issues,
    rule: rule ? { eventType: rule.eventType, targetCount: rule.targetCount, sourceType: rule.sourceType, puzzleId: rule.puzzleId, levelId: rule.levelId, conditions: rule.conditions, active: rule.active } : null,
    rewards: rewards.map(reward => ({ rewardType: reward.rewardType, amount: reward.amount, active: reward.active })),
  };
}
