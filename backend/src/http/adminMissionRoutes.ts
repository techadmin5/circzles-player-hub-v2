import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Env } from "../config/env.js";
import type { AdminAuthorizationService } from "../domain/adminAuth.js";
import { AdminMissionService, adminMissionFilters, adminMissionHistoryFilters } from "../domain/adminMissions.js";
import { adminMissionRuleOptions } from "../domain/adminMissionRules.js";
import { AppError, forbidden, validationFailed } from "../domain/errors.js";
import { constantTimeEqual, SESSION_COOKIE_NAME } from "../domain/sessions.js";

export function registerAdminMissionRoutes(app: FastifyInstance, deps: { env: Env; adminAuth: AdminAuthorizationService; adminMissions: AdminMissionService }) {
  app.register(async scope => {
    const actors = new WeakMap<FastifyRequest, string>();
    scope.addHook("preHandler", async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const actor = await deps.adminAuth.requirePermission(request.cookies[SESSION_COOKIE_NAME], "MISSIONS_MANAGE");
      const proxy = request.headers["x-player-hub-proxy-secret"];
      if (deps.env.NODE_ENV === "production" && (!deps.env.PLAYER_HUB_PROXY_SECRET || typeof proxy !== "string" || !constantTimeEqual(proxy, deps.env.PLAYER_HUB_PROXY_SECRET))) throw forbidden("Use the Player Hub website for mission administration.");
      if (!["GET", "HEAD"].includes(request.method) && ((request.headers.origin && request.headers.origin !== new URL(deps.env.FRONTEND_ORIGIN).origin) || request.headers["sec-fetch-site"] === "cross-site")) throw forbidden("Invalid mission administration request origin.");
      actors.set(request, actor.adminUserId);
    });
    function actorId(request: FastifyRequest) {
      const id = actors.get(request);
      if (!id) throw forbidden("An authenticated administrator is required.");
      return id;
    }
    function missionId(params: unknown) {
      const result = z.object({ missionId: z.string().uuid() }).strict().safeParse(params);
      if (!result.success) throw validationFailed("Invalid mission identifier.");
      return result.data.missionId;
    }
    scope.get("/api/admin/missions/:missionId/capacity-exceptions", async request => {
      const page = adminMissionHistoryFilters.safeParse(request.query);
      if (!page.success) throw validationFailed("Invalid exception pagination.");
      return deps.adminMissions.capacity().list(missionId(request.params), actorId(request), page.data.limit, page.data.offset);
    });
    function exceptionId(params: unknown) {
      const result = z.object({ exceptionId: z.string().uuid() }).strict().safeParse(params);
      if (!result.success) throw validationFailed("Invalid exception identifier.");
      return result.data.exceptionId;
    }
    scope.get("/api/admin/mission-capacity-exceptions/:exceptionId", async request => {
      if (!z.object({}).strict().safeParse(request.query).success) throw validationFailed("No exception query parameters are supported.");
      return deps.adminMissions.capacity().detail(exceptionId(request.params), actorId(request));
    });
    scope.post("/api/admin/mission-capacity-exceptions/:exceptionId/recover", async (request, reply) => {
      if (deps.env.MISSION_CLAIMS_ENABLED === false) {
        reply.header("Retry-After", "60");
        throw new AppError("MISSION_CLAIMS_MAINTENANCE", "Mission reward claims are temporarily unavailable. Earned rewards are retained.", 503);
      }
      if (!z.object({}).strict().safeParse(request.query).success) throw validationFailed("No recovery query parameters are supported.");
      return deps.adminMissions.capacity().recover(exceptionId(request.params), request.body, actorId(request));
    });
    const chests=deps.adminMissions.chests(), chestCapacity=deps.adminMissions.chestCapacity();
    function chestId(params: unknown) { const p=z.object({chestId:z.string().uuid()}).strict().safeParse(params);if(!p.success)throw validationFailed("Invalid chest ID.");return p.data.chestId; }
    function page(query: unknown){const p=adminMissionHistoryFilters.safeParse(query);if(!p.success)throw validationFailed("Invalid chest pagination.");return p.data;}
    scope.get("/api/admin/mission-chests/product-policy", async request => {
      if (!z.object({}).strict().safeParse(request.query).success) throw validationFailed("Product policy accepts no query assertions.");
      return chests.productPolicy();
    });
    scope.get("/api/admin/mission-chests",async request=>{const p=page(request.query);return chests.list(p.limit,p.offset);});
    scope.post("/api/admin/mission-chests",async(request,reply)=>reply.code(201).send(await chests.create(request.body,actorId(request))));
    scope.get("/api/admin/mission-chests/:chestId",async request=>chests.detail(chestId(request.params)));
    scope.patch("/api/admin/mission-chests/:chestId",async request=>chests.configure(chestId(request.params),request.body,actorId(request)));
    scope.get("/api/admin/mission-chests/:chestId/history",async request=>{const p=page(request.query);return chests.history(chestId(request.params),p.limit,p.offset);});
    for(const action of ["APPROVE_PRODUCT","APPROVE_REWARD_BUDGET","REVOKE_PRODUCT","REVOKE_REWARD_BUDGET","ACTIVATE","DEACTIVATE"] as const)scope.post(`/api/admin/mission-chests/:chestId/${action.toLowerCase().replaceAll("_","-")}`,async request=>{
      if(!z.object({}).strict().safeParse(request.query).success)throw validationFailed("Chest operations accept no query assertions.");
      return chests.operate(chestId(request.params),action,request.body,actorId(request));
    });
    scope.get("/api/admin/mission-chests/:chestId/capacity-exceptions",async request=>{const p=page(request.query);return chestCapacity.list(chestId(request.params),actorId(request),p.limit,p.offset);});
    scope.get("/api/admin/chest-capacity-exceptions/:exceptionId",async request=>chestCapacity.detail(exceptionId(request.params),actorId(request)));
    scope.post("/api/admin/chest-capacity-exceptions/:exceptionId/recover",async request=>{
      if(deps.env.MISSION_CLAIMS_ENABLED===false)throw new AppError("MISSION_CLAIMS_MAINTENANCE","Reward recovery is temporarily unavailable.",503);
      if(!z.object({}).strict().safeParse(request.query).success)throw validationFailed("Recovery accepts no query parameters.");
      return chestCapacity.recover(exceptionId(request.params),request.body,actorId(request));
    });
    scope.get("/api/admin/missions/access", async () => ({ allowed: true }));
    scope.get("/api/admin/missions/rule-options", async () => ({ options: adminMissionRuleOptions }));
    scope.get("/api/admin/missions", async request => {
      const filter = adminMissionFilters.safeParse(request.query);
      if (!filter.success) throw validationFailed("Invalid mission filters.");
      return deps.adminMissions.list(filter.data);
    });
    scope.get("/api/admin/missions/:missionId", async request => deps.adminMissions.detail(missionId(request.params)));
    scope.get("/api/admin/missions/:missionId/readiness", async request => {
      if (!z.object({}).strict().safeParse(request.query).success) throw validationFailed("Readiness accepts no client configuration or approval assertions.");
      return deps.adminMissions.readiness(missionId(request.params));
    });
    scope.get("/api/admin/missions/:missionId/approval-contract", async request => {
      if (!z.object({}).strict().safeParse(request.query).success) throw validationFailed("Approval contract inspection accepts no client approval or actor assertions.");
      return deps.adminMissions.approvalContract(missionId(request.params));
    });
    scope.post("/api/admin/missions", async (request, reply) => reply.code(201).send(await deps.adminMissions.createDraft(request.body, actorId(request))));
    for (const revoke of [false, true]) scope.post(`/api/admin/missions/:missionId/approvals/:category${revoke ? "/revoke" : ""}`, async request => {
      const params = z.object({ missionId: z.string().uuid(), category: z.enum(["PRODUCT", "REWARD_BUDGET"]) }).strict().safeParse(request.params);
      if (!params.success || !z.object({}).strict().safeParse(request.query).success) throw validationFailed("Invalid approval request parameters.");
      return deps.adminMissions.changeApproval(params.data.missionId, params.data.category, request.body, actorId(request), revoke);
    });
    for (const action of ["ACTIVATE", "DEACTIVATE"] as const) scope.post(`/api/admin/missions/:missionId/${action === "ACTIVATE" ? "activate" : "deactivate"}`, async request => {
      if (!z.object({}).strict().safeParse(request.query).success) throw validationFailed("Lifecycle operations accept no query parameters.");
      return deps.adminMissions.changeLifecycle(missionId(request.params), action, request.body, actorId(request));
    });
    scope.get("/api/admin/missions/:missionId/history", async request => {
      const filter = adminMissionHistoryFilters.safeParse(request.query);
      if (!filter.success) throw validationFailed("Invalid mission history pagination.");
      return deps.adminMissions.history(missionId(request.params), filter.data);
    });
    scope.patch("/api/admin/missions/:missionId", async request => deps.adminMissions.updateMetadata(missionId(request.params), request.body, actorId(request)));
    scope.patch("/api/admin/missions/:missionId/rule", async request => deps.adminMissions.updateRule(missionId(request.params), request.body, actorId(request)));
    scope.patch("/api/admin/missions/:missionId/schedule", async request => deps.adminMissions.updateSchedule(missionId(request.params), request.body, actorId(request)));
    scope.patch("/api/admin/missions/:missionId/rewards", async request => deps.adminMissions.updateRewards(missionId(request.params), request.body, actorId(request)));
  });
}
