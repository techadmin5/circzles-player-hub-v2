import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import type { FastifyError } from "fastify";
import { z } from "zod";
import type { Env } from "../config/env.js";
import type { IdentityService, PlayerDto } from "../domain/identity.js";
import { AppError, forbidden, unauthorized, validationFailed } from "../domain/errors.js";
import type { GameStateService } from "../domain/gameState.js";
import { SESSION_COOKIE_NAME } from "../domain/sessions.js";

export interface AppDeps {
  env: Env;
  identity: IdentityService;
  gameState: GameStateService;
  checkDb: () => Promise<void>;
}

const devGrantBodySchema = z.object({
  amount: z.number().int().positive().max(1_000_000),
  reason: z.string().trim().min(1).max(200).default("Development test grant"),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export function buildApp({ env, identity, gameState, checkDb }: AppDeps) {
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

function hasPlayerId(body: unknown) {
  return typeof body === "object" && body !== null && ("playerId" in body || "internalId" in body || "publicPlayerId" in body);
}
