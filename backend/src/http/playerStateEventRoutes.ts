import type { FastifyInstance } from "fastify";
import { constantTimeEqual, SESSION_COOKIE_NAME } from "../domain/sessions.js";
import type { IdentityService } from "../domain/identity.js";
import type { Env } from "../config/env.js";
import { AppError, unauthorized, validationFailed } from "../domain/errors.js";
import { PlayerStateEvents } from "../domain/playerStateEvents.js";

export function registerPlayerStateEventRoutes(app: FastifyInstance, env: Env, identity: IdentityService, events: PlayerStateEvents,
  timings = { lifetimeMs: 45_000, heartbeatMs: 10_000 }) {
  app.get("/api/me/events", async (request, reply) => {
    if (Object.keys(request.query as object).length) throw validationFailed("Unexpected event stream parameters.");
    const proxySecret = request.headers["x-player-hub-proxy-secret"];
    if (env.NODE_ENV === "production" && !(env.PLAYER_HUB_PROXY_SECRET && typeof proxySecret === "string" && constantTimeEqual(proxySecret, env.PLAYER_HUB_PROXY_SECRET))) {
      throw new AppError("PLAYER_EVENTS_PROXY_REQUIRED", "Use the Player Hub website.", 403);
    }
    if ((request.headers.origin && request.headers.origin !== new URL(env.FRONTEND_ORIGIN).origin) || request.headers["sec-fetch-site"] === "cross-site") {
      throw new AppError("PLAYER_EVENTS_ORIGIN_INVALID", "Invalid request origin.", 403);
    }
    const token = request.cookies[SESSION_COOKIE_NAME];
    const player = await identity.getPlayerForToken(token);
    if (!player) throw unauthorized();
    if (!events.ready) throw new AppError("PLAYER_EVENTS_UNAVAILABLE", "Player notifications are reconnecting.", 503);

    let closed = false;
    const timers: { lifetime?: ReturnType<typeof setTimeout>; heartbeat?: ReturnType<typeof setInterval> } = {};
    let unsubscribe: (() => void) | null = null;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timers.lifetime); clearInterval(timers.heartbeat); unsubscribe?.();
      reply.raw.off("close", close); reply.raw.off("error", close);
      reply.raw.end();
    };
    const write = (frame: string) => {
      if (closed) return;
      // Small invalidations only; disconnect slow readers rather than buffering indefinitely.
      if (!reply.raw.write(frame)) close();
    };
    unsubscribe = events.subscribe(player.internalId, ({ id }) => write(`id: ${id}\nevent: player-state-changed\ndata: {}\n\n`), close);
    if (!unsubscribe) throw new AppError("PLAYER_EVENTS_CONNECTION_LIMIT", "Too many open Player Hub tabs.", 429);
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store, no-transform", "X-Accel-Buffering": "no" });
    reply.raw.on("close", close); reply.raw.on("error", close);
    timers.lifetime = setTimeout(close, timings.lifetimeMs);
    let checking = false;
    timers.heartbeat = setInterval(() => {
      if (checking || closed) return;
      checking = true;
      void identity.getSessionForToken(token).then((session) => {
        if (!session) { write("event: session-expired\ndata: {}\n\n"); close(); }
        else write(": heartbeat\n\n");
      }).catch(close).finally(() => { checking = false; });
    }, timings.heartbeatMs);
    write("event: ready\ndata: {}\n\n");
  });
}
