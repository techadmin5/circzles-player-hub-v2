import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { MissionProcessorRunner } from "../src/domain/missionProcessorRunner.js";
import { registerMissionClaimMaintenance } from "../src/http/missionMaintenance.js";
import { createShutdownCoordinator } from "../src/shutdown.js";
import { loadEnv } from "../src/config/env.js";
import { AppError } from "../src/domain/errors.js";

const env = { NODE_ENV: "test", DATABASE_URL: "postgres://example", SESSION_SECRET: "test-secret-with-at-least-32-characters" };
describe("schema-independent mission deployment controls", () => {
  it("defaults to enabled and parses each explicit false independently", () => {
    expect(loadEnv(env)).toMatchObject({ MISSION_PROCESSOR_ENABLED: true, MISSION_CLAIMS_ENABLED: true, BACKEND_SHUTDOWN_TIMEOUT_MS: 25000 });
    expect(loadEnv({ ...env, MISSION_PROCESSOR_ENABLED: "false" })).toMatchObject({ MISSION_PROCESSOR_ENABLED: false, MISSION_CLAIMS_ENABLED: true });
    expect(loadEnv({ ...env, MISSION_CLAIMS_ENABLED: "false" })).toMatchObject({ MISSION_PROCESSOR_ENABLED: true, MISSION_CLAIMS_ENABLED: false });
  });
  it.each(["1", "0", "FALSE", "", "yes"])("rejects unsafe boolean configuration %s", value => {
    expect(() => loadEnv({ ...env, MISSION_PROCESSOR_ENABLED: value })).toThrow(); expect(() => loadEnv({ ...env, MISSION_CLAIMS_ENABLED: value })).toThrow();
  });
  it.each(["0", "NaN", "300001"])("rejects unsafe shutdown timeout %s", value => expect(() => loadEnv({ ...env, BACKEND_SHUTDOWN_TIMEOUT_MS: value })).toThrow());
  it("enabled by default schedules work and exposes only safe state", async () => {
    vi.useFakeTimers();
    try {
      const processBatch = vi.fn(async () => 0), runner = new MissionProcessorRunner({ processBatch }, 1000, 50, vi.fn()); runner.start();
      await vi.advanceTimersByTimeAsync(1000); expect(processBatch).toHaveBeenCalledTimes(1);
      expect(runner.getState()).toEqual({ enabled: true, status: "idle", scheduled: true, inFlight: false }); await runner.stop();
    } finally { vi.useRealTimers(); }
  });
  it("disabled workers schedule no batches, including direct ticks", async () => {
    const processBatch = vi.fn(async () => 0), runner = new MissionProcessorRunner({ processBatch }, 1000, 50, vi.fn(), false); runner.start();
    expect(await runner.tick()).toBe(false); expect(processBatch).not.toHaveBeenCalled(); expect(runner.getState().status).toBe("disabled"); await runner.stop();
  });
  it("stops scheduling synchronously and awaits active processing before stopped", async () => {
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const processBatch = vi.fn(async () => { await wait; return 1; }), runner = new MissionProcessorRunner({ processBatch }, 1000, 50, vi.fn()); runner.start();
    const active = runner.tick(); await Promise.resolve();
    const drained = runner.stop(); expect(runner.stop()).toBe(drained); expect(runner.getState().status).toBe("draining"); expect(await runner.tick()).toBe(false);
    let stopped = false; void drained.then(() => { stopped = true; }); await Promise.resolve(); expect(stopped).toBe(false);
    release(); await active; await drained; expect(stopped).toBe(true); expect(runner.getState().status).toBe("stopped"); runner.start(); expect(await runner.tick()).toBe(false); expect(processBatch).toHaveBeenCalledTimes(1);
  });
  it("cancels an accepted but not started tick when shutdown begins", async () => {
    const processBatch = vi.fn(async () => 0), runner = new MissionProcessorRunner({ processBatch }, 1000, 50, vi.fn()); const accepted = runner.tick(); await runner.stop(); expect(await accepted).toBe(false); expect(processBatch).not.toHaveBeenCalled();
  });
  it("drains failed work without reopening the worker", async () => {
    const errors = vi.fn(), runner = new MissionProcessorRunner({ processBatch: async () => { throw new Error("fixture"); } }, 1000, 50, errors); expect(await runner.tick()).toBe(false); await runner.stop(); expect(errors).toHaveBeenCalledTimes(1); expect(await runner.tick()).toBe(false);
  });
  it.each(["/api/missions/:missionId/claim", "/api/missions/:missionId/periods/:periodKey/claim", "/api/mission-chests/:chestId/periods/:periodKey/claim"])("gates %s with identical authenticated maintenance policy", async route => {
    const app = Fastify(), authenticate = vi.fn(async () => ({ playerId: "server-player" })), mutation = vi.fn(async () => ({ ok: true }));
    registerMissionClaimMaintenance(app, false, authenticate);
    app.setErrorHandler((error, _request, reply) => { const known = error as AppError; return reply.status(known.statusCode).send({ code: known.code }); });
    app.post(route, mutation); app.get("/api/missions", async () => ({ missions: [] })); app.get("/api/mission-chests", async () => ({ chests: [] }));
    const url = route.replace(":missionId", "m").replace(":chestId", "c").replace(":periodKey", "2026-01-01");
    const reply = await app.inject({ method: "POST", url, payload: { claimsEnabled: true }, headers: { "x-mission-claims-enabled": "true" } });
    expect(reply.statusCode).toBe(503); expect(reply.json()).toEqual({ code: "MISSION_CLAIMS_MAINTENANCE" }); expect(reply.headers["retry-after"]).toBe("60"); expect(mutation).not.toHaveBeenCalled(); expect(authenticate).toHaveBeenCalledTimes(1);
    expect((await app.inject("/api/missions")).statusCode).toBe(200); expect((await app.inject("/api/mission-chests")).statusCode).toBe(200); await app.close();
  });
  it("enabled maintenance policy leaves claim authority to existing endpoints", async () => {
    const app = Fastify(); registerMissionClaimMaintenance(app, true, async () => { throw new Error("must not change enabled auth flow"); }); app.post("/api/missions/:missionId/claim", async () => ({ ok: true })); expect((await app.inject({ method: "POST", url: "/api/missions/m/claim" })).statusCode).toBe(200); await app.close();
  });
  it("memoizes repeated shutdown signals and closes DB only after worker/HTTP drain", async () => {
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); const sequence: string[] = [];
    const shutdown = createShutdownCoordinator({ stopWorker: () => { sequence.push("stop"); return wait; }, closeHttp: async () => { sequence.push("http"); }, closeDatabase: async () => { sequence.push("database"); }, timeoutMs: 1000, log: event => { sequence.push(event); } });
    const first = shutdown(); expect(shutdown()).toBe(first); await Promise.resolve(); expect(sequence).not.toContain("database"); release(); await first;
    expect(sequence).toEqual(["shutdown_started", "stop", "http", "database", "shutdown_complete"]);
  });
  it("bounds shutdown time and logs only a safe failure code", async () => {
    const log = vi.fn(), database = vi.fn(async () => {});
    const shutdown = createShutdownCoordinator({ stopWorker: () => new Promise<void>(() => {}), closeHttp: async () => {}, closeDatabase: database, timeoutMs: 10, log });
    await expect(shutdown()).rejects.toThrow("BACKEND_SHUTDOWN_FAILED"); expect(database).not.toHaveBeenCalled(); expect(log).toHaveBeenLastCalledWith("shutdown_failed", "SHUTDOWN_TIMEOUT");
  });
});
