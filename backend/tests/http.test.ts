import { describe, expect, it } from "vitest";
import { buildApp } from "../src/http/app.js";
import { GameStateService, temporaryDevelopmentProgressionLevels } from "../src/domain/gameState.js";
import { IdentityService } from "../src/domain/identity.js";
import { PuzzleOwnershipService } from "../src/domain/puzzles.js";
import { SubmissionService } from "../src/domain/submissions.js";
import { FakeGameStateRepository, FakeIdentityRepository, FakePuzzleRepository, FakeSubmissionRepository, FakeVideoStorage } from "./fakes.js";
import type { Env } from "../src/config/env.js";

function env(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: "test",
    PORT: 4000,
    DATABASE_URL: "postgres://example",
    FRONTEND_ORIGIN: "http://localhost:3000",
    SESSION_SECRET: "test-session-secret-with-at-least-32-chars",
    COOKIE_SECURE: false,
    ...overrides,
  };
}

async function appWithFakes(overrides: Partial<Env> = {}) {
  const testEnv = env(overrides);
  const gameRepo = new FakeGameStateRepository();
  const gameState = new GameStateService(gameRepo);
  await gameState.seedProgressionLevels(temporaryDevelopmentProgressionLevels);
  const identityRepo = new FakeIdentityRepository();
  const identity = new IdentityService(identityRepo, testEnv.SESSION_SECRET);
  const puzzleRepo = new FakePuzzleRepository();
  const puzzles = new PuzzleOwnershipService(puzzleRepo);
  await puzzles.seedDevelopmentCatalog();
  const submissionRepo = new FakeSubmissionRepository(puzzleRepo);
  const videoStorage = new FakeVideoStorage();
  const submissionService = new SubmissionService(submissionRepo, videoStorage);
  const app = buildApp({ env: testEnv, identity, gameState, puzzles, submissions: submissionService, checkDb: async () => {} });
  return { app, gameRepo, puzzleRepo, submissionRepo, videoStorage, testEnv };
}

async function login(app: Awaited<ReturnType<typeof appWithFakes>>["app"]) {
  const res = await app.inject({ method: "POST", url: "/api/dev/login" });
  return Array.isArray(res.headers["set-cookie"]) ? res.headers["set-cookie"][0] : res.headers["set-cookie"] ?? "";
}

describe("http auth poc", () => {
  it("GET /api/me requires authentication", async () => {
    const { app } = await appWithFakes();
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHORIZED");
  });

  it("development login creates a session and GET /api/me returns the player", async () => {
    const { app } = await appWithFakes({ NODE_ENV: "development" });
    const login = await app.inject({ method: "POST", url: "/api/dev/login" });
    expect(login.statusCode).toBe(200);
    expect(login.json().publicPlayerId).toBe("CZ-8F42KD");
    const cookie = login.headers["set-cookie"];
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: Array.isArray(cookie) ? cookie[0] : cookie ?? "" } });
    expect(me.statusCode).toBe(200);
    expect(me.json().displayName).toBe("Smokey_OP");
    expect(me.json().progressionLevel).toBe(1);
    expect(me.json().rank).toBe("Peasant");
    expect(me.json().xp).toBe(0);
    expect(me.json().xpNeeded).toBe(1200);
    expect(me.json().synapsePoints).toBe(0);
  });

  it("production cannot use development login", async () => {
    const { app } = await appWithFakes({ NODE_ENV: "production", COOKIE_SECURE: true });
    const res = await app.inject({ method: "POST", url: "/api/dev/login" });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("preserves known Fastify 4xx errors", async () => {
    const { app } = await appWithFakes({ NODE_ENV: "development" });
    const res = await app.inject({
      method: "POST",
      url: "/api/dev/login",
      headers: { "content-type": "text/plain" },
      payload: "not json",
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().code).toBe("FST_ERR_CTP_INVALID_MEDIA_TYPE");
  });

  it("health checks the database connection hook", async () => {
    let checked = false;
    const { testEnv } = await appWithFakes();
    const gameState = new GameStateService(new FakeGameStateRepository());
    await gameState.seedProgressionLevels(temporaryDevelopmentProgressionLevels);
    const puzzles = new PuzzleOwnershipService(new FakePuzzleRepository());
    await puzzles.seedDevelopmentCatalog();
    const puzzleRepo = new FakePuzzleRepository();
    const submissions = new SubmissionService(new FakeSubmissionRepository(puzzleRepo), new FakeVideoStorage());
    const app = buildApp({ env: testEnv, identity: new IdentityService(new FakeIdentityRepository(), testEnv.SESSION_SECRET), gameState, puzzles, submissions, checkDb: async () => { checked = true; } });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(checked).toBe(true);
  });

  it("development grant endpoints are unavailable in production", async () => {
    const { app } = await appWithFakes({ NODE_ENV: "production", COOKIE_SECURE: true });
    const res = await app.inject({ method: "POST", url: "/api/dev/xp/grant", payload: { amount: 100, reason: "test" } });
    expect(res.statusCode).toBe(403);
  });

  it("development grant endpoints infer player from session and reject selected player ids", async () => {
    const { app } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    const res = await app.inject({ method: "POST", url: "/api/dev/xp/grant", headers: { cookie }, payload: { playerId: "other-player", amount: 100, reason: "test" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("/api/me returns DB-backed XP/rank/progressionLevel/Synapse Points", async () => {
    const { app } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    await app.inject({ method: "POST", url: "/api/dev/xp/grant", headers: { cookie }, payload: { amount: 8000, reason: "test" } });
    await app.inject({ method: "POST", url: "/api/dev/points/credit", headers: { cookie }, payload: { amount: 500, reason: "test" } });
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().xp).toBe(8000);
    expect(me.json().progressionLevel).toBe(15);
    expect(me.json().rank).toBe("Knight");
    expect(me.json().xpNeeded).toBe(12800);
    expect(me.json().synapsePoints).toBe(500);
  });

  it("GET /api/me/puzzles requires authentication", async () => {
    const { app } = await appWithFakes();
    const res = await app.inject({ method: "GET", url: "/api/me/puzzles" });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/puzzles/claim requires authentication", async () => {
    const { app } = await appWithFakes();
    const res = await app.inject({ method: "POST", url: "/api/puzzles/claim", payload: { code: "DEV-MM-R1-001" } });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHORIZED");
  });

  it("POST /api/puzzles/claim rejects browser-supplied player and puzzle ids", async () => {
    const { app } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/puzzles/claim",
      headers: { cookie },
      payload: { code: "DEV-MM-R1-001", playerId: "other", puzzleId: "DEV-PUZZLE-METAMORPHOSIS-R1" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("POST /api/puzzles/claim claims a puzzle for the current session player", async () => {
    const { app } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    const claim = await app.inject({ method: "POST", url: "/api/puzzles/claim", headers: { cookie }, payload: { code: " dev-mm-r1-001 " } });
    expect(claim.statusCode).toBe(200);
    expect(claim.json().success).toBe(true);
    expect(claim.json().puzzle.name).toBe("Metamorphosis");
    expect(claim.json().puzzle.levelId).toBe(18);

    const owned = await app.inject({ method: "GET", url: "/api/me/puzzles", headers: { cookie } });
    expect(owned.statusCode).toBe(200);
    expect(owned.json()).toHaveLength(1);
    expect(owned.json()[0].id).toBe("DEV-PUZZLE-METAMORPHOSIS-R1");
  });

  it("POST /api/puzzles/claim rejects PostgreSQL bigint overflow without a 500", async () => {
    const { app } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/puzzles/claim",
      headers: { cookie },
      payload: { code: "DEV-MM-R1-9223372036854775808" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("GET /api/puzzles/:puzzleId returns the correct active variant", async () => {
    const { app, puzzleRepo } = await appWithFakes();
    puzzleRepo.puzzles.set("11111111-1111-4111-8111-111111111111", {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Metamorphosis",
      runCode: "R1",
      levelId: 18,
      image: "/puzzles/placeholder.svg",
      description: "Variant R1",
      active: true,
    });
    puzzleRepo.puzzles.set("22222222-2222-4222-8222-222222222222", {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Metamorphosis",
      runCode: "R2",
      levelId: 22,
      image: "/puzzles/placeholder.svg",
      description: "Variant R2",
      active: true,
    });
    const res = await app.inject({ method: "GET", url: "/api/puzzles/22222222-2222-4222-8222-222222222222" });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("22222222-2222-4222-8222-222222222222");
    expect(res.json().runCode).toBe("R2");
  });

  it("GET /api/puzzles/:puzzleId returns fractional levelId as a JSON number", async () => {
    const { app, puzzleRepo } = await appWithFakes();
    puzzleRepo.puzzles.set("55555555-5555-4555-8555-555555555555", {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Side Quest",
      runCode: "SQ",
      levelId: 0.5,
      image: "/puzzles/placeholder.svg",
      description: "Fractional challenge",
      active: true,
    });
    const res = await app.inject({ method: "GET", url: "/api/puzzles/55555555-5555-4555-8555-555555555555" });
    expect(res.statusCode).toBe(200);
    expect(res.json().levelId).toBe(0.5);
    expect(typeof res.json().levelId).toBe("number");
  });

  it("GET /api/puzzles/:puzzleId returns 404 for unknown or inactive puzzle ids", async () => {
    const { app, puzzleRepo } = await appWithFakes();
    puzzleRepo.puzzles.set("33333333-3333-4333-8333-333333333333", {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Inactive",
      runCode: "R1",
      levelId: 18,
      image: "/puzzles/placeholder.svg",
      description: "Inactive variant",
      active: false,
    });

    const unknown = await app.inject({ method: "GET", url: "/api/puzzles/44444444-4444-4444-8444-444444444444" });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().code).toBe("PUZZLE_NOT_FOUND");

    const inactive = await app.inject({ method: "GET", url: "/api/puzzles/33333333-3333-4333-8333-333333333333" });
    expect(inactive.statusCode).toBe(404);
    expect(inactive.json().code).toBe("PUZZLE_NOT_FOUND");
  });

  it.each([
    ["POST", "/api/uploads/videos/signed-url"],
    ["POST", "/api/uploads/videos/10000000-0000-4000-8000-000000000001/complete"],
    ["POST", "/api/submissions"],
    ["GET", "/api/submissions"],
    ["GET", "/api/submissions/20000000-0000-4000-8000-000000000001"],
  ])("%s %s requires authentication", async (method, url) => {
    const { app } = await appWithFakes();
    const res = await app.inject({ method: method as "GET" | "POST", url, payload: method === "POST" ? {} : undefined });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHORIZED");
  });

  it.each(["puzzleId", "levelId", "playerId"])("submission body strictly rejects %s", async (field) => {
    const { app } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    const res = await app.inject({ method: "POST", url: "/api/submissions", headers: { cookie }, payload: { playerPuzzleId: "30000000-0000-4000-8000-000000000001", completionTimeMs: 1000, videoUploadId: "10000000-0000-4000-8000-000000000001", [field]: field === "levelId" ? 99 : "browser-value" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("rejects a non-positive completion time", async () => {
    const { app } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    const res = await app.inject({ method: "POST", url: "/api/submissions", headers: { cookie }, payload: { playerPuzzleId: "30000000-0000-4000-8000-000000000001", completionTimeMs: 0, videoUploadId: "10000000-0000-4000-8000-000000000001" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("rejects completion time above the PostgreSQL integer maximum", async () => {
    const { app } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    const res = await app.inject({ method: "POST", url: "/api/submissions", headers: { cookie }, payload: { playerPuzzleId: "30000000-0000-4000-8000-000000000001", completionTimeMs: 2_147_483_648, videoUploadId: "10000000-0000-4000-8000-000000000001" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("signs, finalizes, and submits through authenticated routes", async () => {
    const { app, puzzleRepo } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    puzzleRepo.ownerships.push({ playerPuzzleId: "30000000-0000-4000-8000-000000000001", playerId: "player-1", puzzleId: "DEV-PUZZLE-METAMORPHOSIS-R1", status: "OWNED" });
    const signed = await app.inject({ method: "POST", url: "/api/uploads/videos/signed-url", headers: { cookie }, payload: { filename: "solve.mp4", mimeType: "video/mp4", sizeBytes: 1024 } });
    expect(signed.statusCode).toBe(200);
    const videoUploadId = signed.json().videoUploadId;
    expect((await app.inject({ method: "POST", url: `/api/uploads/videos/${videoUploadId}/complete`, headers: { cookie }, payload: {} })).statusCode).toBe(200);
    const created = await app.inject({ method: "POST", url: "/api/submissions", headers: { cookie }, payload: { playerPuzzleId: "30000000-0000-4000-8000-000000000001", completionTimeMs: 161000, videoUploadId } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ puzzleId: "DEV-PUZZLE-METAMORPHOSIS-R1", levelId: 18, status: "PENDING_REVIEW" });
  });
});
