import { describe, expect, it } from "vitest";
import { parseGoogleOAuthCallback } from "../src/http/googleOAuthCallback.js";

const state = "A".repeat(43);
const callback = (query: string) => parseGoogleOAuthCallback(`/api/auth/google/callback?${query}`);
const success = `state=${state}&code=authorization-code`;
const issuer = "iss=https%3A%2F%2Faccounts.google.com";

describe("Google OAuth callback parser", () => {
  it.each([
    "",
    `&${issuer}`,
    `&${issuer}&scope=openid%20email%20profile&authuser=0&prompt=consent&hd=example.com`,
    "&foo=bar",
    "&foo=one&foo=two&email=untrusted%40example.com&email_verified=true&sub=untrusted&userId=untrusted",
    "&id_token=browser-token&access_token=browser-token&token_type=Bearer&expires_in=3600",
    "&__proto__=untrusted&constructor=untrusted",
  ])("extracts only state/code and discards extension metadata: %s", (extra) => {
    expect(callback(success + extra)).toEqual({ state, code: "authorization-code" });
  });
  it("extracts a cancellation and bounded diagnostic fields, ignoring unrelated metadata", () => {
    expect(callback(`state=${state}&error=access_denied&error_description=User%20cancelled&error_uri=%2Foauth%2Ferrors%23denied&${issuer}&hd=example.com&foo=bar`)).toEqual({ state, error: "access_denied", error_description: "User cancelled", error_uri: "/oauth/errors#denied" });
  });
  it.each(["state", "code", "error", "iss", "error_description", "error_uri"])("rejects duplicate %s values even when equal", (field) => {
    const values: Record<string, string> = { state, code: "code", error: "access_denied", iss: "https://accounts.google.com", error_description: "cancelled", error_uri: "/errors" };
    const params = new URLSearchParams({ state, ...(field.startsWith("error") ? { error: "access_denied" } : { code: "code" }) });
    if (!params.has(field)) params.append(field, values[field]);
    params.append(field, values[field]);
    expect(() => callback(params.toString())).toThrow("Invalid authentication request.");
  });
  it("rejects duplicates concealed with percent-encoded parameter names", () => {
    expect(() => callback(`${success}&sta%74e=${state}`)).toThrow("Invalid authentication request.");
  });
  it.each([
    "code=code",
    "state=&code=code",
    "state=invalid&code=code",
    `state=${"A".repeat(44)}&code=code`,
    `state=${state}`,
    `state=${state}&code=`,
    `state=${state}&code=${"x".repeat(4097)}`,
    `${success}&error=access_denied`,
    `state=${state}&error=`,
    `state=${state}&error=${"x".repeat(257)}`,
    `state=${state}&error=access_denied&error_description=${"x".repeat(1025)}`,
    `state=${state}&error=access_denied&error_description=bad%0Atext`,
    `state=${state}&error=access_denied&error_uri=${"x".repeat(2049)}`,
    `state=${state}&error=access_denied&error_uri=bad%20uri`,
  ])("rejects missing, malformed or ambiguous protocol fields: %s", (query) => {
    expect(() => callback(query)).toThrow("Invalid authentication request.");
  });
  it.each(["https://evil.example", "https://accounts.google.com/", "https://accounts.google.com.evil.example", "accounts.google.com", "HTTPS://accounts.google.com", "", "not-a-url"])("requires exact equality for issuer %s", (iss) => {
    expect(() => callback(`${success}&iss=${encodeURIComponent(iss)}`)).toThrow("Invalid authentication request.");
  });
});
