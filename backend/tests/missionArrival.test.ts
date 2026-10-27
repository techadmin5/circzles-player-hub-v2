import { it, expect } from "vitest";
import Fastify from "fastify";
import { registerMissionArrival } from "../src/http/missionArrival.js";

it("records arrival before authentication waits and ignores forged client timestamps", async () => {
  const app = Fastify(), arrival = registerMissionArrival(app); let authenticationFinished = 0;
  app.addHook("preHandler", async () => { await new Promise(resolve => setTimeout(resolve, 30)); authenticationFinished = Date.now(); });
  app.post("/claim", async request => ({ arrivedAt: arrival(request).getTime(), authenticationFinished }));
  try {
    const before = Date.now(), result = await app.inject({ method: "POST", url: "/claim", payload: { arrivedAt: "2000-01-01Z" }, headers: { "x-arrived-at": "2000-01-01Z" } });
    expect(result.statusCode).toBe(200); expect(result.json().arrivedAt).toBeGreaterThanOrEqual(before); expect(result.json().arrivedAt).toBeLessThan(result.json().authenticationFinished);
  } finally { await app.close(); }
});
