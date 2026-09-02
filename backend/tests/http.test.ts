import { describe, expect, it } from "vitest";
import { buildApp } from "../src/http/app.js";
import { IdentityService } from "../src/domain/identity.js";
import { FakeIdentityRepository } from "./fakes.js";
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

describe("http auth poc", () => {
  it("GET /api/me requires authentication", async () => {
    const app = buildApp({ env: env(), identity: new IdentityService(new FakeIdentityRepository(), env().SESSION_SECRET), checkDb: async () => {} });
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHORIZED");
  });

  it("development login creates a session and GET /api/me returns the player", async () => {
    const testEnv = env({ NODE_ENV: "development" });
    const app = buildApp({ env: testEnv, identity: new IdentityService(new FakeIdentityRepository(), testEnv.SESSION_SECRET), checkDb: async () => {} });
    const login = await app.inject({ method: "POST", url: "/api/dev/login" });
    expect(login.statusCode).toBe(200);
    expect(login.json().publicPlayerId).toBe("CZ-8F42KD");
    const cookie = login.headers["set-cookie"];
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: Array.isArray(cookie) ? cookie[0] : cookie ?? "" } });
    expect(me.statusCode).toBe(200);
    expect(me.json().displayName).toBe("Smokey_OP");
  });

  it("production cannot use development login", async () => {
    const testEnv = env({ NODE_ENV: "production", COOKIE_SECURE: true });
    const app = buildApp({ env: testEnv, identity: new IdentityService(new FakeIdentityRepository(), testEnv.SESSION_SECRET), checkDb: async () => {} });
    const res = await app.inject({ method: "POST", url: "/api/dev/login" });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("health checks the database connection hook", async () => {
    let checked = false;
    const testEnv = env();
    const app = buildApp({ env: testEnv, identity: new IdentityService(new FakeIdentityRepository(), testEnv.SESSION_SECRET), checkDb: async () => { checked = true; } });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(checked).toBe(true);
  });
});
