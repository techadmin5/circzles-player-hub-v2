import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { EventEmitter } from "node:events";
import type pg from "pg";
import type { IdentityService } from "../src/domain/identity.js";
import type { Env } from "../src/config/env.js";
import { PlayerStateEvents, PLAYER_STATE_CHANNEL } from "../src/domain/playerStateEvents.js";
import { PlayerStateListener } from "../src/db/playerStateListener.js";
import { registerPlayerStateEventRoutes } from "../src/http/playerStateEventRoutes.js";

const alice = "10000000-0000-4000-8000-000000000001", bob = "10000000-0000-4000-8000-000000000002";
afterEach(() => vi.useRealTimers());

async function server(options: { production?: boolean; expired?: boolean; heartbeatMs?: number; lifetimeMs?: number } = {}) {
  const app = Fastify(); await app.register(cookie);
  const events = new PlayerStateEvents(); events.setReady(true);
  const identity = {
    getPlayerForToken: vi.fn(async (token?: string) => token === "alice-session" ? { internalId: alice } : null),
    getSessionForToken: vi.fn(async () => options.expired ? null : { userId: "user" }),
  };
  app.setErrorHandler((error, _request, reply) => reply.status((error as { statusCode?: number }).statusCode ?? 500).send({ error: "request rejected" }));
  registerPlayerStateEventRoutes(app, { NODE_ENV: options.production ? "production" : "test", FRONTEND_ORIGIN: "https://hub.test", PLAYER_HUB_PROXY_SECRET: "server-proxy-secret" } as Env,
    identity as unknown as IdentityService, events, { lifetimeMs: options.lifetimeMs ?? 1000, heartbeatMs: options.heartbeatMs ?? 1000 });
  return { app, events, identity };
}

describe("session-scoped SSE invalidations", () => {
  it("isolates subscribers by player and carries only an opaque invalidation ID", () => {
    const events = new PlayerStateEvents(); events.setReady(true);
    const own = vi.fn(), other = vi.fn(), close = vi.fn();
    const off = events.subscribe(alice, own, close)!; events.subscribe(bob, other, close);
    events.receive(alice);
    expect(own).toHaveBeenCalledOnce(); expect(other).not.toHaveBeenCalled();
    expect(Object.keys(own.mock.calls[0][0])).toEqual(["id"]);
    events.receive("invalid-payload"); expect(own).toHaveBeenCalledOnce();
    off(); events.receive(alice); expect(own).toHaveBeenCalledOnce();
    events.setReady(false); expect(close).toHaveBeenCalledOnce();
  });

  it.each([
    ["/api/me/events", {}, false, 401],
    ["/api/me/events?playerId=someone-else", { cookie: "cz_session=alice-session" }, false, 400],
    ["/api/me/events", { cookie: "cz_session=alice-session", origin: "https://evil.test" }, false, 403],
    ["/api/me/events", { cookie: "cz_session=alice-session", "sec-fetch-site": "cross-site" }, false, 403],
    ["/api/me/events", { cookie: "cz_session=alice-session" }, true, 403],
  ] as const)("rejects unauthorized/spoofed stream %s", async (url, headers, production, status) => {
    const { app } = await server({ production });
    try { expect((await app.inject({ url, headers })).statusCode).toBe(status); }
    finally { await app.close(); }
  });

  it("returns 503 during database listener outages and bounds per-player connections", async () => {
    const { app, events } = await server();
    try {
      events.setReady(false);
      expect((await app.inject({ url: "/api/me/events", headers: { cookie: "cz_session=alice-session" } })).statusCode).toBe(503);
      events.setReady(true);
      const off = Array.from({ length: 5 }, () => events.subscribe(alice, () => undefined, () => undefined)!);
      expect((await app.inject({ url: "/api/me/events", headers: { cookie: "cz_session=alice-session" } })).statusCode).toBe(429);
      off.forEach((unsubscribe) => unsubscribe());
    } finally { await app.close(); }
  });

  it("streams an authenticated player's notification through real HTTP before connection completion", async () => {
    const { app, events } = await server({ production: true });
    const url = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    try {
      const response = await fetch(`${url}/api/me/events`, { headers: { cookie: "cz_session=alice-session", "x-player-hub-proxy-secret": "server-proxy-secret" }, signal: controller.signal });
      expect(response.status).toBe(200); expect(response.headers.get("content-type")).toContain("text/event-stream");
      const reader = response.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: ready");
      events.receive(bob); events.receive(alice);
      const frame = new TextDecoder().decode((await reader.read()).value);
      expect(frame).toContain("event: player-state-changed\ndata: {}");
      expect(frame).not.toContain(alice); expect(frame).not.toContain(bob);
      await reader.cancel();
    } finally { controller.abort(); events.setReady(false); await app.close(); }
  });

  it("revalidates sessions while connected and closes expired streams", async () => {
    const { app, events } = await server({ expired: true, heartbeatMs: 20 });
    const url = await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const response = await fetch(`${url}/api/me/events`, { headers: { cookie: "cz_session=alice-session" } });
      const text = await response.text();
      expect(text).toContain("event: ready"); expect(text).toContain("event: session-expired");
    } finally { events.setReady(false); await app.close(); }
  });

  it("rotates streams within the bounded Vercel invocation lifetime", async () => {
    const { app, events } = await server({ lifetimeMs: 20 });
    const url = await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const response = await fetch(`${url}/api/me/events`, { headers: { cookie: "cz_session=alice-session" } });
      expect(await response.text()).toBe("event: ready\ndata: {}\n\n");
    } finally { events.setReady(false); await app.close(); }
  });
});

it("dedicated PostgreSQL listener reconnects with backoff, routes notifications, and stops cleanly", async () => {
  vi.useFakeTimers();
  const events = new PlayerStateEvents(), warn = vi.fn(), changed = vi.fn(), closed = vi.fn();
  events.subscribe(alice, changed, closed);
  const clients: Array<EventEmitter & { connect: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }> = [];
  const listener = new PlayerStateListener("not-logged", events, warn, () => {
    const client = Object.assign(new EventEmitter(), { connect: vi.fn(async () => undefined), query: vi.fn(async () => undefined), end: vi.fn(async () => undefined) });
    clients.push(client); return client as unknown as pg.Client;
  });
  await listener.start(); expect(events.ready).toBe(true); expect(clients[0].query).toHaveBeenCalledWith(`LISTEN ${PLAYER_STATE_CHANNEL}`);
  clients[0].emit("notification", { channel: PLAYER_STATE_CHANNEL, payload: alice }); expect(changed).toHaveBeenCalledOnce();
  clients[0].emit("error", new Error("private connection error")); expect(events.ready).toBe(false); expect(closed).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000); expect(clients).toHaveLength(2); expect(events.ready).toBe(true);
  clients[0].emit("notification", { channel: PLAYER_STATE_CHANNEL, payload: alice }); expect(changed).toHaveBeenCalledOnce();
  await listener.stop(); expect(events.ready).toBe(false);
  await vi.advanceTimersByTimeAsync(60_000); expect(clients).toHaveLength(2); expect(warn).toHaveBeenCalledOnce();
});
