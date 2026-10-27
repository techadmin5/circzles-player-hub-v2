import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../domain/errors.js";

const claimRoutes = new Set([
  "/api/missions/:missionId/claim",
  "/api/missions/:missionId/periods/:periodKey/claim",
  "/api/mission-chests/:chestId/periods/:periodKey/claim",
]);
export function registerMissionClaimMaintenance(app: FastifyInstance, enabled: boolean, authenticate: (request: FastifyRequest) => Promise<unknown>) {
  app.addHook("preHandler", async (request, reply) => {
    if (enabled || request.method !== "POST" || !claimRoutes.has(request.routeOptions.url ?? "")) return;
    await authenticate(request);
    reply.header("Cache-Control", "private, no-store").header("Retry-After", "60");
    throw new AppError("MISSION_CLAIMS_MAINTENANCE", "Mission reward claims are temporarily unavailable. Earned rewards are retained.", 503);
  });
}
