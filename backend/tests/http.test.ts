import { NativeAuthService } from "../src/domain/nativeAuth.js";
import { GoogleAuthService } from "../src/domain/googleAuth.js";
import type { NativeAuthRepository } from "../src/domain/nativeAuthRepository.js";
import { DevelopmentAuthMailer } from "../src/domain/authEmail.js";
import { authToken } from "../src/domain/authSecurity.js";
import { describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";
import { buildApp } from "../src/http/app.js";
import { AppError } from "../src/domain/errors.js";
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
import { InventoryService } from "../src/domain/inventory.js";
import { PlayerIdentityActionService, type PlayerIdentityActionRepository, type RenameDisplayNameInput } from "../src/domain/playerIdentityActions.js";
import { RewardWheelService, type RewardWheelRepository, type RewardWheelSpinInput } from "../src/domain/rewardWheel.js";
import { CouponService, type CouponDto } from "../src/domain/coupons.js";
import { FakeAdminAuthorizationRepository, FakeAdminSubmissionRepository, FakeGameStateRepository, FakeIdentityRepository, FakeLeaderboardRepository, FakeMissionClaimRepository, FakePlayerMissionRepository, FakePublicProfileRepository, FakePuzzleRepository, FakeSubmissionRepository, FakeSubmissionReviewRepository, FakeVideoStorage } from "./fakes.js";
import type { Env } from "../src/config/env.js";
import type { DirectAuthProvider } from "../src/domain/directAuth.js";

function env(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: "test",
    PORT: 4000,
    DATABASE_URL: "postgres://example",
    FRONTEND_ORIGIN: "http://localhost:3000",
    SESSION_SECRET: "test-session-secret-with-at-least-32-chars",
    COOKIE_SECURE: false,
    SESSION_COOKIE_SAME_SITE: "lax",
    AUTH_SESSION_DIAGNOSTICS: false,
    MISSION_PROCESSOR_INTERVAL_MS: 5000,
    MISSION_PROCESSOR_BATCH_SIZE: 50,
    ...overrides,
  };
}

async function appWithFakes(overrides: Partial<Env> = {}, directAuth?: DirectAuthProvider, native?: { nativeAuth: NativeAuthService; googleAuth: GoogleAuthService }) {
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
  const catalogItems: StoreCatalogItemDto[] = [{ listingId: "10000000-0000-4000-8000-000000000001", rewardDefinitionId: "20000000-0000-4000-8000-000000000001", code: "FRAME_TEST", rewardType: "FRAME", name: "Test Frame", description: "Test catalog item.", imageUrl: null, rarity: "RARE", priceSynapsePoints: 250, featured: true, displayOrder: 1, purchaseLimit: null, ownedQuantity: 0, alreadyOwned: false, purchaseCount: 0, remainingPurchases: null, canPurchase: true }];
  const rewardCatalog = new RewardCatalogService({ listAvailable: async () => catalogItems } satisfies RewardCatalogRepository);
  const purchaseCalls: Array<{ playerId: string; listingId: string; idempotencyKey: string }> = [];
  const storePurchases = new StorePurchaseService({ purchase: async (input) => {
    purchaseCalls.push(input);
    return { purchaseId: "30000000-0000-4000-8000-000000000001", listingId: input.listingId, reward: { rewardDefinitionId: catalogItems[0].rewardDefinitionId, code: "FRAME_TEST", rewardType: "FRAME", name: "Test Frame", imageUrl: null, rarity: "RARE" }, priceSynapsePoints: 250, balanceAfter: 750, purchasedAt: "2026-09-12T12:00:00.000Z", idempotent: false } satisfies StorePurchaseResult;
  } } satisfies StorePurchaseRepository);
  const emptyInventory = { items: [], equipment: {} };
  const inventoryCalls: string[] = [];
  const inventory = new InventoryService({ list: async (playerId) => { inventoryCalls.push(`list:${playerId}`); return emptyInventory; }, equip: async (playerId, itemId, slot) => { inventoryCalls.push(`equip:${playerId}:${itemId}:${slot}`); return emptyInventory; }, unequip: async (playerId, slot) => { inventoryCalls.push(`unequip:${playerId}:${slot}`); return emptyInventory; } });
  const couponCalls: string[] = [];
  const couponRows: CouponDto[] = [{ couponOwnershipId: "70000000-0000-4000-8000-000000000001", couponCode: "CZ1234567890ABCDEF", rewardDefinitionId: "20000000-0000-4000-8000-000000000002", rewardCode: "COUPON_TEST", name: "Test Coupon", description: "A test coupon.", imageUrl: null, rarity: "RARE", status: "ACTIVE", issuedAt: "2026-09-17T00:00:00.000Z", expiresAt: null, displayMetadata: { discountLabel: "10% off" } }];
  const coupons = new CouponService({ list: async (playerId) => { couponCalls.push(playerId); return couponRows; } });
  const renameCalls: RenameDisplayNameInput[] = [];
  const playerIdentityActions = new PlayerIdentityActionService({ renameDisplayName: async (input) => {
    renameCalls.push(input);
    const account = identityRepo.accounts.find((item) => item.player.internalId === input.playerId);
    if (!account) throw new Error("missing player");
    const previousDisplayName = account.player.displayName; account.player.displayName = input.displayName;
    const publicProfile = publicProfileRepo.profiles.get(account.player.publicPlayerId);
    if (publicProfile) publicProfile.displayName = input.displayName;
    return { inventoryConsumptionId: "50000000-0000-4000-8000-000000000001", publicPlayerId: account.player.publicPlayerId, previousDisplayName, displayName: input.displayName, inventoryItemId: input.inventoryItemId, remainingQuantity: 0, consumedAt: "2026-09-16T00:00:00.000Z", idempotent: false, inventory: emptyInventory };
  } } satisfies PlayerIdentityActionRepository);
  const wheelSpinCalls: RewardWheelSpinInput[] = [];
  const rewardWheel = new RewardWheelService({
    getStatus: async () => ({ available: true, wheel: { code: "DEV_WHEEL", name: "Development Wheel", cycleSeconds: 86400, cycleStartedAt: null, cycleEndsAt: null, spinsUsed: 0, maxSpinsPerCycle: 4, spinsRemaining: 4, nextSpinNumber: 1, nextSpinCostSynapsePoints: 0, nextSpinIsFree: true, canAffordNextSpin: true, canSpin: true, unavailableReason: null, segments: [{ wheelSegmentIndex: 4, label: "100 SP", rewardType: "SYNAPSE_POINTS", rewardValue: 100, imageUrl: null, rarity: null, displayMetadata: { tone: "aqua" } }] } }),
    spin: async (input) => { wheelSpinCalls.push(input); return { spinId: "60000000-0000-4000-8000-000000000001", rewardId: "20000000-0000-4000-8000-000000000001", rewardDefinitionId: "20000000-0000-4000-8000-000000000001", rewardType: "SYNAPSE_POINTS", rewardLabel: "100 SP", rewardValue: 100, resultingBalance: 1050, wheelSegmentIndex: 4, spunAt: "2026-09-16T12:00:00.000Z", spinNumber: 1, chargedSynapsePoints: 0, cycleStartedAt: "2026-09-16T12:00:00.000Z", cycleEndsAt: "2026-09-17T12:00:00.000Z", idempotent: false }; },
  } satisfies RewardWheelRepository);
  const app = buildApp({ env: testEnv, identity, gameState, puzzles, submissions: submissionService, adminAuth, adminSubmissions, leaderboards, submissionReviews, publicProfiles, missions, missionClaims, rewardCatalog, storePurchases, inventory, coupons, playerIdentityActions, rewardWheel, directAuth, ...native, checkDb: async () => {} });
  return { app, identity, identityRepo, gameRepo, puzzleRepo, submissionRepo, videoStorage, adminAuthRepo, adminSubmissionRepo, leaderboardRepo, reviewRepo, publicProfileRepo, missionRepo, missionClaimRepo, purchaseCalls, inventoryCalls, couponCalls, renameCalls, wheelSpinCalls, testEnv };
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

  it("exchanges signed Wix-site handoffs, links verified email, and rejects client impersonation fields", async () => {
    const comSecret = "com-handoff-secret-with-at-least-32-characters";
    const inSecret = "in-handoff-secret-with-at-least-32-characters";
    const { app, identityRepo } = await appWithFakes({ AUTH_HANDOFF_CIRCZLES_COM_SECRET: comSecret, AUTH_HANDOFF_CIRCZLES_IN_SECRET: inSecret });
    const comToken = signHandoff({ iss: "circzles.com", sub: "com-member", email: "player@example.com", jti: "http-handoff-com-001" }, comSecret);
    const first = await app.inject({ method: "POST", url: "/api/auth/handoff/exchange", payload: { token: comToken } });
    expect(first.statusCode).toBe(200);
    const inToken = signHandoff({ iss: "circzles.in", sub: "in-member", email: "player@example.com", jti: "http-handoff-in-0001" }, inSecret);
    const second = await app.inject({ method: "POST", url: "/api/auth/handoff/exchange", payload: { token: inToken } });
    expect(second.statusCode).toBe(200);
    expect(second.json().internalId).toBe(first.json().internalId);
    expect(identityRepo.accounts).toHaveLength(1);

    const rejected = await app.inject({ method: "POST", url: "/api/auth/handoff/exchange", payload: { token: signHandoff({ iss: "circzles.com", sub: "attacker", email: "attacker@example.com", jti: "http-handoff-fake-01" }, comSecret), wixMemberId: "com-member", playerId: first.json().internalId } });
    expect(rejected.statusCode).toBe(400);
    expect(identityRepo.accounts).toHaveLength(1);
  });

  it("sets a production-grade host-only cz_session cookie on a successful handoff exchange", async () => {
    const comSecret = "com-handoff-secret-with-at-least-32-characters";
    const { app } = await appWithFakes({ NODE_ENV: "production", COOKIE_SECURE: true, AUTH_HANDOFF_CIRCZLES_COM_SECRET: comSecret });
    const res = await app.inject({ method: "POST", url: "/api/auth/handoff/exchange", payload: { token: signHandoff({ iss: "circzles.com", sub: "cookie-member", email: "cookie@example.com", jti: "http-handoff-cookie-1" }, comSecret) } });
    expect(res.statusCode).toBe(200);
    const raw = res.headers["set-cookie"];
    const cookie = Array.isArray(raw) ? raw[0] : raw ?? "";
    expect(cookie).toMatch(/^cz_session=[^;]+/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toMatch(/Domain=/i);
    const session = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: cookie.split(";")[0] } });
    expect(session.statusCode).toBe(200);
    expect(session.json().internalId).toBe(res.json().internalId);
  });

  it("refuses to replay a handoff and issues no cookie the second time", async () => {
    const comSecret = "com-handoff-secret-with-at-least-32-characters";
    const { app, identityRepo } = await appWithFakes({ AUTH_HANDOFF_CIRCZLES_COM_SECRET: comSecret });
    const token = signHandoff({ iss: "circzles.com", sub: "replay-member", email: "replay@example.com", jti: "http-handoff-replay-1" }, comSecret);
    expect((await app.inject({ method: "POST", url: "/api/auth/handoff/exchange", payload: { token } })).statusCode).toBe(200);
    const replay = await app.inject({ method: "POST", url: "/api/auth/handoff/exchange", payload: { token } });
    expect(replay.statusCode).toBe(409);
    expect(replay.json().code).toBe("AUTH_HANDOFF_ALREADY_USED");
    expect(replay.headers["set-cookie"]).toBeUndefined();
    expect(identityRepo.accounts).toHaveLength(1);
  });

  it("rejects a handoff whose Wix member now presents a different verified email", async () => {
    const comSecret = "com-handoff-secret-with-at-least-32-characters";
    const { app, identityRepo } = await appWithFakes({ AUTH_HANDOFF_CIRCZLES_COM_SECRET: comSecret });
    expect((await app.inject({ method: "POST", url: "/api/auth/handoff/exchange", payload: { token: signHandoff({ iss: "circzles.com", sub: "same-member", email: "first@example.com", jti: "http-handoff-conflict-1" }, comSecret) } })).statusCode).toBe(200);
    const conflict = await app.inject({ method: "POST", url: "/api/auth/handoff/exchange", payload: { token: signHandoff({ iss: "circzles.com", sub: "same-member", email: "other@example.com", jti: "http-handoff-conflict-2" }, comSecret) } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe("IDENTITY_LINK_CONFLICT");
    expect(conflict.headers["set-cookie"]).toBeUndefined();
    expect(identityRepo.accounts).toHaveLength(1);
  });

  it("does not authenticate from a raw member id, email, or an unsigned/forged token", async () => {
    const comSecret = "com-handoff-secret-with-at-least-32-characters";
    const { app, identityRepo } = await appWithFakes({ AUTH_HANDOFF_CIRCZLES_COM_SECRET: comSecret });
    const raw = await app.inject({ method: "POST", url: "/api/auth/handoff/exchange", payload: { wixMemberId: "com-member", email: "victim@example.com" } });
    expect(raw.statusCode).toBe(400);
    const forged = await app.inject({ method: "POST", url: "/api/auth/handoff/exchange", payload: { token: signHandoff({ iss: "circzles.com", sub: "forged", email: "victim@example.com", jti: "http-handoff-forged-1" }, "f".repeat(40)) } });
    expect(forged.statusCode).toBe(401);
    expect(forged.json().code).toBe("AUTH_HANDOFF_INVALID");
    expect(forged.headers["set-cookie"]).toBeUndefined();
    expect(identityRepo.accounts).toHaveLength(0);
  });

  it("bootstraps a persistent session and logout invalidates it", async () => {
    const { app, gameRepo } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    gameRepo.ensureCalls.length = 0;
    const session = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } });
    expect(session.statusCode).toBe(200);
    expect(session.headers["set-cookie"]).toBeDefined();
    expect(session.json()).toMatchObject({
      internalId: expect.any(String),
      publicPlayerId: "CZ-8F42KD",
      displayName: "Smokey_OP",
      avatar: "/brand/avatar.svg",
    });
    expect(session.json()).not.toHaveProperty("progressionLevel");
    expect(session.json()).not.toHaveProperty("xp");
    expect(session.json()).not.toHaveProperty("synapsePoints");
    expect(gameRepo.ensureCalls).toEqual([]);
    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(logout.statusCode).toBe(200);
    expect(logout.headers["set-cookie"]).toContain("cz_session=;");
    const after = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it("clears the browser cookie even when session revocation fails", async () => {
    const { app, identity } = await appWithFakes();
    vi.spyOn(identity, "logout").mockRejectedValueOnce(new Error("database unavailable"));
    const response = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: "cz_session=stale" } });
    expect(response.statusCode).toBe(500);
    expect(response.headers["set-cookie"]).toContain("cz_session=;");
    expect(response.json()).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("rejects an invalid session without touching gameplay state", async () => {
    const { app, gameRepo } = await appWithFakes();
    const response = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: "cz_session=invalid" } });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("UNAUTHORIZED");
    expect(gameRepo.ensureCalls).toEqual([]);
  });

  it("keeps direct authentication fail-closed until a real provider adapter is configured", async () => {
    const { app } = await appWithFakes();
    const response = await app.inject({ method: "POST", url: "/api/auth/direct/email/login", payload: { email: "player@example.com", password: "strong-password" } });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe("DIRECT_AUTH_PROVIDER_NOT_CONFIGURED");
  });

  it("creates a session only after the direct provider callback returns a verified canonical identity", async () => {
    const verified = { sourceSite: "CIRCZLES_COM" as const, provider: "EMAIL" as const, externalIdentityId: "canonical-member", verifiedEmail: "player@example.com", emailVerified: true as const, displayName: "Verified Player" };
    const directAuth: DirectAuthProvider = {
      loginWithEmail: async () => ({ authorizationUrl: "https://identity.example.test/email" }),
      startEmailSignup: async () => ({ state: "EMAIL_VERIFICATION_REQUIRED", challengeId: "challenge" }),
      verifyEmailSignup: async () => ({ authorizationUrl: "https://identity.example.test/verify" }),
      getGoogleAuthorizationUrl: async () => ({ authorizationUrl: "https://identity.example.test/start" }),
      completeAuthorization: async () => ({ identity: verified, returnTo: "/hub" }),
    };
    const { app } = await appWithFakes({}, directAuth);
    const response = await app.inject({ method: "POST", url: "/api/auth/direct/email/login", payload: { email: "player@example.com", password: "strong-password" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authorizationUrl: "https://identity.example.test/email" });
    expect(response.headers["set-cookie"]).toBeUndefined();
    const callback = await app.inject({ method: "GET", url: "/api/auth/direct/google/callback?code=code&state=state" });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("http://localhost:3000/hub");
    expect(callback.headers["set-cookie"]).toContain("HttpOnly");

    const wrongSite: DirectAuthProvider = { ...directAuth, completeAuthorization: async () => ({ identity: { ...verified, sourceSite: "CIRCZLES_IN" }, returnTo: "/hub" }) };
    const other = await appWithFakes({}, wrongSite);
    const rejected = await other.app.inject({ method: "GET", url: "/api/auth/direct/google/callback?code=code&state=state" });
    expect(rejected.statusCode).toBe(502);
    expect(rejected.json().code).toBe("DIRECT_AUTH_IDENTITY_INVALID");
  });

  it("accepts a strict Wix error callback without creating a Player Hub session", async () => {
    let receivedCallback: unknown;
    const directAuth: DirectAuthProvider = {
      loginWithEmail: async () => ({ authorizationUrl: "https://identity.example.test/email" }),
      startEmailSignup: async () => ({ state: "EMAIL_VERIFICATION_REQUIRED", challengeId: "challenge" }),
      verifyEmailSignup: async () => ({ authorizationUrl: "https://identity.example.test/verify" }),
      getGoogleAuthorizationUrl: async () => ({ authorizationUrl: "https://identity.example.test/start" }),
      completeAuthorization: async (input) => {
        receivedCallback = input;
        throw new AppError("WIX_AUTHORIZATION_FAILED", "Wix authentication could not be completed.", 502);
      },
    };
    const { app, identityRepo, gameRepo } = await appWithFakes({}, directAuth);
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/direct/google/callback",
      payload: { error: "unknown_error", errorDescription: "provider detail", state: "signed-state" },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ code: "WIX_AUTHORIZATION_FAILED", requestId: expect.any(String) });
    expect(receivedCallback).toEqual({ error: "unknown_error", errorDescription: "provider detail", state: "signed-state" });
    expect(identityRepo.accounts).toHaveLength(0);
    expect(gameRepo.ensureCalls).toEqual([]);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("completes a posted Wix callback and returns only a safe local destination", async () => {
    const verified = { sourceSite: "CIRCZLES_COM" as const, provider: "GOOGLE" as const, externalIdentityId: "canonical-google-member", verifiedEmail: "player@example.com", emailVerified: true as const, displayName: "Verified Player" };
    let receivedCallback: unknown;
    const directAuth: DirectAuthProvider = {
      loginWithEmail: async () => ({ authorizationUrl: "https://identity.example.test/email" }),
      startEmailSignup: async () => ({ state: "EMAIL_VERIFICATION_REQUIRED", challengeId: "challenge" }),
      verifyEmailSignup: async () => ({ authorizationUrl: "https://identity.example.test/verify" }),
      getGoogleAuthorizationUrl: async () => ({ authorizationUrl: "https://identity.example.test/start" }),
      completeAuthorization: async (input) => {
        receivedCallback = input;
        return { identity: verified, returnTo: "/missions" };
      },
    };
    const { app } = await appWithFakes({}, directAuth);
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/direct/google/callback",
      payload: { code: "authorization-code", state: "signed-state" },
    });

    expect(response.statusCode).toBe(200);
    expect(receivedCallback).toEqual({ code: "authorization-code", state: "signed-state" });
    expect(response.json()).toEqual({ returnTo: "/missions" });
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.body).not.toMatch(/access|refresh|member-token|codeVerifier/i);
  });

  it("accepts a hosted-login WIX identity and rejects providers the direct callback cannot produce", async () => {
    const base = { sourceSite: "CIRCZLES_COM" as const, externalIdentityId: "hosted-member", verifiedEmail: "player@example.com", emailVerified: true as const, displayName: "Verified Player" };
    const providerFor = (provider: "WIX" | "FACEBOOK"): DirectAuthProvider => ({
      loginWithEmail: async () => ({ authorizationUrl: "https://identity.example.test/email" }),
      startEmailSignup: async () => ({ state: "EMAIL_VERIFICATION_REQUIRED", challengeId: "challenge" }),
      verifyEmailSignup: async () => ({ authorizationUrl: "https://identity.example.test/verify" }),
      getGoogleAuthorizationUrl: async () => ({ authorizationUrl: "https://identity.example.test/start" }),
      completeAuthorization: async () => ({ identity: { ...base, provider }, returnTo: "/hub" }),
    });

    const accepted = await appWithFakes({}, providerFor("WIX"));
    const ok = await accepted.app.inject({ method: "POST", url: "/api/auth/direct/google/callback", payload: { code: "code", state: "state" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ returnTo: "/hub" });
    expect(ok.headers["set-cookie"]).toContain("HttpOnly");

    const rejected = await appWithFakes({}, providerFor("FACEBOOK"));
    const bad = await rejected.app.inject({ method: "POST", url: "/api/auth/direct/google/callback", payload: { code: "code", state: "state" } });
    expect(bad.statusCode).toBe(502);
    expect(bad.json().code).toBe("DIRECT_AUTH_IDENTITY_INVALID");
    expect(bad.headers["set-cookie"]).toBeUndefined();
  });

  it("constrains a provider return destination before returning it to the browser", async () => {
    const verified = { sourceSite: "CIRCZLES_COM" as const, provider: "GOOGLE" as const, externalIdentityId: "canonical-google-member", verifiedEmail: "player@example.com", emailVerified: true as const, displayName: "Verified Player" };
    const directAuth: DirectAuthProvider = {
      loginWithEmail: async () => ({ authorizationUrl: "https://identity.example.test/email" }),
      startEmailSignup: async () => ({ state: "EMAIL_VERIFICATION_REQUIRED", challengeId: "challenge" }),
      verifyEmailSignup: async () => ({ authorizationUrl: "https://identity.example.test/verify" }),
      getGoogleAuthorizationUrl: async () => ({ authorizationUrl: "https://identity.example.test/start" }),
      completeAuthorization: async () => ({ identity: verified, returnTo: "//attacker.example" }),
    };
    const { app } = await appWithFakes({}, directAuth);
    const response = await app.inject({ method: "POST", url: "/api/auth/direct/google/callback", payload: { code: "code", state: "state" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ returnTo: "/hub" });
  });

  it.each([
    {},
    { code: "code" },
    { error: "unknown_error", state: "state", unexpected: "value" },
    { code: "code", error: "unknown_error", state: "state" },
  ])("rejects malformed posted Wix callbacks without invoking the provider", async (payload) => {
    let callbackCalls = 0;
    const directAuth: DirectAuthProvider = {
      loginWithEmail: async () => ({ authorizationUrl: "https://identity.example.test/email" }),
      startEmailSignup: async () => ({ state: "EMAIL_VERIFICATION_REQUIRED", challengeId: "challenge" }),
      verifyEmailSignup: async () => ({ authorizationUrl: "https://identity.example.test/verify" }),
      getGoogleAuthorizationUrl: async () => ({ authorizationUrl: "https://identity.example.test/start" }),
      completeAuthorization: async () => {
        callbackCalls += 1;
        throw new Error("Not called");
      },
    };
    const { app } = await appWithFakes({}, directAuth);
    const response = await app.inject({ method: "POST", url: "/api/auth/direct/google/callback", payload });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("VALIDATION_FAILED");
    expect(callbackCalls).toBe(0);
  });

  it.each([
    "/api/auth/direct/google/callback",
    "/api/auth/direct/google/callback?code=code",
    "/api/auth/direct/google/callback?error=unknown_error",
    "/api/auth/direct/google/callback?state=state",
    "/api/auth/direct/google/callback?code=code&error=unknown_error&state=state",
    "/api/auth/direct/google/callback?error=unknown_error&state=state&unexpected=value",
  ])("rejects malformed or ambiguous Wix callbacks without invoking the provider: %s", async (url) => {
    let callbackCalls = 0;
    const directAuth: DirectAuthProvider = {
      loginWithEmail: async () => ({ authorizationUrl: "https://identity.example.test/email" }),
      startEmailSignup: async () => ({ state: "EMAIL_VERIFICATION_REQUIRED", challengeId: "challenge" }),
      verifyEmailSignup: async () => ({ authorizationUrl: "https://identity.example.test/verify" }),
      getGoogleAuthorizationUrl: async () => ({ authorizationUrl: "https://identity.example.test/start" }),
      completeAuthorization: async () => {
        callbackCalls += 1;
        throw new Error("Not called");
      },
    };
    const { app } = await appWithFakes({}, directAuth);
    const response = await app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("VALIDATION_FAILED");
    expect(callbackCalls).toBe(0);
  });

  it.each(["EMAIL", "GOOGLE"] as const)("issues a host-only production cookie that survives the %s GET callback-to-session chain", async (provider) => {
    const verified = { sourceSite: "CIRCZLES_COM" as const, provider, externalIdentityId: "canonical-member", verifiedEmail: "player@example.com", emailVerified: true as const, displayName: "Verified Player" };
    const directAuth: DirectAuthProvider = {
      loginWithEmail: async () => ({ authorizationUrl: "https://identity.example.test/email" }),
      startEmailSignup: async () => ({ state: "EMAIL_VERIFICATION_REQUIRED", challengeId: "challenge" }),
      verifyEmailSignup: async () => ({ authorizationUrl: "https://identity.example.test/verify" }),
      getGoogleAuthorizationUrl: async () => ({ authorizationUrl: "https://identity.example.test/start" }),
      completeAuthorization: async () => ({ identity: verified, returnTo: "/hub" }),
    };
    const { app } = await appWithFakes({
      NODE_ENV: "production",
      FRONTEND_ORIGIN: "https://circzles-player-hub.vercel.app",
      COOKIE_SECURE: true,
      SESSION_COOKIE_DOMAIN: undefined,
      SESSION_COOKIE_SAME_SITE: "lax",
    }, directAuth);
    const callback = await app.inject({ method: "GET", url: "/api/auth/direct/google/callback?code=code&state=state", headers: { origin: "https://circzles-player-hub.vercel.app" } });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("https://circzles-player-hub.vercel.app/hub");
    const setCookie = Array.isArray(callback.headers["set-cookie"]) ? callback.headers["set-cookie"][0] : callback.headers["set-cookie"] ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toMatch(/(?:^|;)\s*Domain=/i);

    const sessionCookie = setCookie.split(";", 1)[0];
    const session = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: sessionCookie, origin: "https://circzles-player-hub.vercel.app" } });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ publicPlayerId: expect.stringMatching(/^CZ-/), displayName: "Verified Player" });
    expect(session.headers["set-cookie"]).toContain("SameSite=Lax");
  });

  it("returns an email-verification challenge without creating a Player Hub session", async () => {
    const directAuth: DirectAuthProvider = {
      loginWithEmail: async () => ({ state: "EMAIL_VERIFICATION_REQUIRED", challengeId: "sealed-challenge", expiresAt: "2026-09-26T12:00:00.000Z" }),
      startEmailSignup: async () => ({ state: "EMAIL_VERIFICATION_REQUIRED", challengeId: "challenge" }),
      verifyEmailSignup: async () => ({ authorizationUrl: "https://identity.example.test/verify" }),
      getGoogleAuthorizationUrl: async () => ({ authorizationUrl: "https://identity.example.test/start" }),
      completeAuthorization: async () => { throw new Error("Not called"); },
    };
    const { app } = await appWithFakes({}, directAuth);
    const response = await app.inject({ method: "POST", url: "/api/auth/direct/email/login", payload: { email: "player@example.com", password: "strong-password" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ state: "EMAIL_VERIFICATION_REQUIRED", challengeId: "sealed-challenge", expiresAt: "2026-09-26T12:00:00.000Z" });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("returns either the immediate signup redirect or an email-verification challenge", async () => {
    let receivedReturnTo = "";
    const directRedirect: DirectAuthProvider = {
      loginWithEmail: async () => ({ authorizationUrl: "https://identity.example.test/email" }),
      startEmailSignup: async (input) => { receivedReturnTo = input.returnTo; return { authorizationUrl: "https://identity.example.test/signup" }; },
      verifyEmailSignup: async () => ({ authorizationUrl: "https://identity.example.test/verify" }),
      getGoogleAuthorizationUrl: async () => ({ authorizationUrl: "https://identity.example.test/start" }),
      completeAuthorization: async () => { throw new Error("Not called"); },
    };
    const immediate = await appWithFakes({}, directRedirect);
    const redirectResponse = await immediate.app.inject({ method: "POST", url: "/api/auth/direct/email/signup", payload: { displayName: "Puzzle Player", email: "player@example.com", password: "strong-password", returnTo: "/missions" } });
    expect(redirectResponse.statusCode).toBe(200);
    expect(redirectResponse.json()).toEqual({ authorizationUrl: "https://identity.example.test/signup" });
    expect(receivedReturnTo).toBe("/missions");
    expect(redirectResponse.headers["set-cookie"]).toBeUndefined();

    const directChallenge: DirectAuthProvider = {
      ...directRedirect,
      startEmailSignup: async () => ({ state: "EMAIL_VERIFICATION_REQUIRED", challengeId: "sealed-challenge", expiresAt: "2026-09-28T12:00:00.000Z" }),
    };
    const verification = await appWithFakes({}, directChallenge);
    const challengeResponse = await verification.app.inject({ method: "POST", url: "/api/auth/direct/email/signup", payload: { displayName: "Puzzle Player", email: "player@example.com", password: "strong-password" } });
    expect(challengeResponse.statusCode).toBe(202);
    expect(challengeResponse.json()).toEqual({ state: "EMAIL_VERIFICATION_REQUIRED", challengeId: "sealed-challenge", expiresAt: "2026-09-28T12:00:00.000Z" });
  });

  it("rejects backslash return paths before direct-auth redirects", async () => {
    let receivedReturnTo = "";
    const verified = { sourceSite: "CIRCZLES_COM" as const, provider: "EMAIL" as const, externalIdentityId: "canonical-member", verifiedEmail: "player@example.com", emailVerified: true as const, displayName: "Verified Player" };
    const directAuth: DirectAuthProvider = {
      loginWithEmail: async (input) => { receivedReturnTo = input.returnTo; return { authorizationUrl: "https://identity.example.test/email" }; },
      startEmailSignup: async () => ({ state: "EMAIL_VERIFICATION_REQUIRED", challengeId: "challenge" }),
      verifyEmailSignup: async () => ({ authorizationUrl: "https://identity.example.test/verify" }),
      getGoogleAuthorizationUrl: async () => ({ authorizationUrl: "https://identity.example.test/start" }),
      completeAuthorization: async () => ({ identity: verified, returnTo: "/hub" }),
    };
    const { app } = await appWithFakes({}, directAuth);
    const response = await app.inject({ method: "POST", url: "/api/auth/direct/email/login", payload: { email: "player@example.com", password: "strong-password", returnTo: "/\\attacker.example" } });
    expect(response.statusCode).toBe(200);
    expect(receivedReturnTo).toBe("/hub");
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
      inventory: new InventoryService({ list: async () => ({ items: [], equipment: {} }), equip: async () => ({ items: [], equipment: {} }), unequip: async () => ({ items: [], equipment: {} }) }),
      coupons: new CouponService({ list: async () => [] }),
      playerIdentityActions: new PlayerIdentityActionService({ renameDisplayName: async () => { throw new Error("not used"); } }),
      rewardWheel: new RewardWheelService({ getStatus: async () => ({ available: false, wheel: null }), spin: async () => { throw new Error("not used"); } }),
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

  it("GET /api/wheel requires authentication and returns only safe presentation data", async () => {
    const { app } = await appWithFakes({ NODE_ENV: "development" });
    expect((await app.inject({ method: "GET", url: "/api/wheel" })).statusCode).toBe(401);
    const response = await app.inject({ method: "GET", url: "/api/wheel", headers: { cookie: await login(app) } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ available: true, wheel: { code: "DEV_WHEEL", canSpin: true, segments: [{ wheelSegmentIndex: 4, rewardType: "SYNAPSE_POINTS", rewardValue: 100 }] } });
    expect(JSON.stringify(response.json())).not.toContain("weight");
    expect(JSON.stringify(response.json())).not.toContain("probability");
  });

  it("POST /api/wheel/spin requires auth, derives the player, and normalizes Idempotency-Key", async () => {
    const { app, wheelSpinCalls } = await appWithFakes({ NODE_ENV: "development" });
    expect((await app.inject({ method: "POST", url: "/api/wheel/spin", headers: { "idempotency-key": "spin-1" }, payload: {} })).statusCode).toBe(401);
    const response = await app.inject({ method: "POST", url: "/api/wheel/spin", headers: { cookie: await login(app), "idempotency-key": "  spin-1  " }, payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ spinId: expect.any(String), rewardType: "SYNAPSE_POINTS", resultingBalance: 1050, wheelSegmentIndex: 4, idempotent: false });
    expect(wheelSpinCalls).toHaveLength(1);
    expect(wheelSpinCalls[0]).toMatchObject({ playerId: expect.any(String), idempotencyKey: "spin-1" });
  });

  it.each([
    ["missing idempotency key", {}, {}],
    ["oversized idempotency key", { "idempotency-key": "x".repeat(201) }, {}],
    ["null body", { "idempotency-key": "spin-1", "content-type": "application/json" }, "null"],
    ["client reward authority", { "idempotency-key": "spin-1" }, { rewardValue: 9999 }],
    ["client segment authority", { "idempotency-key": "spin-1" }, { wheelSegmentIndex: 0 }],
  ])("rejects Reward Wheel spin with %s", async (_label, headers, payload) => {
    const { app, wheelSpinCalls } = await appWithFakes({ NODE_ENV: "development" });
    const response = await app.inject({ method: "POST", url: "/api/wheel/spin", headers: { cookie: await login(app), ...headers }, payload });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("VALIDATION_FAILED");
    expect(wheelSpinCalls).toHaveLength(0);
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

  it("Inventory endpoints require auth, derive player identity, and validate slots", async () => {
    const { app, inventoryCalls } = await appWithFakes({ NODE_ENV: "development" });
    expect((await app.inject({ method: "GET", url: "/api/me/inventory" })).statusCode).toBe(401);
    const cookie = await login(app); const itemId = "40000000-0000-4000-8000-000000000001";
    expect((await app.inject({ method: "GET", url: "/api/me/inventory", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/me/inventory/${itemId}/equip`, headers: { cookie }, payload: { slot: "FRAME" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: "/api/me/equipment/FRAME", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/me/inventory/${itemId}/equip`, headers: { cookie }, payload: { slot: "WRONG" } })).statusCode).toBe(400);
    expect(inventoryCalls.some((call) => call.startsWith("equip:"))).toBe(true); expect(inventoryCalls.some((call) => call.startsWith("unequip:"))).toBe(true);
  });

  it("Coupon listing requires auth and derives player identity from the session", async () => {
    const { app, couponCalls } = await appWithFakes({ NODE_ENV: "development" });
    expect((await app.inject({ method: "GET", url: "/api/me/coupons" })).statusCode).toBe(401);

    const cookie = await login(app);
    const response = await app.inject({ method: "GET", url: "/api/me/coupons", headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ coupons: [expect.objectContaining({ couponCode: "CZ1234567890ABCDEF", rewardCode: "COUPON_TEST", status: "ACTIVE" })] });
    expect(response.json().coupons[0]).not.toHaveProperty("idempotencyKey");
    expect(response.json().coupons[0]).not.toHaveProperty("sourceId");
    expect(couponCalls).toEqual(["player-1"]);
  });

  it("display name change requires auth and derives player identity from the session", async () => {
    const { app, renameCalls, publicProfileRepo } = await appWithFakes({ NODE_ENV: "development" });
    const inventoryItemId = "40000000-0000-4000-8000-000000000001";
    const payload = { inventoryItemId, displayName: "New Knight" };
    publicProfileRepo.profiles.set("CZ-8F42KD", { publicPlayerId: "CZ-8F42KD", displayName: "Smokey_OP", progressionRank: "Peasant", approvedPuzzlesSolved: 0, avatarUrl: null, equippedFrame: null, displayedBadges: [] });
    expect((await app.inject({ method: "POST", url: "/api/me/display-name", headers: { "idempotency-key": "rename-1" }, payload })).statusCode).toBe(401);
    const cookie = await login(app);
    const response = await app.inject({ method: "POST", url: "/api/me/display-name", headers: { cookie, "idempotency-key": " rename-1 " }, payload });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ publicPlayerId: "CZ-8F42KD", previousDisplayName: "Smokey_OP", displayName: "New Knight", remainingQuantity: 0 });
    expect(response.json()).not.toHaveProperty("playerId");
    expect(renameCalls[0]).toMatchObject({ inventoryItemId, displayName: "New Knight", idempotencyKey: "rename-1" });
    expect(renameCalls[0].playerId).toBeTruthy();
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(me.json()).toMatchObject({ publicPlayerId: "CZ-8F42KD", displayName: "New Knight" });
    const publicProfile = await app.inject({ method: "GET", url: "/api/players/CZ-8F42KD/public-profile", headers: { cookie } });
    expect(publicProfile.json()).toMatchObject({ publicPlayerId: "CZ-8F42KD", displayName: "New Knight" });
  });

  it.each([
    ["missing idempotency key", {}, { inventoryItemId: "40000000-0000-4000-8000-000000000001", displayName: "New Knight" }],
    ["invalid item UUID", { "idempotency-key": "rename-1" }, { inventoryItemId: "bad", displayName: "New Knight" }],
    ["missing display name", { "idempotency-key": "rename-1" }, { inventoryItemId: "40000000-0000-4000-8000-000000000001" }],
    ["client player authority", { "idempotency-key": "rename-1" }, { inventoryItemId: "40000000-0000-4000-8000-000000000001", displayName: "New Knight", playerId: "other" }],
  ])("rejects display name change with %s", async (_name, headers, payload) => {
    const { app } = await appWithFakes({ NODE_ENV: "development" }); const cookie = await login(app);
    const response = await app.inject({ method: "POST", url: "/api/me/display-name", headers: { cookie, ...headers }, payload });
    expect(response.statusCode).toBe(400); expect(response.json().code).toBe("VALIDATION_FAILED");
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

function signHandoff(input: { iss: "circzles.com" | "circzles.in"; sub: string; email: string; jti: string }, secret: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "CZ-HANDOFF" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ v: 1, aud: "circzles-player-hub", emailVerified: true, provider: "WIX", iat: now, exp: now + 120, ...input })).toString("base64url");
  return `${header}.${payload}.${createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url")}`;
}

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
  it("accepts sequential public IDs and rejects noncanonical or oversized IDs", async () => {
    const { app, publicProfileRepo } = await appWithFakes({ NODE_ENV: "development" });
    const cookie = await login(app);
    for (const id of ["hazel_001", "john_doe_002", "player_999", "player_1000"]) {
      publicProfileRepo.profiles.set(id, { publicPlayerId: id, displayName: "Player", progressionRank: "Peasant", approvedPuzzlesSolved: 0, avatarUrl: null, equippedFrame: null, displayedBadges: [] });
      const response = await app.inject({ method: "GET", url: `/api/players/${id}/public-profile`, headers: { cookie } });
      expect(response.statusCode).toBe(200); expect(response.json().publicPlayerId).toBe(id);
    }
    for (const id of ["hazel_000", "hazel_01", "hazel_0001", "Hazel_001", "hazel@example.com", "x".repeat(85)]) {
      expect((await app.inject({ method: "GET", url: `/api/players/${id}/public-profile`, headers: { cookie } })).statusCode).toBe(400);
    }
  });
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


describe("native auth HTTP integration", () => {
  async function setup(overrides: Partial<Env> = {}) {
    const repo = { rateLimit: vi.fn(async () => undefined) } as unknown as NativeAuthRepository;
    const nativeAuth = new NativeAuthService(repo, new DevelopmentAuthMailer());
    const googleAuth = new GoogleAuthService(repo, null);
    const context = await appWithFakes(overrides, undefined, { nativeAuth, googleAuth });
    const account = await context.identity.findOrCreateWixIdentity({ wixMemberId: "native-http-player", displayName: "Native Player" });
    vi.spyOn(nativeAuth, "login").mockResolvedValue({ ...account, passwordCredentialHash: "test-hash" });
    vi.spyOn(nativeAuth, "verify").mockResolvedValue(account);
    vi.spyOn(nativeAuth, "signup").mockResolvedValue({ state: "EMAIL_VERIFICATION_REQUIRED", message: "Check your email" });
    vi.spyOn(nativeAuth, "forgot").mockResolvedValue({ ok: true });
    vi.spyOn(nativeAuth, "reset").mockResolvedValue(account);
    return { ...context, nativeAuth, googleAuth, account, repo };
  }
  it("native login rotates the session and sets a host-only Secure HttpOnly SameSite=Lax 20-day cookie", async () => {
    const { app, identity, account } = await setup({ COOKIE_SECURE: true });
    const old = await identity.createSession(account.userId);
    const response = await app.inject({ method: "POST", url: "/api/auth/email/login", headers: { cookie: `cz_session=${old.token}`, origin: "http://localhost:3000" }, payload: { email: "native@example.test", password: "password" } });
    expect(response.statusCode).toBe(200);
    const cookie = String(response.headers["set-cookie"]);
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure"); expect(cookie).toContain("SameSite=Lax"); expect(cookie).not.toContain("Domain=");
    const expiry = new Date(cookie.match(/Expires=([^;]+)/)![1]).getTime();
    expect(expiry - Date.now()).toBeGreaterThan(20 * 86400_000 - 5000);
    expect(await identity.getPlayerForToken(old.token)).toBeNull();
    expect(response.json().publicPlayerId).toBe(account.player.publicPlayerId);
    expect(response.headers["cache-control"]).toContain("no-store");
    await app.close();
  });
  it("signup is pending; verification establishes a session; forgot is generic", async () => {
    const { app, account } = await setup();
    expect((await app.inject({ method: "POST", url: "/api/auth/email/signup", payload: { email: "native@example.test", password: "twelve characters", displayName: "Player" } })).statusCode).toBe(202);
    const verified = await app.inject({ method: "POST", url: "/api/auth/email/verify", payload: { token: authToken() } });
    expect(verified.json().publicPlayerId).toBe(account.player.publicPlayerId); expect(verified.headers["set-cookie"]).toBeDefined();
    expect((await app.inject({ method: "POST", url: "/api/auth/password/forgot", payload: { email: "missing@example.test" } })).json()).toEqual({ ok: true });
    await app.close();
  });
  it("rejects cross-origin mutations, malformed tokens and first-password requests without a session", async () => {
    const { app, nativeAuth } = await setup();
    const blocked = await app.inject({ method: "POST", url: "/api/auth/email/login", headers: { origin: "https://evil.test" }, payload: { email: "player@example.test", password: "password" } });
    expect(blocked.statusCode).toBe(403); expect(nativeAuth.login).not.toHaveBeenCalled();
    expect((await app.inject({ method: "POST", url: "/api/auth/password/request-set", payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/password/set", payload: { token: authToken(), password: "twelve characters" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/email/verify", payload: { token: "invalid" } })).statusCode).toBe(400);
    await app.close();
  });
  it("retires Wix login and handoff in the native runtime", async () => {
    const { app } = await setup();
    expect((await app.inject({ method: "POST", url: "/api/auth/direct/email/login", payload: {} })).statusCode).toBe(410);
    expect((await app.inject({ method: "POST", url: "/api/auth/handoff/exchange", payload: { token: "wix-token" } })).statusCode).toBe(410);
    await app.close();
  });
  it.each([
    "",
    "&iss=https%3A%2F%2Faccounts.google.com",
    "&iss=https%3A%2F%2Faccounts.google.com&scope=openid%20email%20profile&authuser=0&prompt=consent&hd=example.com",
    "&foo=bar",
    "&foo=one&foo=two&email=untrusted%40example.com&sub=untrusted&email_verified=true",
  ])("Google callback ignores extra metadata %s, reaches the provider and rotates the session", async (extra) => {
    const { app, googleAuth, account, identity } = await setup({ COOKIE_SECURE: true });
    const oldSession = await identity.createSession(account.userId);
    vi.spyOn(googleAuth, "start").mockResolvedValue({ authorizationUrl: "https://accounts.google.com/authorize", binding: authToken() });
    const complete = vi.spyOn(googleAuth, "complete").mockResolvedValue({ account, returnTo: "/hub" });
    const start = await app.inject({ method: "GET", url: "/api/auth/google/start?returnTo=%2Fhub" });
    expect(start.json().authorizationUrl).toContain("accounts.google.com");
    expect(String(start.headers["set-cookie"])).toContain("cz_google_state="); expect(String(start.headers["set-cookie"])).toContain("HttpOnly");
    const state = authToken();
    const callback = await app.inject({ method: "GET", url: `/api/auth/google/callback?state=${state}&code=code${extra}`, headers: { cookie: `${String(start.headers["set-cookie"]).split(";")[0]}; cz_session=${oldSession.token}` } });
    expect(callback.statusCode).toBe(302); expect(callback.headers.location).toBe("http://localhost:3000/hub");
    expect(complete).toHaveBeenCalledExactlyOnceWith({ state, code: "code" }, expect.any(String));
    expect(String(callback.headers["set-cookie"])).toContain("cz_session=");
    expect(String(callback.headers["set-cookie"])).toContain("cz_google_state=;");
    expect(String(callback.headers["set-cookie"])).toContain("HttpOnly");
    expect(String(callback.headers["set-cookie"])).toContain("Secure");
    expect(String(callback.headers["set-cookie"])).toContain("SameSite=Lax");
    expect(String(callback.headers["set-cookie"])).not.toContain("Domain=");
    expect(callback.headers["cache-control"]).toContain("no-store");
    expect(await identity.getPlayerForToken(oldSession.token)).toBeNull();
    await app.close();
  });
  it("Google callback rejects raw duplicates even if the query object hides them", async () => {
    const { app, googleAuth } = await setup();
    const complete = vi.spyOn(googleAuth, "complete");
    const state = authToken();
    app.addHook("preValidation", async (request) => { request.query = { state, code: "code" }; });
    const response = await app.inject({ method: "GET", url: `/api/auth/google/callback?state=${state}&%73tate=${state}&code=code` });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("VALIDATION_FAILED");
    expect(complete).not.toHaveBeenCalled();
    expect(String(response.headers["set-cookie"])).toContain("cz_google_state=;");
    await app.close();
  });
  it.each([
    ["malformed issuer", "iss=not-a-url"],
    ["unexpected issuer", "iss=https%3A%2F%2Fevil.example"],
    ["issuer lookalike", "iss=https%3A%2F%2Faccounts.google.com.evil.example"],
    ["issuer trailing slash", "iss=https%3A%2F%2Faccounts.google.com%2F"],
    ["empty issuer", "iss="],
    ["duplicate issuer", "iss=https%3A%2F%2Faccounts.google.com&iss=https%3A%2F%2Faccounts.google.com"],
    ["empty state", "state="],
    ["malformed state", "state=invalid"],
    ["duplicate state", `state=${authToken()}&state=${authToken()}`],
    ["empty code", "code="],
    ["oversized code", `code=${"x".repeat(4097)}`],
    ["duplicate code", "code=one&code=two"],
    ["duplicate error", "error=access_denied&error=access_denied"],
    ["ambiguous response", "error=access_denied"],
  ])("rejects Google callback with %s before calling the provider", async (_name, invalidQuery) => {
    const { app, googleAuth } = await setup();
    const complete = vi.spyOn(googleAuth, "complete");
    const query = new URLSearchParams({ state: authToken(), code: "code" });
    if (invalidQuery.startsWith("state=")) query.delete("state");
    if (invalidQuery.startsWith("code=")) query.delete("code");
    const response = await app.inject({ method: "GET", url: `/api/auth/google/callback?${query}&${invalidQuery}` });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "VALIDATION_FAILED", message: "Invalid authentication request." });
    expect(complete).not.toHaveBeenCalled();
    await app.close();
  });
  it("requires the existing Google callback state parameter even with a valid issuer", async () => {
    const { app, googleAuth } = await setup();
    const complete = vi.spyOn(googleAuth, "complete");
    const response = await app.inject({ method: "GET", url: "/api/auth/google/callback?code=code&iss=https%3A%2F%2Faccounts.google.com" });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("VALIDATION_FAILED");
    expect(complete).not.toHaveBeenCalled();
    await app.close();
  });
  it.each([undefined, "https://accounts.google.com"])("Google callback failures with issuer %s reach the provider without exposing details", async (issuer) => {
    const { app, googleAuth } = await setup();
    const complete = vi.spyOn(googleAuth, "complete").mockRejectedValue(new AppError("GOOGLE_AUTH_FAILED", "provider-sensitive-error", 502));
    const state = authToken();
    const issuerQuery = issuer ? `&iss=${encodeURIComponent(issuer)}` : "";
    const response = await app.inject({ method: "GET", url: `/api/auth/google/callback?state=${state}&error=access_denied&error_description=User%20cancelled&error_uri=https%3A%2F%2Faccounts.google.com%2Ferrors&hd=example.com${issuerQuery}`, headers: { cookie: `cz_google_state=${authToken()}` } });
    expect(response.statusCode).toBe(302); expect(response.headers.location).toBe("http://localhost:3000/login?authError=google");
    expect(complete).toHaveBeenCalledExactlyOnceWith({ state, error: "access_denied", error_description: "User cancelled", error_uri: "https://accounts.google.com/errors" }, expect.any(String));
    expect(response.body).not.toContain("provider-sensitive-error");
    expect(String(response.headers["set-cookie"])).toContain("cz_google_state=;");
    await app.close();
  });
  it("requires the server proxy secret in production and trusts its client IP only with that secret", async () => {
    const secret = "test-proxy-secret-with-at-least-32-chars";
    const { app, repo } = await setup({ NODE_ENV: "production", COOKIE_SECURE: true, PLAYER_HUB_PROXY_SECRET: secret });
    const payload = { email: "missing@example.test" };
    expect((await app.inject({ method: "POST", url: "/api/auth/password/forgot", headers: { "x-player-hub-client-ip": "1.2.3.4" }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/auth/password/forgot", headers: { "x-player-hub-proxy-secret": secret, "x-player-hub-client-ip": "1.2.3.4" }, payload })).statusCode).toBe(200);
    expect(repo.rateLimit).toHaveBeenCalled(); await app.close();
  });
});
