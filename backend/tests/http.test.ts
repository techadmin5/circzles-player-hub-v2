import { describe, expect, it } from "vitest";
import { buildApp } from "../src/http/app.js";
import { GameStateService, temporaryDevelopmentProgressionLevels } from "../src/domain/gameState.js";
import { IdentityService } from "../src/domain/identity.js";
import { PuzzleOwnershipService } from "../src/domain/puzzles.js";
import { SubmissionService } from "../src/domain/submissions.js";
import { AdminAuthorizationService, hasAdminPermission } from "../src/domain/adminAuth.js";
import { AdminSubmissionService, type AdminSubmissionDto } from "../src/domain/adminSubmissions.js";
import { LeaderboardService } from "../src/domain/leaderboards.js";
import { SubmissionReviewService } from "../src/domain/submissionReviews.js";
import { PublicProfileService } from "../src/domain/publicProfiles.js";
import { MissionClaimService, PlayerMissionService } from "../src/domain/missions.js";
import { RewardCatalogService, type RewardCatalogRepository, type StoreCatalogItemDto } from "../src/domain/rewardCatalog.js";
import { StorePurchaseService, type StorePurchaseRepository, type StorePurchaseResult } from "../src/domain/storePurchases.js";
import { FakeAdminAuthorizationRepository, FakeAdminSubmissionRepository, FakeGameStateRepository, FakeIdentityRepository, FakeLeaderboardRepository, FakeMissionClaimRepository, FakePlayerMissionRepository, FakePublicProfileRepository, FakePuzzleRepository, FakeSubmissionRepository, FakeSubmissionReviewRepository, FakeVideoStorage } from "./fakes.js";
import type { Env } from "../src/config/env.js";

function env(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: "test",
    PORT: 4000,
    DATABASE_URL: "postgres://example",
    FRONTEND_ORIGIN: "http://localhost:3000",
    SESSION_SECRET: "test-session-secret-with-at-least-32-chars",
    COOKIE_SECURE: false,
    MISSION_PROCESSOR_INTERVAL_MS: 5000,
    MISSION_PROCESSOR_BATCH_SIZE: 50,
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
  const adminAuthRepo = new FakeAdminAuthorizationRepository(identityRepo);
  const adminAuth = new AdminAuthorizationService(adminAuthRepo, testEnv.SESSION_SECRET);
  const adminSubmissionRepo = new FakeAdminSubmissionRepository();
  const adminSubmissions = new AdminSubmissionService(adminSubmissionRepo);
  const leaderboardRepo = new FakeLeaderboardRepository();
  const leaderboards = new LeaderboardService(leaderboardRepo);
  const reviewRepo = new FakeSubmissionReviewRepository();
  const submissionReviews = new SubmissionReviewService(reviewRepo);
  const publicProfileRepo = new FakePublicProfileRepository();
  const publicProfiles = new PublicProfileService(publicProfileRepo);
  const missionRepo = new FakePlayerMissionRepository();
  const missions = new PlayerMissionService(missionRepo);
  const missionClaimRepo = new FakeMissionClaimRepository();
  const missionClaims = new MissionClaimService(missionClaimRepo);
  const catalogItems: StoreCatalogItemDto[] = [{ listingId: "10000000-0000-4000-8000-000000000001", rewardDefinitionId: "20000000-0000-4000-8000-000000000001", code: "FRAME_TEST", rewardType: "FRAME", name: "Test Frame", description: "Test catalog item.", imageUrl: null, rarity: "RARE", priceSynapsePoints: 250, featured: true, displayOrder: 1, purchaseLimit: null }];
  const rewardCatalog = new RewardCatalogService({ listAvailable: async () => catalogItems } satisfies RewardCatalogRepository);
  const purchaseCalls: Array<{ playerId: string; listingId: string; idempotencyKey: string }> = [];
  const storePurchases = new StorePurchaseService({ purchase: async (input) => {
    purchaseCalls.push(input);
    return { purchaseId: "30000000-0000-4000-8000-000000000001", listingId: input.listingId, reward: { rewardDefinitionId: catalogItems[0].rewardDefinitionId, code: "FRAME_TEST", rewardType: "FRAME", name: "Test Frame", imageUrl: null, rarity: "RARE" }, priceSynapsePoints: 250, balanceAfter: 750, purchasedAt: "2026-09-12T12:00:00.000Z", idempotent: false } satisfies StorePurchaseResult;
  } } satisfies StorePurchaseRepository);
  const app = buildApp({ env: testEnv, identity, gameState, puzzles, submissions: submissionService, adminAuth, adminSubmissions, leaderboards, submissionReviews, publicProfiles, missions, missionClaims, rewardCatalog, storePurchases, checkDb: async () => {} });
  return { app, gameRepo, puzzleRepo, submissionRepo, videoStorage, adminAuthRepo, adminSubmissionRepo, leaderboardRepo, reviewRepo, publicProfileRepo, missionRepo, missionClaimRepo, purchaseCalls, testEnv };
}

async function login(app: Awaited<ReturnType<typeof appWithFakes>>["app"]) {
  const res = await app.inject({ method: "POST", url: "/api/dev/login" });
  return Array.isArray(res.headers["set-cookie"]) ? res.headers["set-cookie"][0] : res.headers["set-cookie"] ?? "";
}

function adminSubmission(overrides: Partial<AdminSubmissionDto> = {}): AdminSubmissionDto {
  return {
    submissionId: "60000000-0000-4000-8000-000000000001",
    status: "PENDING_REVIEW",
    submittedAt: "2026-01-02T03:04:05.000Z",
    completionTimeMs: 161_000,
    levelId: 22.5,
    puzzleId: "70000000-0000-4000-8000-000000000001",
    puzzleName: "Metamorphosis",
    runCode: "META",
    player: { publicPlayerId: "CZ-8F42KD", displayName: "Smokey_OP" },
    playerPuzzleId: "80000000-0000-4000-8000-000000000001",
    video: {
      videoUploadId: "90000000-0000-4000-8000-000000000001",
      storageProvider: "CLOUDINARY",
      publicId: "circzles/submissions/test-video",
      mimeType: "video/mp4",
      declaredSizeBytes: 1024,
      verifiedSizeBytes: 1024,
      durationMs: 165_000,
      status: "COMPLETE",
      completedAt: "2026-01-02T03:03:00.000Z",
    },
    ...overrides,
  };
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
    const identityRepo = new FakeIdentityRepository();
    const app = buildApp({
      env: testEnv,
      identity: new IdentityService(identityRepo, testEnv.SESSION_SECRET),
      gameState,
      puzzles,
      submissions,
      adminAuth: new AdminAuthorizationService(new FakeAdminAuthorizationRepository(identityRepo), testEnv.SESSION_SECRET),
      adminSubmissions: new AdminSubmissionService(new FakeAdminSubmissionRepository()),
      leaderboards: new LeaderboardService(new FakeLeaderboardRepository()),
      submissionReviews: new SubmissionReviewService(new FakeSubmissionReviewRepository()),
      publicProfiles: new PublicProfileService(new FakePublicProfileRepository()),
      missions: new PlayerMissionService(new FakePlayerMissionRepository()),
      missionClaims: new MissionClaimService(new FakeMissionClaimRepository()),
      rewardCatalog: new RewardCatalogService({ listAvailable: async () => [] }),
      storePurchases: new StorePurchaseService({ purchase: async () => { throw new Error("not used"); } }),
      checkDb: async () => { checked = true; },
    });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(checked).toBe(true);
  });

  it("GET /api/rewards/store requires authentication and returns a safe catalog DTO", async () => {
    const { app } = await appWithFakes({ NODE_ENV: "development" });
    const unauthorized = await app.inject({ method: "GET", url: "/api/rewards/store" });
    expect(unauthorized.statusCode).toBe(401);

    const cookie = await login(app);
    const response = await app.inject({ method: "GET", url: "/api/rewards/store", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({ code: "FRAME_TEST", priceSynapsePoints: 250 });
    expect(response.json().items[0]).not.toHaveProperty("metadata");
  });

  it("POST /api/rewards/store/:listingId/purchase requires auth and derives player from session", async () => {
    const { app, purchaseCalls } = await appWithFakes({ NODE_ENV: "development" });
    const listingId = "10000000-0000-4000-8000-000000000001";
    expect((await app.inject({ method: "POST", url: `/api/rewards/store/${listingId}/purchase`, headers: { "idempotency-key": "buy-1" }, payload: {} })).statusCode).toBe(401);
    const cookie = await login(app);
    const response = await app.inject({ method: "POST", url: `/api/rewards/store/${listingId}/purchase`, headers: { cookie, "idempotency-key": "  buy-1  " }, payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ listingId, priceSynapsePoints: 250, balanceAfter: 750 });
    expect(purchaseCalls[0]).toMatchObject({ listingId, idempotencyKey: "buy-1" });
    expect(purchaseCalls[0].playerId).toBeTruthy();
  });

  it.each([
    ["invalid listing UUID", "/api/rewards/store/not-a-uuid/purchase", { "idempotency-key": "buy-1" }, {}],
    ["missing idempotency key", "/api/rewards/store/10000000-0000-4000-8000-000000000001/purchase", {}, {}],
    ["oversized idempotency key", "/api/rewards/store/10000000-0000-4000-8000-000000000001/purchase", { "idempotency-key": "x".repeat(201) }, {}],
    ["client price", "/api/rewards/store/10000000-0000-4000-8000-000000000001/purchase", { "idempotency-key": "buy-1" }, { priceSynapsePoints: 1 }],
    ["unexpected body data", "/api/rewards/store/10000000-0000-4000-8000-000000000001/purchase", { "idempotency-key": "buy-1" }, { rewardType: "XP" }],
  ])("rejects Store purchase %s", async (_name, url, headers, payload) => {
    const { app } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    const response = await app.inject({ method: "POST", url, headers: { cookie, ...headers }, payload });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("VALIDATION_FAILED");
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

describe("admin review authorization and read API", () => {
  it("maps admin roles to server-side permissions", () => {
    expect(hasAdminPermission("REVIEWER", "SUBMISSIONS_REVIEW")).toBe(true);
    expect(hasAdminPermission("REVIEWER", "COMPETITION_CONFIG")).toBe(false);
    expect(hasAdminPermission("SUPER_ADMIN", "SUBMISSIONS_REVIEW")).toBe(true);
    expect(hasAdminPermission("SUPER_ADMIN", "COMPETITION_CONFIG")).toBe(true);
  });

  it.each([
    "/api/admin/submissions",
    "/api/admin/submissions/60000000-0000-4000-8000-000000000001",
  ])("requires an authenticated session for %s", async (url) => {
    const { app } = await appWithFakes();
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHORIZED");
  });

  it("rejects a valid non-admin player session", async () => {
    const { app } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    const res = await app.inject({ method: "GET", url: "/api/admin/submissions", headers: { cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("rejects an inactive admin", async () => {
    const { app, adminAuthRepo } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    adminAuthRepo.admins.set("user-1", { adminUserId: "50000000-0000-4000-8000-000000000001", role: "REVIEWER", active: false });
    const res = await app.inject({ method: "GET", url: "/api/admin/submissions", headers: { cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("does not accept client-supplied identity as admin authority", async () => {
    const { app } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    const res = await app.inject({ method: "GET", url: "/api/admin/submissions?adminUserId=50000000-0000-4000-8000-000000000001", headers: { cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("allows a reviewer to list pending submissions with deterministic oldest-first ordering", async () => {
    const { app, adminAuthRepo, adminSubmissionRepo } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    adminAuthRepo.admins.set("user-1", { adminUserId: "50000000-0000-4000-8000-000000000001", role: "REVIEWER", active: true });
    adminSubmissionRepo.items.push(
      adminSubmission({ submissionId: "60000000-0000-4000-8000-000000000002", submittedAt: "2026-01-03T00:00:00.000Z" }),
      adminSubmission(),
      adminSubmission({ submissionId: "60000000-0000-4000-8000-000000000003", status: "APPROVED", submittedAt: "2026-01-01T00:00:00.000Z" }),
    );
    const res = await app.inject({ method: "GET", url: "/api/admin/submissions", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((item: AdminSubmissionDto) => item.submissionId)).toEqual([
      "60000000-0000-4000-8000-000000000001",
      "60000000-0000-4000-8000-000000000002",
    ]);
    expect(res.json()[0].levelId).toBe(22.5);
  });

  it("applies status, puzzle, level, and bounded limit filters", async () => {
    const { app, adminAuthRepo, adminSubmissionRepo } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    adminAuthRepo.admins.set("user-1", { adminUserId: "50000000-0000-4000-8000-000000000001", role: "SUPER_ADMIN", active: true });
    adminSubmissionRepo.items.push(
      adminSubmission({ status: "APPROVED" }),
      adminSubmission({ submissionId: "60000000-0000-4000-8000-000000000002", status: "APPROVED", puzzleId: "70000000-0000-4000-8000-000000000002" }),
    );
    const url = "/api/admin/submissions?status=APPROVED&puzzleId=70000000-0000-4000-8000-000000000001&levelId=22.5&limit=1";
    const res = await app.inject({ method: "GET", url, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].submissionId).toBe("60000000-0000-4000-8000-000000000001");
  });

  it("rejects invalid admin queue input and client-selected identity fields", async () => {
    const { app, adminAuthRepo } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    adminAuthRepo.admins.set("user-1", { adminUserId: "50000000-0000-4000-8000-000000000001", role: "REVIEWER", active: true });
    for (const url of [
      "/api/admin/submissions?limit=101",
      "/api/admin/submissions?userId=user-2",
      "/api/admin/submissions/not-a-uuid",
    ]) {
      const res = await app.inject({ method: "GET", url, headers: { cookie } });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    }
  });

  it("returns a reviewer-safe submission detail DTO and a controlled 404", async () => {
    const { app, adminAuthRepo, adminSubmissionRepo } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    adminAuthRepo.admins.set("user-1", { adminUserId: "50000000-0000-4000-8000-000000000001", role: "REVIEWER", active: true });
    adminSubmissionRepo.items.push(adminSubmission());
    const found = await app.inject({ method: "GET", url: "/api/admin/submissions/60000000-0000-4000-8000-000000000001", headers: { cookie } });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({ puzzleName: "Metamorphosis", player: { publicPlayerId: "CZ-8F42KD", displayName: "Smokey_OP" } });
    expect(JSON.stringify(found.json())).not.toContain("wix");
    expect(JSON.stringify(found.json())).not.toContain("email");
    const missing = await app.inject({ method: "GET", url: "/api/admin/submissions/60000000-0000-4000-8000-000000000099", headers: { cookie } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("SUBMISSION_NOT_FOUND");
  });

  it.each(["REVIEWER", "SUPER_ADMIN"] as const)("allows an active %s to submit a trusted review", async (role) => {
    const { app, adminAuthRepo, reviewRepo } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    adminAuthRepo.admins.set("user-1", { adminUserId: "50000000-0000-4000-8000-000000000001", role, active: true });
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/submissions/60000000-0000-4000-8000-000000000001/review",
      headers: { cookie, "idempotency-key": "review-1" },
      payload: { decision: "APPROVED" },
    });
    expect(res.statusCode).toBe(200);
    expect(reviewRepo.calls[0]).toMatchObject({ reviewerAdminUserId: "50000000-0000-4000-8000-000000000001", decision: "APPROVED" });
  });

  it("protects the review route from unauthenticated, ordinary, and inactive users", async () => {
    const { app, adminAuthRepo } = await appWithFakes({ NODE_ENV: "development" });
    const url = "/api/admin/submissions/60000000-0000-4000-8000-000000000001/review";
    expect((await app.inject({ method: "POST", url, headers: { "idempotency-key": "x" }, payload: { decision: "REJECTED" } })).statusCode).toBe(401);
    const cookie = await login(app);
    expect((await app.inject({ method: "POST", url, headers: { cookie, "idempotency-key": "x" }, payload: { decision: "REJECTED" } })).statusCode).toBe(403);
    adminAuthRepo.admins.set("user-1", { adminUserId: "50000000-0000-4000-8000-000000000001", role: "REVIEWER", active: false });
    expect((await app.inject({ method: "POST", url, headers: { cookie, "idempotency-key": "x" }, payload: { decision: "REJECTED" } })).statusCode).toBe(403);
  });

  it("requires review idempotency and rejects invalid or authority-bearing bodies", async () => {
    const { app, adminAuthRepo } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    adminAuthRepo.admins.set("user-1", { adminUserId: "50000000-0000-4000-8000-000000000001", role: "REVIEWER", active: true });
    const url = "/api/admin/submissions/60000000-0000-4000-8000-000000000001/review";
    const requests = [
      { headers: { cookie }, payload: { decision: "APPROVED" } },
      { headers: { cookie, "idempotency-key": "x" }, payload: { decision: "INVALID" } },
      { headers: { cookie, "idempotency-key": "x" }, payload: { decision: "APPROVED", reviewNote: "x".repeat(2001) } },
      { headers: { cookie, "idempotency-key": "x" }, payload: { decision: "APPROVED", playerId: "browser" } },
      { headers: { cookie, "idempotency-key": "x" }, payload: { decision: "APPROVED", reviewerAdminUserId: "browser" } },
      { headers: { cookie, "idempotency-key": "x" }, payload: { decision: "APPROVED", rewardEnabled: true } },
    ];
    for (const request of requests) {
      const res = await app.inject({ method: "POST", url, ...request });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    }
  });

  it("preserves exact replay and rejects mismatched or conflicting reviews", async () => {
    const { app, adminAuthRepo, reviewRepo } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    adminAuthRepo.admins.set("user-1", { adminUserId: "50000000-0000-4000-8000-000000000001", role: "REVIEWER", active: true });
    const url = "/api/admin/submissions/60000000-0000-4000-8000-000000000001/review";
    const request = { method: "POST" as const, url, headers: { cookie, "idempotency-key": "same" }, payload: { decision: "APPROVED" } };
    expect((await app.inject(request)).statusCode).toBe(200);
    expect((await app.inject(request)).json().idempotent).toBe(true);
    expect(reviewRepo.calls).toHaveLength(1);
    const mismatch = await app.inject({ ...request, payload: { decision: "REJECTED" } });
    expect(mismatch.statusCode).toBe(409); expect(mismatch.json().code).toBe("IDEMPOTENCY_CONFLICT");
    const conflict = await app.inject({ ...request, headers: { cookie, "idempotency-key": "new" }, payload: { decision: "REJECTED" } });
    expect(conflict.statusCode).toBe(409); expect(conflict.json().code).toBe("SUBMISSION_ALREADY_REVIEWED");
  });
});

describe("leaderboard HTTP API", () => {
  it("requires player authentication and validates canonical puzzleId", async () => {
    const { app } = await appWithFakes({ NODE_ENV: "development" });
    expect((await app.inject({ method: "GET", url: "/api/leaderboards/catalog" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/leaderboards?puzzleId=70000000-0000-4000-8000-000000000001" })).statusCode).toBe(401);
    const cookie = await login(app);
    expect((await app.inject({ method: "GET", url: "/api/leaderboards?puzzleId=bad", headers: { cookie } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/leaderboards?puzzleId=70000000-0000-4000-8000-000000000001&playerId=browser", headers: { cookie } })).statusCode).toBe(400);
  });

  it("returns safe catalog and leaderboard DTOs from authenticated routes", async () => {
    const { app, leaderboardRepo } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    const puzzle = { puzzleId: "70000000-0000-4000-8000-000000000001", puzzleName: "Metamorphosis", runCode: "R2", levelId: 3.5, category: "SIDE_QUEST" as const };
    leaderboardRepo.catalog.sideQuests.push({ ...puzzle, displayOrder: 2 });
    leaderboardRepo.boards.set(puzzle.puzzleId, { puzzle, entries: [{ rank: 1, publicPlayerId: "CZ-8F42KD", displayName: "Smokey_OP", bestTimeMs: 78_420, bestTime: "01:18.420", isCurrentPlayer: true }], currentPlayerEntry: null });
    const catalog = await app.inject({ method: "GET", url: "/api/leaderboards/catalog", headers: { cookie } });
    expect(catalog.statusCode).toBe(200); expect(catalog.json().sideQuests[0].levelId).toBe(3.5);
    const board = await app.inject({ method: "GET", url: `/api/leaderboards?puzzleId=${puzzle.puzzleId}`, headers: { cookie } });
    expect(board.statusCode).toBe(200); expect(board.json().entries[0]).toMatchObject({ rank: 1, bestTime: "01:18.420", isCurrentPlayer: true });
    const serialized = JSON.stringify(board.json()).toLowerCase();
    for (const forbiddenField of ["\"playerid\":", "email", "wix", "session", "admin"]) expect(serialized).not.toContain(forbiddenField);
  });

  it("returns a controlled 404 for a hidden or unconfigured leaderboard", async () => {
    const { app } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    const res = await app.inject({ method: "GET", url: "/api/leaderboards?puzzleId=70000000-0000-4000-8000-000000000099", headers: { cookie } });
    expect(res.statusCode).toBe(404); expect(res.json().code).toBe("LEADERBOARD_NOT_FOUND");
  });
});

describe("missions HTTP API", () => {
  it("requires authentication and returns safe current-player mission DTOs", async () => {
    const { app, missionRepo } = await appWithFakes();
    expect((await app.inject({ method: "GET", url: "/api/missions" })).statusCode).toBe(401);
    const cookie = await login(app);
    missionRepo.missions.set("player-1", [{ missionId: "mission-1", title: "Daily solves", description: "Complete verified puzzles.", category: "DAILY", periodType: "DAILY", periodKey: "2026-09-09", status: "CLAIMABLE", progress: { current: 3, target: 3 }, claimable: true, startsAt: null, endsAt: null, rewards: [{ type: "XP", amount: 500, label: "500 XP" }] }]);
    const response = await app.inject({ method: "GET", url: "/api/missions", headers: { cookie } });
    expect(response.statusCode).toBe(200); expect(response.json().missions[0]).toMatchObject({ status: "CLAIMABLE", progress: { current: 3, target: 3 }, claimable: true });
    const serialized = JSON.stringify(response.json()).toLowerCase();
    for (const field of ["playerid", "userid", "email", "wix", "session", "admin"]) expect(serialized).not.toContain(field);
  });

  it("secures mission claims and rejects browser authority", async () => {
    const { app, missionClaimRepo } = await appWithFakes(); const missionId = "70000000-0000-4000-8000-000000000001";
    expect((await app.inject({ method: "POST", url: `/api/missions/${missionId}/claim`, headers: { "idempotency-key": "claim-1" } })).statusCode).toBe(401);
    const cookie = await login(app);
    expect((await app.inject({ method: "POST", url: "/api/missions/not-a-uuid/claim", headers: { cookie, "idempotency-key": "claim-1" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/missions/${missionId}/claim`, headers: { cookie } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/missions/${missionId}/claim`, headers: { cookie, "idempotency-key": "claim-1" }, payload: { playerId: "other", xp: 999, periodKey: "fake" } })).statusCode).toBe(400);
    missionClaimRepo.result = { missionClaimId: "claim-1", missionId, periodKey: "2026-09-09", status: "CLAIMED", claimedAt: "2026-09-09T12:00:00.000Z", idempotent: false, awarded: { synapsePoints: 250, xp: 500 }, playerState: { synapsePoints: 250, xp: 500, progressionLevel: 1, rankName: "Peasant" } };
    const response = await app.inject({ method: "POST", url: `/api/missions/${missionId}/claim`, headers: { cookie, "idempotency-key": "claim-1" }, payload: {} });
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ missionId, status: "CLAIMED", awarded: { synapsePoints: 250, xp: 500 } }); expect(missionClaimRepo.calls[0].playerId).toBe("player-1");
  });

  it("returns CLAIMED and non-claimable after claim", async () => {
    const { app, missionRepo } = await appWithFakes(); const cookie = await login(app);
    missionRepo.missions.set("player-1", [{ missionId: "mission-1", title: "Done", description: "Done.", category: "DAILY", periodType: "DAILY", periodKey: "2026-09-09", status: "CLAIMED", progress: { current: 1, target: 1 }, claimable: false, startsAt: null, endsAt: null, rewards: [{ type: "XP", amount: 500, label: "500 XP" }] }]);
    const body = (await app.inject({ method: "GET", url: "/api/missions", headers: { cookie } })).json(); expect(body.missions[0]).toMatchObject({ status: "CLAIMED", claimable: false });
  });

  it("returns no-progress and configured reward previews", async () => {
    const { app, missionRepo } = await appWithFakes(); const cookie = await login(app);
    missionRepo.missions.set("player-1", [{ missionId: "mission-2", title: "Add puzzles", description: "Add two.", category: "WEEKLY", periodType: "WEEKLY", periodKey: "2026-W37", status: "IN_PROGRESS", progress: { current: 0, target: 2 }, claimable: false, startsAt: null, endsAt: null, rewards: [{ type: "SYNAPSE_POINTS", amount: 250, label: "250 Synapse Points" }] }]);
    const body = (await app.inject({ method: "GET", url: "/api/missions", headers: { cookie } })).json(); expect(body.missions[0]).toMatchObject({ progress: { current: 0, target: 2 }, rewards: [{ type: "SYNAPSE_POINTS", amount: 250 }] });
  });
});

describe("public player profile HTTP API", () => {
  it("requires authentication and validates public player ids", async () => {
    const { app } = await appWithFakes({ NODE_ENV: "development" });
    expect((await app.inject({ method: "GET", url: "/api/players/CZ-8F42KD/public-profile" })).statusCode).toBe(401);
    const cookie = await login(app);
    const invalid = await app.inject({ method: "GET", url: "/api/players/not-a-player/public-profile", headers: { cookie } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe("VALIDATION_FAILED");
  });

  it("returns the safe DTO and controlled PLAYER_NOT_FOUND", async () => {
    const { app, publicProfileRepo } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    publicProfileRepo.profiles.set("CZ-8F42KD", {
      publicPlayerId: "CZ-8F42KD",
      displayName: "Smokey_OP",
      progressionRank: "Peasant",
      approvedPuzzlesSolved: 4,
      avatarUrl: null,
      equippedFrame: null,
      displayedBadges: [],
    });
    const found = await app.inject({ method: "GET", url: "/api/players/CZ-8F42KD/public-profile", headers: { cookie } });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toEqual({
      publicPlayerId: "CZ-8F42KD",
      displayName: "Smokey_OP",
      progressionRank: "Peasant",
      approvedPuzzlesSolved: 4,
      avatarUrl: null,
      equippedFrame: null,
      displayedBadges: [],
    });
    const responseKeys = Object.keys(found.json());
    for (const privateField of ["internalId", "playerId", "userId", "email", "wixMemberId", "session", "admin", "xp", "synapsePoints"]) expect(responseKeys).not.toContain(privateField);

    const missing = await app.inject({ method: "GET", url: "/api/players/CZ-AAAAAA/public-profile", headers: { cookie } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("PLAYER_NOT_FOUND");
  });
});
