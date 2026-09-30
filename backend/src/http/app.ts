import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import type { FastifyError } from "fastify";
import type { FastifyReply } from "fastify";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { toSessionPlayerDto, type IdentityProvider, type IdentityService, type PlayerDto, type VerifiedExternalIdentity } from "../domain/identity.js";
import { AppError, forbidden, unauthorized, validationFailed } from "../domain/errors.js";
import type { GameStateService } from "../domain/gameState.js";
import type { PuzzleOwnershipService } from "../domain/puzzles.js";
import { MAX_COMPLETION_TIME_MS, type SubmissionService } from "../domain/submissions.js";
import { SESSION_COOKIE_NAME } from "../domain/sessions.js";
import type { AdminAuthorizationService } from "../domain/adminAuth.js";
import type { AdminSubmissionService } from "../domain/adminSubmissions.js";
import type { LeaderboardService } from "../domain/leaderboards.js";
import type { SubmissionReviewService } from "../domain/submissionReviews.js";
import type { PublicProfileService } from "../domain/publicProfiles.js";
import type { MissionClaimService, PlayerMissionService } from "../domain/missions.js";
import type { RewardCatalogService } from "../domain/rewardCatalog.js";
import type { StorePurchaseService } from "../domain/storePurchases.js";
import { equipmentSlots, type InventoryService } from "../domain/inventory.js";
import type { PlayerIdentityActionService } from "../domain/playerIdentityActions.js";
import type { RewardWheelService } from "../domain/rewardWheel.js";
import type { CouponService } from "../domain/coupons.js";
import type { CouponRedemptionWebhookHandler } from "../integrations/couponRedemptionWebhooks.js";
import { couponWebhookRoutes } from "./couponWebhookRoutes.js";
import { AuthHandoffVerifier } from "../domain/authHandoff.js";
import { UnconfiguredDirectAuthProvider, type DirectAuthProvider } from "../domain/directAuth.js";

export interface AppDeps {
  env: Env;
  identity: IdentityService;
  gameState: GameStateService;
  puzzles: PuzzleOwnershipService;
  submissions: SubmissionService;
  adminAuth: AdminAuthorizationService;
  adminSubmissions: AdminSubmissionService;
  leaderboards: LeaderboardService;
  submissionReviews: SubmissionReviewService;
  publicProfiles: PublicProfileService;
  missions: PlayerMissionService;
  missionClaims: MissionClaimService;
  rewardCatalog: RewardCatalogService;
  storePurchases: StorePurchaseService;
  inventory: InventoryService;
  coupons: CouponService;
  playerIdentityActions: PlayerIdentityActionService;
  rewardWheel: RewardWheelService;
  couponRedemptionWebhooks?: CouponRedemptionWebhookHandler;
  authHandoff?: AuthHandoffVerifier;
  directAuth?: DirectAuthProvider;
  checkDb: () => Promise<void>;
}

const handoffExchangeBodySchema = z.object({ token: z.string().min(1).max(8192) }).strict();
const captchaFields = { captchaToken: z.string().min(1).max(8192).optional(), captchaType: z.enum(["RECAPTCHA", "INVISIBLE_RECAPTCHA"]).optional() };
const emailLoginBodySchema = z.object({ email: z.string().email().max(320), password: z.string().min(8).max(256), returnTo: z.string().optional(), ...captchaFields }).strict();
const emailSignupBodySchema = z.object({ displayName: z.string().trim().min(2).max(80), email: z.string().email().max(320), password: z.string().min(8).max(256), returnTo: z.string().optional(), ...captchaFields }).strict();
const emailVerificationBodySchema = z.object({ challengeId: z.string().min(1).max(8192), code: z.string().trim().min(4).max(12), returnTo: z.string().optional() }).strict();
const googleStartQuerySchema = z.object({ returnTo: z.string().optional() }).strict();
const googleCallbackQuerySchema = z.union([
  z.object({ code: z.string().min(1).max(4096), state: z.string().min(1).max(4096) }).strict(),
  z.object({
    error: z.string().min(1).max(256),
    error_description: z.string().min(1).max(1024).optional(),
    state: z.string().min(1).max(4096),
  }).strict(),
]);

const devGrantBodySchema = z.object({
  amount: z.number().int().positive().max(1_000_000),
  reason: z.string().trim().min(1).max(200).default("Development test grant"),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const claimPuzzleBodySchema = z.object({
  code: z.string().trim().min(1).max(200),
}).strict();

const signVideoBodySchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(100),
  sizeBytes: z.number().int().positive(),
}).strict();
const uuidParamsSchema = z.object({ submissionId: z.string().uuid() }).strict();
const videoUploadParamsSchema = z.object({ videoUploadId: z.string().uuid() }).strict();
const createSubmissionBodySchema = z.object({
  playerPuzzleId: z.string().uuid(),
  completionTimeMs: z.number().int().positive().max(MAX_COMPLETION_TIME_MS),
  videoUploadId: z.string().uuid(),
}).strict();
const adminSubmissionQuerySchema = z.object({
  status: z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED", "RESUBMISSION_REQUIRED"]).default("PENDING_REVIEW"),
  puzzleId: z.string().uuid().optional(),
  levelId: z.coerce.number().positive().max(999.9).refine((value) => Math.abs(value * 10 - Math.round(value * 10)) <= Number.EPSILON * 10, "levelId supports at most one decimal place").optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
}).strict();
const adminSubmissionParamsSchema = z.object({ submissionId: z.string().uuid() }).strict();
const leaderboardQuerySchema = z.object({ puzzleId: z.string().uuid() }).strict();
const publicProfileParamsSchema = z.object({
  publicPlayerId: z.string().regex(/^CZ-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/),
}).strict();
const reviewSubmissionBodySchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED", "RESUBMISSION_REQUIRED"]),
  reviewNote: z.string().max(2000).optional(),
}).strict();
const storePurchaseParamsSchema = z.object({ listingId: z.string().uuid() }).strict();
const inventoryItemParamsSchema = z.object({ inventoryItemId: z.string().uuid() }).strict();
const equipmentParamsSchema = z.object({ slot: z.enum(equipmentSlots) }).strict();
const equipBodySchema = z.object({ slot: z.enum(equipmentSlots) }).strict();
const renameDisplayNameBodySchema = z.object({ inventoryItemId: z.string().uuid(), displayName: z.string() }).strict();

export function buildApp({ env, identity, gameState, puzzles, submissions: submissionService, adminAuth, adminSubmissions, leaderboards, submissionReviews, publicProfiles, missions, missionClaims, rewardCatalog, storePurchases, inventory, coupons, playerIdentityActions, rewardWheel, couponRedemptionWebhooks, authHandoff, directAuth, checkDb }: AppDeps) {
  const handoffVerifier = authHandoff ?? new AuthHandoffVerifier({ circzlesCom: env.AUTH_HANDOFF_CIRCZLES_COM_SECRET, circzlesIn: env.AUTH_HANDOFF_CIRCZLES_IN_SECRET });
  const directAuthProvider = directAuth ?? new UnconfiguredDirectAuthProvider();
  const app = Fastify({
    logger: env.NODE_ENV === "test" ? false : {
      level: "info",
      redact: ["req.headers.cookie", "req.headers.authorization"],
    },
    genReqId: () => crypto.randomUUID(),
  });

  app.register(cors, {
    origin: env.FRONTEND_ORIGIN,
    credentials: true,
  });
  app.register(cookie, { secret: env.SESSION_SECRET });
  app.register(couponWebhookRoutes, { handler: couponRedemptionWebhooks });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ code: error.code, message: error.message, details: error.details, requestId: request.id });
    }
    const fastifyError = error as FastifyError;
    const maybeStatusCode = typeof fastifyError.statusCode === "number" ? fastifyError.statusCode : undefined;
    if (maybeStatusCode && maybeStatusCode >= 400 && maybeStatusCode < 500) {
      const maybeCode = typeof fastifyError.code === "string" ? fastifyError.code : "BAD_REQUEST";
      return reply.status(maybeStatusCode).send({ code: maybeCode, message: fastifyError.message, requestId: request.id });
    }
    request.log.error(error);
    return reply.status(500).send({ code: "INTERNAL_SERVER_ERROR", message: "Unexpected server error.", requestId: request.id });
  });

  app.get("/health", async () => {
    await checkDb();
    return { ok: true };
  });

  app.get("/api/auth/session", async (request, reply) => {
    const sessionCookie = request.cookies[SESSION_COOKIE_NAME];
    const session = await identity.refreshSession(sessionCookie);
    if (!session) {
      logSessionDiagnostic(request, env, "unauthenticated", Boolean(sessionCookie));
      throw unauthorized();
    }
    setSessionCookie(reply, env, sessionCookie!, session.expiresAt);
    logSessionDiagnostic(request, env, "authenticated", true);
    return reply.send(toSessionPlayerDto(session.player));
  });

  app.post("/api/auth/logout", async (request, reply) => {
    clearSessionCookie(reply, env);
    await identity.logout(request.cookies[SESSION_COOKIE_NAME]);
    return reply.send({ ok: true });
  });

  app.post("/api/auth/handoff/exchange", async (request, reply) => {
    const body = handoffExchangeBodySchema.safeParse(request.body);
    if (!body.success) throw validationFailed("Invalid authentication handoff.", body.error.flatten());
    const verified = handoffVerifier.verify(body.data.token);
    const account = await identity.resolveVerifiedIdentity({
      ...verified,
      handoff: { tokenIdHash: identity.hashHandoffTokenId(verified.tokenId), expiresAt: verified.expiresAt },
    });
    return finishAuthentication(account, identity, gameState, reply, env);
  });

  app.post("/api/auth/direct/email/login", async (request, reply) => {
    const body = emailLoginBodySchema.safeParse(request.body);
    if (!body.success) throw validationFailed("Invalid login request.", body.error.flatten());
    return reply.send(await directAuthProvider.loginWithEmail({ ...body.data, returnTo: safeReturnTo(body.data.returnTo) }));
  });

  app.post("/api/auth/direct/email/signup", async (request, reply) => {
    const body = emailSignupBodySchema.safeParse(request.body);
    if (!body.success) throw validationFailed("Invalid signup request.", body.error.flatten());
    const result = await directAuthProvider.startEmailSignup({ ...body.data, returnTo: safeReturnTo(body.data.returnTo) });
    return "authorizationUrl" in result ? reply.send(result) : reply.status(202).send(result);
  });

  app.post("/api/auth/direct/email/verify", async (request, reply) => {
    const body = emailVerificationBodySchema.safeParse(request.body);
    if (!body.success) throw validationFailed("Invalid verification request.", body.error.flatten());
    return reply.send(await directAuthProvider.verifyEmailSignup({ ...body.data, returnTo: safeReturnTo(body.data.returnTo) }));
  });

  app.get("/api/auth/direct/google/start", async (request, reply) => {
    const query = googleStartQuerySchema.safeParse(request.query);
    if (!query.success) throw validationFailed("Invalid Google login request.", query.error.flatten());
    const returnTo = safeReturnTo(query.data.returnTo);
    return reply.send(await directAuthProvider.getGoogleAuthorizationUrl({ returnTo }));
  });

  app.get("/api/auth/direct/google/callback", async (request, reply) => {
    const query = googleCallbackQuerySchema.safeParse(request.query);
    if (!query.success) throw validationFailed("Invalid Wix authentication callback.", query.error.flatten());
    const callback = "code" in query.data
      ? query.data
      : { error: query.data.error, errorDescription: query.data.error_description, state: query.data.state };
    const completed = await directAuthProvider.completeAuthorization(callback);
    const verified = requireCanonicalDirectIdentity(completed.identity, completed.identity.provider);
    const account = await identity.resolveVerifiedIdentity(verified);
    const session = await identity.createSession(account.userId);
    setSessionCookie(reply, env, session.token, session.expiresAt);
    logSessionDiagnostic(request, env, "created", true);
    await gameState.ensurePlayerGameState(account.player.internalId);
    return reply.redirect(`${env.FRONTEND_ORIGIN}${safeReturnTo(completed.returnTo)}`);
  });

  app.get("/api/me", async (request, reply) => {
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    await gameState.ensurePlayerGameState(player.internalId);
    return reply.send(await withGameState(player, gameState));
  });

  app.get("/api/me/puzzles", async (request, reply) => {
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    return reply.send(await puzzles.getOwnedPuzzles(player.internalId));
  });

  app.get("/api/puzzles/:puzzleId", async (request, reply) => {
    const params = z.object({ puzzleId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) throw validationFailed("Invalid puzzle id.", params.error.flatten());
    return reply.send(await puzzles.getPuzzle(params.data.puzzleId));
  });

  app.post("/api/puzzles/claim", async (request, reply) => {
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    const body = parseClaimPuzzleBody(request.body);
    return reply.send(await puzzles.claimByCode(player.internalId, body.code));
  });

  app.post("/api/uploads/videos/signed-url", async (request, reply) => {
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    const parsed = signVideoBodySchema.safeParse(request.body);
    if (!parsed.success) throw validationFailed("Invalid video upload request.", parsed.error.flatten());
    return reply.send(await submissionService.signVideoUpload(player.internalId, parsed.data));
  });

  app.post("/api/uploads/videos/:videoUploadId/complete", async (request, reply) => {
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    const parsed = videoUploadParamsSchema.safeParse(request.params);
    if (!parsed.success) throw validationFailed("Invalid video upload id.", parsed.error.flatten());
    return reply.send(await submissionService.completeVideoUpload(player.internalId, parsed.data.videoUploadId));
  });

  app.get("/api/submissions", async (request, reply) => {
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    return reply.send(await submissionService.getSubmissions(player.internalId));
  });

  app.get("/api/submissions/:submissionId", async (request, reply) => {
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    const parsed = uuidParamsSchema.safeParse(request.params);
    if (!parsed.success) throw validationFailed("Invalid submission id.", parsed.error.flatten());
    return reply.send(await submissionService.getSubmission(player.internalId, parsed.data.submissionId));
  });

  app.post("/api/submissions", async (request, reply) => {
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    const parsed = createSubmissionBodySchema.safeParse(request.body);
    if (!parsed.success) throw validationFailed("Invalid submission body.", parsed.error.flatten());
    const idempotencyHeader = request.headers["idempotency-key"];
    const idempotencyKey = typeof idempotencyHeader === "string" ? idempotencyHeader.trim() : undefined;
    if (idempotencyKey && idempotencyKey.length > 200) throw validationFailed("Idempotency-Key is too long.");
    return reply.status(201).send(await submissionService.createSubmission(player.internalId, parsed.data, idempotencyKey || undefined));
  });

  app.get("/api/leaderboards/catalog", async (request, reply) => {
    await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    return reply.send(await leaderboards.getCatalog());
  });

  app.get("/api/missions", async (request, reply) => {
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    return reply.send({ missions: await missions.list(player.internalId) });
  });

  app.get("/api/rewards/store", async (request, reply) => {
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    return reply.send({ items: await rewardCatalog.listAvailable(player.internalId) });
  });

  app.post("/api/rewards/store/:listingId/purchase", async (request, reply) => {
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    const params = storePurchaseParamsSchema.safeParse(request.params);
    if (!params.success) throw validationFailed("Invalid Store listing id.", params.error.flatten());
    if (request.body && (typeof request.body !== "object" || Array.isArray(request.body) || Object.keys(request.body).length > 0)) throw validationFailed("Store purchase does not accept request data.");
    const header = request.headers["idempotency-key"];
    const idempotencyKey = typeof header === "string" ? header.trim() : "";
    if (!idempotencyKey || idempotencyKey.length > 200) throw validationFailed("A valid Idempotency-Key header is required.");
    return reply.send(await storePurchases.purchase({ playerId: player.internalId, listingId: params.data.listingId, idempotencyKey }));
  });

  app.get("/api/wheel", async (request, reply) => {
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    return reply.send(await rewardWheel.getStatus(player.internalId));
  });

  app.post("/api/wheel/spin", async (request, reply) => {
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    if (request.body !== undefined && (request.body === null || typeof request.body !== "object" || Array.isArray(request.body) || Object.keys(request.body).length > 0)) throw validationFailed("Reward Wheel spin does not accept request data.");
    const header = request.headers["idempotency-key"];
    const idempotencyKey = typeof header === "string" ? header.trim() : "";
    if (!idempotencyKey || idempotencyKey.length > 200) throw validationFailed("A valid Idempotency-Key header is required.");
    return reply.send(await rewardWheel.spin({ playerId: player.internalId, idempotencyKey }));
  });

  app.get("/api/me/inventory", async (request, reply) => {
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    return reply.send(await inventory.list(player.internalId));
  });

  app.get("/api/me/coupons", async (request, reply) => {
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    return reply.send({ coupons: await coupons.list(player.internalId) });
  });

  app.post("/api/me/inventory/:inventoryItemId/equip", async (request, reply) => {
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    const params = inventoryItemParamsSchema.safeParse(request.params); const body = equipBodySchema.safeParse(request.body);
    if (!params.success || !body.success) throw validationFailed("Invalid equipment request.", { params: params.success ? undefined : params.error.flatten(), body: body.success ? undefined : body.error.flatten() });
    return reply.send(await inventory.equip(player.internalId, params.data.inventoryItemId, body.data.slot));
  });

  app.delete("/api/me/equipment/:slot", async (request, reply) => {
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    const params = equipmentParamsSchema.safeParse(request.params);
    if (!params.success) throw validationFailed("Invalid equipment slot.", params.error.flatten());
    return reply.send(await inventory.unequip(player.internalId, params.data.slot));
  });

  app.post("/api/me/display-name", async (request, reply) => {
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    const body = renameDisplayNameBodySchema.safeParse(request.body);
    if (!body.success) throw validationFailed("Invalid display name change request.", body.error.flatten());
    const header = request.headers["idempotency-key"];
    const idempotencyKey = typeof header === "string" ? header.trim() : "";
    if (!idempotencyKey || idempotencyKey.length > 200) throw validationFailed("A valid Idempotency-Key header is required.");
    return reply.send(await playerIdentityActions.renameDisplayName({ playerId: player.internalId, ...body.data, idempotencyKey }));
  });

  app.post("/api/missions/:missionId/claim", async (request, reply) => {
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    const params = z.object({ missionId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) throw validationFailed("Invalid mission id.", params.error.flatten());
    if (request.body && (typeof request.body !== "object" || Array.isArray(request.body) || Object.keys(request.body).length > 0)) throw validationFailed("Mission claim does not accept request data.");
    const header = request.headers["idempotency-key"];
    const idempotencyKey = typeof header === "string" ? header.trim() : "";
    if (!idempotencyKey || idempotencyKey.length > 200) throw validationFailed("A valid Idempotency-Key header is required.");
    return reply.send(await missionClaims.claim({ playerId: player.internalId, missionId: params.data.missionId, idempotencyKey }));
  });

  app.get("/api/leaderboards", async (request, reply) => {
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    const parsed = leaderboardQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationFailed("Invalid leaderboard query.", parsed.error.flatten());
    return reply.send(await leaderboards.getLeaderboard(parsed.data.puzzleId, player.internalId));
  });

  app.get("/api/players/:publicPlayerId/public-profile", async (request, reply) => {
    await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    const parsed = publicProfileParamsSchema.safeParse(request.params);
    if (!parsed.success) throw validationFailed("Invalid public player id.", parsed.error.flatten());
    return reply.send(await publicProfiles.getPublicProfile(parsed.data.publicPlayerId));
  });

  app.get("/api/admin/submissions", async (request, reply) => {
    await adminAuth.requirePermission(request.cookies[SESSION_COOKIE_NAME], "SUBMISSIONS_REVIEW");
    const parsed = adminSubmissionQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationFailed("Invalid admin submission filters.", parsed.error.flatten());
    return reply.send(await adminSubmissions.list(parsed.data));
  });

  app.get("/api/admin/submissions/:submissionId", async (request, reply) => {
    await adminAuth.requirePermission(request.cookies[SESSION_COOKIE_NAME], "SUBMISSIONS_REVIEW");
    const parsed = adminSubmissionParamsSchema.safeParse(request.params);
    if (!parsed.success) throw validationFailed("Invalid submission id.", parsed.error.flatten());
    return reply.send(await adminSubmissions.get(parsed.data.submissionId));
  });

  app.post("/api/admin/submissions/:submissionId/review", async (request, reply) => {
    const admin = await adminAuth.requirePermission(request.cookies[SESSION_COOKIE_NAME], "SUBMISSIONS_REVIEW");
    const params = adminSubmissionParamsSchema.safeParse(request.params);
    if (!params.success) throw validationFailed("Invalid submission id.", params.error.flatten());
    const body = reviewSubmissionBodySchema.safeParse(request.body);
    if (!body.success) throw validationFailed("Invalid submission review body.", body.error.flatten());
    const header = request.headers["idempotency-key"];
    const idempotencyKey = typeof header === "string" ? header.trim() : "";
    if (!idempotencyKey || idempotencyKey.length > 200) throw validationFailed("A valid Idempotency-Key header is required.");
    return reply.send(await submissionReviews.review({ reviewerAdminUserId: admin.adminUserId, submissionId: params.data.submissionId, ...body.data, idempotencyKey }));
  });

  app.post("/api/dev/login", async (request, reply) => {
    const contentType = request.headers["content-type"];
    if (contentType && !contentType.toLowerCase().includes("application/json")) {
      throw new AppError("FST_ERR_CTP_INVALID_MEDIA_TYPE", "Unsupported Media Type: use application/json.", 415);
    }
    if (env.NODE_ENV === "production") {
      throw new AppError("FORBIDDEN", "Development login is disabled in production.", 403);
    }
    const account = await identity.findOrCreateWixIdentity({
      wixMemberId: "dev-wix-member-smokey",
      displayName: "Smokey_OP",
      publicPlayerId: "CZ-8F42KD",
    });
    await gameState.ensurePlayerGameState(account.player.internalId);
    const session = await identity.createSession(account.userId);
    setSessionCookie(reply, env, session.token, session.expiresAt);
    return reply.send(await withGameState(account.player, gameState));
  });

  app.post("/api/dev/xp/grant", async (request, reply) => {
    if (env.NODE_ENV === "production") throw forbidden("Development XP grant is disabled in production.");
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    const body = parseDevGrantBody(request.body);
    if (hasPlayerId(request.body)) throw validationFailed("Development grant routes infer player identity from the session.");
    const result = await gameState.grantXp({
      playerId: player.internalId,
      amount: body.amount,
      reason: body.reason,
      sourceType: "dev.xp.grant",
      idempotencyKey: body.idempotencyKey,
      metadata: body.metadata,
    });
    return reply.send({ ...result, player: await withGameState(player, gameState) });
  });

  app.post("/api/dev/points/credit", async (request, reply) => {
    if (env.NODE_ENV === "production") throw forbidden("Development point credit is disabled in production.");
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    const body = parseDevGrantBody(request.body);
    if (hasPlayerId(request.body)) throw validationFailed("Development grant routes infer player identity from the session.");
    const result = await gameState.creditPoints({
      playerId: player.internalId,
      amount: body.amount,
      reason: body.reason,
      sourceType: "dev.points.credit",
      idempotencyKey: body.idempotencyKey,
      metadata: body.metadata,
    });
    return reply.send({ ...result, player: await withGameState(player, gameState) });
  });

  app.post("/api/dev/points/debit", async (request, reply) => {
    if (env.NODE_ENV === "production") throw forbidden("Development point debit is disabled in production.");
    const player = await requireCurrentPlayer(identity, request.cookies[SESSION_COOKIE_NAME]);
    const body = parseDevGrantBody(request.body);
    if (hasPlayerId(request.body)) throw validationFailed("Development grant routes infer player identity from the session.");
    const result = await gameState.debitPoints({
      playerId: player.internalId,
      amount: body.amount,
      reason: body.reason,
      sourceType: "dev.points.debit",
      idempotencyKey: body.idempotencyKey,
      metadata: body.metadata,
    });
    return reply.send({ ...result, player: await withGameState(player, gameState) });
  });

  return app;
}

async function finishAuthentication(account: { userId: string; player: PlayerDto }, identity: IdentityService, gameState: GameStateService, reply: FastifyReply, env: Env) {
  await gameState.ensurePlayerGameState(account.player.internalId);
  const session = await identity.createSession(account.userId);
  setSessionCookie(reply, env, session.token, session.expiresAt);
  return reply.send(await withGameState(account.player, gameState));
}

function setSessionCookie(reply: FastifyReply, env: Env, token: string, expiresAt: Date) {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.SESSION_COOKIE_SAME_SITE,
    domain: env.SESSION_COOKIE_DOMAIN,
    path: "/",
    expires: expiresAt,
  });
}

function clearSessionCookie(reply: FastifyReply, env: Env) {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.SESSION_COOKIE_SAME_SITE,
    domain: env.SESSION_COOKIE_DOMAIN,
    path: "/",
  });
}

function logSessionDiagnostic(request: FastifyRequest, env: Env, sessionStatus: "created" | "authenticated" | "unauthenticated", cookiePresent: boolean) {
  if (!env.AUTH_SESSION_DIAGNOSTICS) return;
  request.log.info({
    cookiePresent,
    cookieDomain: env.SESSION_COOKIE_DOMAIN ?? "host-only",
    sameSite: env.SESSION_COOKIE_SAME_SITE,
    secure: env.COOKIE_SECURE,
    httpOnly: true,
    sessionStatus,
    requestOrigin: safeOrigin(request.headers.origin),
    apiOrigin: safeOrigin(`${request.protocol}://${request.host}`),
  }, "Player Hub session diagnostic");
}

function safeOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function safeReturnTo(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/hub";
  return value.slice(0, 512);
}

function requireCanonicalDirectIdentity(identity: VerifiedExternalIdentity, provider: IdentityProvider) {
  if (identity.sourceSite !== "CIRCZLES_COM" || !["EMAIL", "GOOGLE"].includes(provider) || identity.provider !== provider || identity.emailVerified !== true) {
    throw new AppError("DIRECT_AUTH_IDENTITY_INVALID", "The identity provider returned an invalid verified identity.", 502);
  }
  return identity;
}

async function requireCurrentPlayer(identity: IdentityService, token: string | undefined) {
  const player = await identity.getPlayerForToken(token);
  if (!player) throw unauthorized();
  return player;
}

async function withGameState(player: PlayerDto, gameState: GameStateService): Promise<PlayerDto> {
  const state = await gameState.getPlayerGameState(player.internalId);
  return {
    ...player,
    progressionLevel: state.progressionLevel,
    rank: state.rankName,
    xp: state.totalXp,
    xpNeeded: state.xpNeeded,
    synapsePoints: state.synapsePoints,
  };
}

function parseDevGrantBody(body: unknown) {
  const parsed = devGrantBodySchema.safeParse(body);
  if (!parsed.success) throw validationFailed("Invalid development grant body.", parsed.error.flatten());
  return parsed.data;
}

function parseClaimPuzzleBody(body: unknown) {
  const parsed = claimPuzzleBodySchema.safeParse(body);
  if (!parsed.success) throw validationFailed("Invalid puzzle claim body.", parsed.error.flatten());
  return parsed.data;
}

function hasPlayerId(body: unknown) {
  return typeof body === "object" && body !== null && ("playerId" in body || "internalId" in body || "publicPlayerId" in body);
}
