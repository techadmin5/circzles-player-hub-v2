import type { FastifyInstance } from "fastify";
import type { IdentityService } from "../domain/identity.js";
import type { PlayerMissionService } from "../domain/missions.js";
import { unauthorized, validationFailed } from "../domain/errors.js";
import { SESSION_COOKIE_NAME } from "../domain/sessions.js";

export function registerPlayerMissionHistoryRoutes(app: FastifyInstance, identity: IdentityService, missions: PlayerMissionService) {
  app.get("/api/missions/history", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const player = await identity.getPlayerForToken(request.cookies[SESSION_COOKIE_NAME]);
    if (!player) throw unauthorized();
    if (request.body !== undefined) throw validationFailed("History does not accept request data.");
    return missions.history(player.internalId, request.query);
  });
}
