import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";

const base = {
  NODE_ENV: "test" as const,
  DATABASE_URL: "postgres://example",
  FRONTEND_ORIGIN: "http://localhost:3000",
  SESSION_SECRET: "test-session-secret-with-at-least-32-chars",
};

describe("authentication environment safety", () => {
  it("requires Secure cookies when SameSite=None is configured", () => {
    expect(() => loadEnv({ ...base, COOKIE_SECURE: "false", SESSION_COOKIE_SAME_SITE: "none" })).toThrow();
    expect(loadEnv({ ...base, COOKIE_SECURE: "true", SESSION_COOKIE_SAME_SITE: "none" })).toMatchObject({ COOKIE_SECURE: true, SESSION_COOKIE_SAME_SITE: "none" });
  });

  it("rejects short handoff secrets", () => {
    expect(() => loadEnv({ ...base, AUTH_HANDOFF_CIRCZLES_COM_SECRET: "too-short" })).toThrow();
  });
});
