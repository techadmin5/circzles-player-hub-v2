import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import type { Env } from "../config/env.js";
import type { IdentityService } from "../domain/identity.js";
import { AppError, unauthorized } from "../domain/errors.js";
import { SESSION_COOKIE_NAME } from "../domain/sessions.js";

export interface AppDeps {
  env: Env;
  identity: IdentityService;
  checkDb: () => Promise<void>;
}

export function buildApp({ env, identity, checkDb }: AppDeps) {
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
    request.log.error(error);
    return reply.status(500).send({ code: "INTERNAL_SERVER_ERROR", message: "Unexpected server error.", requestId: request.id });
  });

  app.get("/health", async () => {
    await checkDb();
    return { ok: true };
  });

  app.get("/api/me", async (request, reply) => {
    const player = await identity.getPlayerForToken(request.cookies[SESSION_COOKIE_NAME]);
    if (!player) throw unauthorized();
    return reply.send(player);
  });

  app.post("/api/dev/login", async (request, reply) => {
    if (env.NODE_ENV === "production") {
      throw new AppError("FORBIDDEN", "Development login is disabled in production.", 403);
    }
    const account = await identity.findOrCreateWixIdentity({
      wixMemberId: "dev-wix-member-smokey",
      displayName: "Smokey_OP",
      publicPlayerId: "CZ-8F42KD",
    });
    const session = await identity.createSession(account.userId);
    reply.setCookie(SESSION_COOKIE_NAME, session.token, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });
    return reply.send(account.player);
  });

  return app;
}
