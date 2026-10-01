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

  it("requires first-party production cookie and callback settings", () => {
    const production = {
      ...base,
      NODE_ENV: "production" as const,
      FRONTEND_ORIGIN: "https://circzles-player-hub.vercel.app",
      COOKIE_SECURE: "true",
      SESSION_COOKIE_SAME_SITE: "lax",
      WIX_DIRECT_AUTH_CALLBACK_URL: "https://circzles-player-hub.vercel.app/api/auth/direct/google/callback",
    };
    expect(loadEnv({ ...production, SESSION_COOKIE_DOMAIN: "" })).toMatchObject({
      COOKIE_SECURE: true,
      SESSION_COOKIE_DOMAIN: undefined,
      SESSION_COOKIE_SAME_SITE: "lax",
    });
    expect(() => loadEnv({ ...production, COOKIE_SECURE: "false" })).toThrow(/Secure/);
    expect(() => loadEnv({ ...production, SESSION_COOKIE_SAME_SITE: "none" })).toThrow(/SameSite=Lax/);
    expect(() => loadEnv({ ...production, SESSION_COOKIE_DOMAIN: ".vercel.app" })).toThrow(/host-only/);
    for (const suffix of ["/auth/callback", "/api/auth/direct/google/callback/", "/api/auth/direct/google/callback?extra=1"]) {
      expect(() => loadEnv({ ...production, WIX_DIRECT_AUTH_CALLBACK_URL: `https://circzles-player-hub.vercel.app${suffix}` })).toThrow(/exact Player Hub frontend callback URL/);
    }
    expect(() => loadEnv({ ...production, WIX_DIRECT_AUTH_CALLBACK_URL: "https://circzles-player-hub-api.onrender.com/api/auth/direct/google/callback" })).toThrow(/exact Player Hub frontend callback URL/);
    expect(() => loadEnv({ ...production, WIX_DIRECT_AUTH_CALLBACK_URL: "https://circzles-player-hub.vercel.app/api/auth/direct/wrong-callback" })).toThrow(/exact Player Hub frontend callback URL/);
  });

  it("enforces hosted frontend auth safety even when NODE_ENV was not set to production", () => {
    const hosted = {
      ...base,
      NODE_ENV: "development" as const,
      FRONTEND_ORIGIN: "https://circzles-player-hub.vercel.app",
      COOKIE_SECURE: "true",
      SESSION_COOKIE_SAME_SITE: "lax",
    };
    expect(loadEnv({
      ...hosted,
      WIX_DIRECT_AUTH_CALLBACK_URL: "https://circzles-player-hub.vercel.app/api/auth/direct/google/callback",
    })).toMatchObject({ WIX_DIRECT_AUTH_CALLBACK_URL: "https://circzles-player-hub.vercel.app/api/auth/direct/google/callback" });
    expect(() => loadEnv({
      ...hosted,
      WIX_DIRECT_AUTH_CALLBACK_URL: "https://circzles-player-hub-api.onrender.com/api/auth/direct/google/callback",
    })).toThrow(/exact Player Hub frontend callback URL/);
  });

  it("rejects short handoff secrets", () => {
    expect(() => loadEnv({ ...base, AUTH_HANDOFF_CIRCZLES_COM_SECRET: "too-short" })).toThrow();
  });

  it("normalizes blank optional Wix direct-auth settings and validates configured callback URLs", () => {
    expect(loadEnv({ ...base, WIX_CLIENT_ID: "", WIX_DIRECT_AUTH_CALLBACK_URL: "" })).toMatchObject({
      WIX_CLIENT_ID: undefined,
      WIX_DIRECT_AUTH_CALLBACK_URL: undefined,
    });
    expect(() => loadEnv({ ...base, WIX_CLIENT_ID: "client-id", WIX_DIRECT_AUTH_CALLBACK_URL: "not-a-url" })).toThrow();
    expect(loadEnv({ ...base, WIX_CLIENT_ID: " client-id ", WIX_DIRECT_AUTH_CALLBACK_URL: "https://app.example.test/auth/callback" })).toMatchObject({
      WIX_CLIENT_ID: "client-id",
      WIX_DIRECT_AUTH_CALLBACK_URL: "https://app.example.test/auth/callback",
    });
  });
});
