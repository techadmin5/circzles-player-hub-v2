import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import type { FastifyError } from "fastify";
import { z } from "zod";
import type { Env } from "../config/env.js";
import type { IdentityService, PlayerDto } from "../domain/identity.js";
import { AppError, forbidden, unauthorized, validationFailed } from "../domain/errors.js";
import type { GameStateService } from "../domain/gameState.js";
import type { PuzzleOwnershipService } from "../domain/puzzles.js";
import type { SubmissionService } from "../domain/submissions.js";
import { SESSION_COOKIE_NAME } from "../domain/sessions.js";

export interface AppDeps {
  env: Env;
  identity: IdentityService;
  gameState: GameStateService;
  puzzles: PuzzleOwnershipService;
  submissions: SubmissionService;
  checkDb: () => Promise<void>;
}

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
  completionTimeMs: z.number().int().positive(),
  videoUploadId: z.string().uuid(),
}).strict();

export function buildApp({ env, identity, gameState, puzzles, submissions: submissionService, checkDb }: AppDeps) {
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
    reply.setCookie(SESSION_COOKIE_NAME, session.token, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });
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
