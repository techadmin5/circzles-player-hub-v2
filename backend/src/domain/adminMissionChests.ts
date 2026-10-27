import { missionChestProductPolicy } from "../config/missionChestProduct.js";
import { parseAdminMissionRule } from "./adminMissionRules.js";
import { validateMissionDefinition } from "./missions.js";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { adminUsers, missions, missionRules, missionRewards } from "../db/schema.js";
import { missionChests, missionChestEligibility, missionChestAdminEvents as events, playerMissionChests } from "../db/missionChestSchema.js";
import type { GameStateTransaction } from "./gameState.js";
import { AppError, forbidden, validationFailed } from "./errors.js";
import { freezeRewards, snapshotTotals } from "./missionLifecycle.js";

export const chestRules = missionChestProductPolicy.periods;
const utc = z.string().datetime().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/).refine(v => !v.startsWith("0000-"));
const revision = z.string().datetime({ offset: true });
const configuration = z.object({ title: z.string().trim().min(1).max(200), missionIds: z.array(z.string().uuid()).max(6), xp: z.number().int().min(1).max(2147483647).nullable(), synapsePoints: z.number().int().min(1).max(2147483647).nullable(), startsAt: utc.nullable(), endsAt: utc.nullable(), expectedUpdatedAt: revision }).strict();
const operation = z.object({ expectedUpdatedAt: revision, configurationDigest: z.string().regex(/^[a-f0-9]{64}$/), operationKey: z.string().uuid(), expectedApprovalEventId: z.string().regex(/^[1-9]\d{0,18}$/).nullable().optional() }).strict();
type Tx = GameStateTransaction;
export class AdminMissionChestService {
  constructor(private db: Database) {}
  productPolicy() { return missionChestProductPolicy; }
  private async actor(tx: Tx, id: string) {
    const [actor] = await tx.select().from(adminUsers).where(eq(adminUsers.adminUserId, id)).for("share");
    if (!actor?.active || actor.role !== "SUPER_ADMIN") throw forbidden("Only an active SUPER_ADMIN may manage chests.");
  }
  async list(limit = 25, offset = 0) {
    const rows = await this.db.select({ chestId: missionChests.chestId }).from(missionChests).orderBy(asc(missionChests.createdAt), asc(missionChests.chestId)).limit(limit + 1).offset(offset);
    return { chests: await Promise.all(rows.slice(0, limit).map(row => this.detail(row.chestId))), hasMore: rows.length > limit };
  }
  private async context(tx: Tx, id: string, lock: "share" | "update" = "share") {
    const [row] = await tx.select().from(missionChests).where(eq(missionChests.chestId, id)).for(lock);
    if (!row) throw new AppError("CHEST_NOT_FOUND", "Chest was not found.", 404);
    const linked = await tx.select({ mission: missions }).from(missionChestEligibility).innerJoin(missions, eq(missions.missionId, missionChestEligibility.missionId)).where(and(eq(missionChestEligibility.chestId, id), eq(missionChestEligibility.selected, true))).orderBy(asc(missions.missionId)).for("share", { of: missions });
    // Mission revisions are part of the digest: later edits never revive approvals.
    const snapshot = { title: row.title, periodType: row.periodType, targetCount: row.targetCount, active: row.active, revision: row.updatedAt.toISOString(), startsAt: row.startsAt?.toISOString() ?? null, endsAt: row.endsAt?.toISOString() ?? null, rewards: row.rewards, missions: linked.map(({ mission: m }) => ({ missionId: m.missionId, title: m.title, revision: m.updatedAt.toISOString(), active: m.active, category: m.category, periodType: m.periodType })) };
    const digest = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
    const history = await tx.select().from(events).where(eq(events.chestId, id)).orderBy(desc(events.eventId));
    const approvals = (["PRODUCT", "REWARD_BUDGET"] as const).map(category => {
      const latest = history.find(e => e.action === `APPROVE_${category}` || e.action === `REVOKE_${category}`);
      return { category, eventId: latest?.eventId.toString() ?? null, status: !latest ? "MISSING" : latest.action.startsWith("REVOKE") ? "REVOKED" : latest.revision.getTime() !== row.updatedAt.getTime() || latest.digest !== digest ? "INVALIDATED" : "APPROVED" };
    });
    const problems: string[] = [], rule = chestRules[row.periodType as keyof typeof chestRules];
    if (!rule || row.targetCount !== rule.required || linked.length !== rule.selectable) problems.push("CHEST_MISSION_COUNT_INVALID");
    if (linked.some(({ mission: m }) => m.periodType !== row.periodType || m.category !== row.periodType || !m.active)) problems.push("CHEST_ELIGIBLE_MISSION_INVALID");
    for(const {mission} of linked){
      try{
        validateMissionDefinition(mission);
        const rules=await tx.select().from(missionRules).where(and(eq(missionRules.missionId,mission.missionId),eq(missionRules.active,true)));
        if(rules.length!==1)throw new Error("Missing supported rule");
        const r=rules[0];parseAdminMissionRule({eventType:r.eventType,targetCount:r.targetCount,sourceType:r.sourceType,puzzleId:r.puzzleId,levelId:r.levelId==null?null:Number(r.levelId),conditions:r.conditions,active:r.active,expectedUpdatedAt:mission.updatedAt.toISOString()});
        const rewards=await tx.select().from(missionRewards).where(and(eq(missionRewards.missionId,mission.missionId),eq(missionRewards.active,true)));
        freezeRewards(rewards);
        if(mission.endsAt&&mission.endsAt<=new Date())throw new Error("Expired eligible mission");
        const first=Math.max(Date.now(),row.activationEffectiveAt.getTime(),mission.activationEffectiveAt.getTime(),row.startsAt?.getTime()??-Infinity,mission.startsAt?.getTime()??-Infinity),last=Math.min(row.endsAt?.getTime()??Infinity,mission.endsAt?.getTime()??Infinity);
        if(first>=last)throw new Error("No overlapping eligible window");
      }catch{problems.push("CHEST_ELIGIBLE_MISSION_CONFIGURATION_INVALID");break;}
    }
    if (row.startsAt && row.endsAt && row.endsAt <= row.startsAt) problems.push("CHEST_WINDOW_INVALID");
    if (row.endsAt && row.endsAt <= new Date()) problems.push("CHEST_WINDOW_EXPIRED");
    try { snapshotTotals(row.rewards); } catch { problems.push("CHEST_REWARDS_INCOMPLETE"); }
    const policyReady = (await tx.execute<{ ready: boolean }>(
      // Actual schema capability, never a client flag or environment bypass.
      (await import("drizzle-orm")).sql`SELECT to_regclass('public.chest_capacity_exceptions') IS NOT NULL AND to_regclass('public.chest_capacity_events') IS NOT NULL AND to_regclass('public.chest_capacity_requests') IS NOT NULL AS ready`
    )).rows[0]?.ready === true;
    const blockers = [...problems, ...(!policyReady ? ["CHEST_CAPACITY_RECOVERY_REQUIRED"] : []), ...(approvals.some(a => a.status !== "APPROVED") ? ["CHEST_APPROVALS_REQUIRED"] : [])];
    return { row, snapshot, digest, approvals, problems, blockers, linked };
  }
  async detail(id: string) {
    return this.db.transaction(async tx => {
      const c = await this.context(tx, id);
      return { chestId: id, ...c.snapshot, configurationDigest: c.digest, approvals: c.approvals, blockers: c.blockers, activationReady: !c.row.active && c.blockers.length === 0, activationEffectiveAt: c.row.activationEffectiveAt.toISOString() };
    });
  }
  async history(id: string, limit = 25, offset = 0) {
    await this.detail(id);
    const rows = await this.db.select().from(events).where(eq(events.chestId, id)).orderBy(desc(events.eventId)).limit(limit + 1).offset(offset);
    return { entries: rows.slice(0, limit).map(e => ({ ...e, eventId: e.eventId.toString(), revision: e.revision.toISOString(), occurredAt: e.occurredAt.toISOString() })), hasMore: rows.length > limit };
  }
  async create(input: unknown, actor: string) {
    const parsed = z.object({ title: z.string().trim().min(1).max(200), periodType: z.enum(["DAILY", "WEEKLY"]) }).strict().safeParse(input);
    if (!parsed.success) throw validationFailed("Provide a title and DAILY or WEEKLY period. Rewards and activation cannot be supplied.");
    const id = await this.db.transaction(async tx => {
      await this.actor(tx, actor);
      const [row] = await tx.insert(missionChests).values({ ...parsed.data, targetCount: chestRules[parsed.data.periodType].required, rewards: null, active: false }).returning();
      const c = await this.context(tx, row.chestId);
      await tx.insert(events).values({ chestId: row.chestId, actorAdminUserId: actor, action: "CREATE", revision: row.updatedAt, digest: c.digest, before: null, after: c.snapshot });
      return row.chestId;
    }); return this.detail(id);
  }
  async configure(id: string, input: unknown, actor: string) {
    const p = configuration.safeParse(input);
    if (!p.success || new Set(p.data.missionIds).size !== p.data.missionIds.length) throw validationFailed("Provide unique eligible mission IDs, explicit optional positive integer XP/SP, UTC windows and the loaded revision.");
    await this.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('mission-chest-lifecycle',0))`);
      const before = await this.context(tx, id, "update"); await this.actor(tx, actor);
      if (before.row.active) throw new AppError("CHEST_CONFIGURATION_LOCKED", "Only inactive chests may be configured.", 409);
      if (new Date(p.data.expectedUpdatedAt).getTime() !== before.row.updatedAt.getTime()) throw new AppError("CHEST_REVISION_CONFLICT", "Chest changed; reload before saving.", 409);
      if (p.data.missionIds.length > chestRules[before.row.periodType as keyof typeof chestRules].selectable) throw validationFailed("Too many selectable missions for this chest.");
      const startsAt = p.data.startsAt ? new Date(p.data.startsAt) : null, endsAt = p.data.endsAt ? new Date(p.data.endsAt) : null;
      if (startsAt && endsAt && endsAt <= startsAt) throw validationFailed("Availability must end after its UTC start.");
      if (p.data.missionIds.length) {
        const linked = await tx.select().from(missions).where(inArray(missions.missionId, p.data.missionIds)).orderBy(asc(missions.missionId)).for("share");
        if (linked.length !== p.data.missionIds.length || linked.some(m => m.periodType !== before.row.periodType || m.category !== before.row.periodType)) throw validationFailed("Eligible missions must exist and match the chest's Daily/Weekly period.");
      }
      const rewards = p.data.xp === null && p.data.synapsePoints === null ? null : freezeRewards([...(p.data.xp === null ? [] : [{ rewardType: "XP", amount: p.data.xp }]), ...(p.data.synapsePoints === null ? [] : [{ rewardType: "SYNAPSE_POINTS", amount: p.data.synapsePoints }])]);
      let previous: ReturnType<typeof snapshotTotals>|null=null;
      try{if(before.row.rewards)previous=snapshotTotals(before.row.rewards);}catch{/* An inactive incomplete legacy draft can be repaired, not paid. */}
      const allocationChanged=JSON.stringify([...p.data.missionIds].sort())!==JSON.stringify(before.snapshot.missions.map(m=>m.missionId).sort())||
        (previous?.xp??0)!==(p.data.xp??0)||(previous?.synapsePoints??0)!==(p.data.synapsePoints??0)||
        (before.row.startsAt?.getTime()??null)!==(startsAt?.getTime()??null)||(before.row.endsAt?.getTime()??null)!==(endsAt?.getTime()??null);
      if(allocationChanged){
        // Processing holds this same parent FOR SHARE. Once FOR UPDATE is held,
        // no completion can race this check and mix two current-period pools.
        const [unfinished]=await tx.select({id:playerMissionChests.playerChestId}).from(playerMissionChests).where(and(eq(playerMissionChests.chestId,id),isNull(playerMissionChests.unlockedAt),gt(playerMissionChests.currentCount,0),gt(playerMissionChests.periodEndsAt,new Date()))).limit(1);
        if(unfinished)throw new AppError("CHEST_CURRENT_PERIOD_CONFIGURATION_LOCKED","Unfinished current-period progress exists. Keep its eligibility, rewards and window unchanged; use a new inactive draft or wait for the UTC reset. Title-only edits are allowed.",409);
      }
      await tx.update(missionChests).set({ title: p.data.title, startsAt, endsAt, rewards, updatedAt: new Date(Math.max(Date.now(), before.row.updatedAt.getTime() + 1)) }).where(eq(missionChests.chestId, id));
      await tx.update(missionChestEligibility).set({ selected: false, active: false }).where(eq(missionChestEligibility.chestId, id));
      for (const missionId of [...p.data.missionIds].sort()) await tx.insert(missionChestEligibility).values({ chestId: id, missionId, selected: true, active: false }).onConflictDoUpdate({ target: [missionChestEligibility.chestId, missionChestEligibility.missionId], set: { selected: true, active: false } });
      const after = await this.context(tx, id);
      await tx.insert(events).values({ chestId: id, actorAdminUserId: actor, action: "CONFIGURE", revision: after.row.updatedAt, digest: after.digest, before: before.snapshot, after: after.snapshot });
    }); return this.detail(id);
  }
  async operate(id: string, action: "APPROVE_PRODUCT" | "APPROVE_REWARD_BUDGET" | "REVOKE_PRODUCT" | "REVOKE_REWARD_BUDGET" | "ACTIVATE" | "DEACTIVATE", input: unknown, actor: string) {
    const p = operation.safeParse(input);
    if (!p.success) throw validationFailed("Provide the loaded revision/digest, UUID operation key and loaded approval event ID where applicable.");
    await this.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('mission-chest-lifecycle',0))`);
      const c = await this.context(tx, id, "update"); await this.actor(tx, actor);
      const [replay] = await tx.select().from(events).where(and(eq(events.chestId, id), eq(events.operationKey, p.data.operationKey)));
      if (replay) {
        if (replay.actorAdminUserId !== actor || replay.action !== action || JSON.stringify(replay.request) !== JSON.stringify(JSON.parse(JSON.stringify(p.data)))) {
          // JSONB object ordering is not a request fingerprint; compare sorted keys.
          if (replay.actorAdminUserId !== actor || replay.action !== action || Object.keys(p.data).some(k => JSON.stringify(replay.request?.[k]) !== JSON.stringify(p.data[k as keyof typeof p.data]))) throw new AppError("IDEMPOTENCY_CONFLICT", "Operation key belongs to another request.", 409);
        } return;
      }
      if (c.row.updatedAt.getTime() !== new Date(p.data.expectedUpdatedAt).getTime() || c.digest !== p.data.configurationDigest) throw new AppError("CHEST_REVISION_CONFLICT", "Chest or eligible mission configuration changed; reload.", 409);
      if (action.startsWith("APPROVE") || action.startsWith("REVOKE")) {
        const category = action.endsWith("REWARD_BUDGET") ? "REWARD_BUDGET" : "PRODUCT", latest = c.approvals.find(a => a.category === category)!;
        if ((p.data.expectedApprovalEventId ?? null) !== latest.eventId) throw new AppError("CHEST_APPROVAL_CONFLICT", "Approval history changed; reload.", 409);
        if (action.startsWith("APPROVE") && (c.row.active || c.problems.length || latest.status === "APPROVED")) throw new AppError("CHEST_APPROVAL_NOT_READY", "Complete an inactive configuration before explicit approval.", 409);
        if (action.startsWith("REVOKE") && (!latest.eventId || latest.status === "REVOKED")) throw new AppError("CHEST_APPROVAL_CONFLICT", "No approval is available to revoke.", 409);
      } else {
        if (action === "ACTIVATE") {
          if (c.row.active || c.blockers.length) throw new AppError("CHEST_ACTIVATION_BLOCKED", c.blockers.join(", ") || "Chest is already active.", 409);
        }
        const now = new Date(), active = action === "ACTIVATE";
        await tx.update(missionChests).set({ active, activationEffectiveAt: active ? new Date(Math.max(now.getTime(), c.row.activationEffectiveAt.getTime())) : c.row.activationEffectiveAt, updatedAt: new Date(Math.max(now.getTime(), c.row.updatedAt.getTime() + 1)) }).where(eq(missionChests.chestId, id));
        await tx.update(missionChestEligibility).set({ active: false }).where(eq(missionChestEligibility.chestId, id));
        if (active) for(const {mission} of c.linked) await tx.update(missionChestEligibility).set({ active: true, effectiveAt: new Date(Math.max(now.getTime(),c.row.activationEffectiveAt.getTime(),mission.activationEffectiveAt.getTime())) }).where(and(eq(missionChestEligibility.chestId, id), eq(missionChestEligibility.missionId,mission.missionId), eq(missionChestEligibility.selected, true)));
      }
      const after = await this.context(tx, id);
      await tx.insert(events).values({ chestId: id, actorAdminUserId: actor, action, revision: c.row.updatedAt, digest: c.digest, before: c.snapshot, after: after.snapshot, operationKey: p.data.operationKey, request: p.data });
    }); return this.detail(id);
  }
}
