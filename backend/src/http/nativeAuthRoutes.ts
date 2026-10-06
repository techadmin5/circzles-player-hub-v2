import { isIP } from "node:net";
import { constantTimeEqual } from "../domain/sessions.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Env } from "../config/env.js";
import type { IdentityService, IdentityAccount } from "../domain/identity.js";
import type { NativeAuthService } from "../domain/nativeAuth.js";
import type { GoogleAuthService } from "../domain/googleAuth.js";
import { AppError, unauthorized, validationFailed } from "../domain/errors.js";
import { SESSION_COOKIE_NAME } from "../domain/sessions.js";
import { safeReturnTo } from "../domain/authSecurity.js";
import { parseGoogleOAuthCallback } from "./googleOAuthCallback.js";

const password = z.string().min(12).max(256);
const email = z.string().trim().email().max(320);
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const googleCookie = "cz_google_state";
const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success) throw validationFailed("Invalid authentication request.");
  return result.data;
};
export function registerNativeAuthRoutes(app: FastifyInstance, deps: { env: Env; identity: IdentityService; nativeAuth: NativeAuthService; googleAuth: GoogleAuthService; finish: (account: IdentityAccount, request: FastifyRequest, reply: FastifyReply) => Promise<unknown> }) {
  const { env, identity, nativeAuth, googleAuth, finish } = deps;
  const cookieOptions = { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: "lax" as const, path: "/" };
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/auth/")) return;
    reply.header("Cache-Control", "private, no-store");
    // Browser mutations require the fixed frontend origin. Non-browser callers have no ambient cookies unless explicitly provided.
    if (request.method !== "GET" && request.method !== "HEAD") {
      if ((request.headers.origin && request.headers.origin !== new URL(env.FRONTEND_ORIGIN).origin) || request.headers["sec-fetch-site"] === "cross-site") throw new AppError("AUTH_ORIGIN_INVALID", "Invalid request origin.", 403);
    }
    const proxyHeader = request.headers["x-player-hub-proxy-secret"];
    const trustedProxy = Boolean(env.PLAYER_HUB_PROXY_SECRET && typeof proxyHeader === "string" && constantTimeEqual(proxyHeader, env.PLAYER_HUB_PROXY_SECRET));
    if (env.NODE_ENV === "production" && !trustedProxy) throw new AppError("AUTH_PROXY_REQUIRED", "Use the Player Hub website for authentication.", 403);
    const ipHeader = request.headers["x-player-hub-client-ip"];
    const clientIp = trustedProxy && typeof ipHeader === "string" && isIP(ipHeader) ? ipHeader : request.ip;
    await nativeAuth.limit("auth-ip", clientIp, 100);
  });
  async function current(request: FastifyRequest) {
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    if (!sessionToken) throw unauthorized();
    const session = await identity.getSessionForToken(sessionToken);
    if (!session) throw unauthorized();
    return { userId: session.userId, sessionToken };
  }
  app.post("/api/auth/email/signup", async (request, reply) => {
    const body = parse(z.object({ email, password, displayName: z.string().trim().min(2).max(80) }).strict(), request.body);
    return reply.status(202).send(await nativeAuth.signup(body));
  });
  app.post("/api/auth/email/verify", async (request, reply) => {
    const body = parse(z.object({ token }).strict(), request.body);
    return finish(await nativeAuth.verify(body.token), request, reply);
  });
  app.post("/api/auth/email/login", async (request, reply) => {
    const body = parse(z.object({ email, password: z.string().min(1).max(256) }).strict(), request.body);
    return finish(await nativeAuth.login(body.email, body.password), request, reply);
  });
  app.post("/api/auth/password/forgot", async (request) => nativeAuth.forgot(parse(z.object({ email }).strict(), request.body).email));
  app.post("/api/auth/password/reset", async (request, reply) => {
    const body = parse(z.object({ token, password }).strict(), request.body);
    await nativeAuth.reset(body.token, body.password);
    reply.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
    return { ok: true };
  });
  app.get("/api/auth/security", async (request) => nativeAuth.repo.security((await current(request)).userId));
  app.post("/api/auth/password/request-set", async (request) => {
    const session = await current(request);
    return nativeAuth.requestPassword(session.userId, session.sessionToken);
  });
  app.post("/api/auth/password/set", async (request, reply) => {
    const session = await current(request);
    const body = parse(z.object({ token, password }).strict(), request.body);
    return finish(await nativeAuth.setPassword(body.token, body.password, session.userId, session.sessionToken), request, reply);
  });
  app.get("/api/auth/google/start", async (request, reply) => {
    const query = parse(z.object({ returnTo: z.string().max(512).optional() }).strict(), request.query);
    const result = await googleAuth.start(safeReturnTo(query.returnTo));
    reply.setCookie(googleCookie, result.binding, { ...cookieOptions, maxAge: 600 });
    return { authorizationUrl: result.authorizationUrl };
  });
  app.get("/api/auth/google/callback", async (request, reply) => {
    const binding = request.cookies[googleCookie];
    reply.clearCookie(googleCookie, cookieOptions);
    const query = parseGoogleOAuthCallback(request.raw.url ?? request.url);
    let result;
    try { result = await googleAuth.complete(query, binding); }
    catch (error) {
      if (error instanceof AppError) return reply.redirect(`${new URL(env.FRONTEND_ORIGIN).origin}/login?authError=google`);
      throw error;
    }
    // Session fixation protection and host-only cookie through the Vercel proxy.
    await identity.logout(request.cookies[SESSION_COOKIE_NAME]);
    const session = await identity.createSession(result.account.userId);
    reply.setCookie(SESSION_COOKIE_NAME, session.token, { ...cookieOptions, expires: session.expiresAt });
    return reply.redirect(`${new URL(env.FRONTEND_ORIGIN).origin}${result.returnTo}`);
  });
  // Explicit retirement: old browser clients cannot call Wix authentication.
  app.all("/api/auth/direct/*", async () => { throw new AppError("AUTH_ROUTE_RETIRED", "Reload Player Hub to use native authentication.", 410); });
}
