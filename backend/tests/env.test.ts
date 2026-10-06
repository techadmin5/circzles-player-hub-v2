import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";

const base = {
  NODE_ENV: "test" as const,
  DATABASE_URL: "postgres://example",
  FRONTEND_ORIGIN: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "test-client",
  GOOGLE_CLIENT_SECRET: "test-secret",
  GOOGLE_AUTH_CALLBACK_URL: "http://localhost:3000/api/auth/google/callback",
  AUTH_EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "test-key",
  AUTH_EMAIL_FROM: "auth@example.test",
  PLAYER_HUB_PROXY_SECRET: "test-proxy-secret-with-at-least-32-chars",
  SESSION_SECRET: "test-session-secret-with-at-least-32-chars",
};

describe("authentication environment safety", () => {
  it("requires Secure cookies when SameSite=None is configured", () => {
    expect(() => loadEnv({ ...base, COOKIE_SECURE: "false", SESSION_COOKIE_SAME_SITE: "none" })).toThrow();
    expect(loadEnv({ ...base, COOKIE_SECURE: "true", SESSION_COOKIE_SAME_SITE: "none" })).toMatchObject({ COOKIE_SECURE: true, SESSION_COOKIE_SAME_SITE: "none" });
  });

  it("requires first-party production cookie and callback settings", () => {
    const production = {
      ...base,
      NODE_ENV: "production" as const,
      FRONTEND_ORIGIN: "https://circzles-player-hub.vercel.app",
      COOKIE_SECURE: "true",
      SESSION_COOKIE_SAME_SITE: "lax",
      GOOGLE_AUTH_CALLBACK_URL: "https://circzles-player-hub.vercel.app/api/auth/google/callback",
    };
    expect(loadEnv({ ...production, SESSION_COOKIE_DOMAIN: "" })).toMatchObject({
      COOKIE_SECURE: true,
      SESSION_COOKIE_DOMAIN: undefined,
      SESSION_COOKIE_SAME_SITE: "lax",
    });
    expect(() => loadEnv({ ...production, COOKIE_SECURE: "false" })).toThrow(/Secure/);
    expect(() => loadEnv({ ...production, SESSION_COOKIE_SAME_SITE: "none" })).toThrow(/SameSite=Lax/);
    expect(() => loadEnv({ ...production, SESSION_COOKIE_DOMAIN: ".vercel.app" })).toThrow(/host-only/);
    for (const suffix of ["/auth/callback", "/api/auth/google/callback/", "/api/auth/google/callback?extra=1"]) {
      expect(() => loadEnv({ ...production, GOOGLE_AUTH_CALLBACK_URL: `https://circzles-player-hub.vercel.app${suffix}` })).toThrow(/exact frontend/);
    }
    expect(() => loadEnv({ ...production, GOOGLE_AUTH_CALLBACK_URL: "https://circzles-player-hub-api.onrender.com/api/auth/google/callback" })).toThrow(/exact frontend/);
    expect(() => loadEnv({ ...production, GOOGLE_AUTH_CALLBACK_URL: "https://circzles-player-hub.vercel.app/api/auth/wrong-callback" })).toThrow(/exact frontend/);
  });

  it("enforces hosted frontend auth safety even when NODE_ENV was not set to production", () => {
    const hosted = {
      ...base,
      NODE_ENV: "development" as const,
      GOOGLE_AUTH_CALLBACK_URL: "https://circzles-player-hub.vercel.app/api/auth/google/callback",
      FRONTEND_ORIGIN: "https://circzles-player-hub.vercel.app",
      COOKIE_SECURE: "true",
      SESSION_COOKIE_SAME_SITE: "lax",
    };
    expect(loadEnv({
      ...hosted,
      GOOGLE_AUTH_CALLBACK_URL: "https://circzles-player-hub.vercel.app/api/auth/google/callback",
    })).toMatchObject({ GOOGLE_AUTH_CALLBACK_URL: "https://circzles-player-hub.vercel.app/api/auth/google/callback" });
    expect(() => loadEnv({
      ...hosted,
      GOOGLE_AUTH_CALLBACK_URL: "https://circzles-player-hub-api.onrender.com/api/auth/google/callback",
    })).toThrow(/exact frontend/);
  });

  it("rejects short handoff secrets", () => {
    expect(() => loadEnv({ ...base, AUTH_HANDOFF_CIRCZLES_COM_SECRET: "too-short" })).toThrow();
  });

  it("requires complete Google configuration and production email delivery", () => {
    expect(loadEnv({ ...base, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", GOOGLE_AUTH_CALLBACK_URL: "" })).toMatchObject({ GOOGLE_CLIENT_ID: undefined });
    expect(() => loadEnv({ ...base, GOOGLE_CLIENT_ID: "test", GOOGLE_AUTH_CALLBACK_URL: "" })).toThrow(/all Google/);
    expect(() => loadEnv({ ...base, NODE_ENV: "production", COOKIE_SECURE: "true", AUTH_EMAIL_PROVIDER: "development" })).toThrow(/requires Resend/);
  });
});
