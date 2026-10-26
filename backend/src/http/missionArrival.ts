import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../domain/errors.js";

// Private server receipt time, before authentication queries and transaction locks.
export function registerMissionArrival(app: FastifyInstance) {
  const arrivals = new WeakMap<FastifyRequest, number>();
  app.addHook("onRequest", async request => { arrivals.set(request, Date.now()); });
  return (request: FastifyRequest) => {
    const stamp = arrivals.get(request);
    if (stamp === undefined) throw new AppError("MISSION_ARRIVAL_MISSING", "Trusted claim arrival time is unavailable.", 500);
    return new Date(stamp);
  };
}
