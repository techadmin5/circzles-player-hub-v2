import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { AuthHandoffVerifier } from "../src/domain/authHandoff.js";

const comSecret = "com-handoff-secret-with-at-least-32-characters";
const inSecret = "in-handoff-secret-with-at-least-32-characters";
const NOW = 1_790_000_030;
const now = new Date(NOW * 1000);

type Payload = Record<string, unknown>;
const basePayload = (overrides: Payload = {}): Payload => ({
  v: 1,
  iss: "circzles.com",
  aud: "circzles-player-hub",
  sub: "wix-member-1",
  jti: "contract-handoff-id-0001",
  iat: NOW - 10,
  exp: NOW + 110,
  email: "player@example.com",
  emailVerified: true,
  provider: "WIX",
  ...overrides,
});

function b64(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function sign(payload: Payload, secret: string, header: Record<string, unknown> = { alg: "HS256", typ: "CZ-HANDOFF" }) {
  const h = b64(header);
  const p = b64(payload);
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
}

const verifier = () => new AuthHandoffVerifier({ circzlesCom: comSecret, circzlesIn: inSecret });
const invalid = expect.objectContaining({ code: "AUTH_HANDOFF_INVALID" });

describe("Wix → Player Hub handoff contract", () => {
  it("accepts a valid circzles.com handoff", () => {
    expect(verifier().verify(sign(basePayload(), comSecret), now)).toMatchObject({
      sourceSite: "CIRCZLES_COM", externalIdentityId: "wix-member-1", verifiedEmail: "player@example.com",
    });
  });

  it("accepts a valid circzles.in handoff and keeps the source site separate", () => {
    expect(verifier().verify(sign(basePayload({ iss: "circzles.in", sub: "in-member-9" }), inSecret), now)).toMatchObject({
      sourceSite: "CIRCZLES_IN", externalIdentityId: "in-member-9",
    });
  });

  it("rejects a token signed with the wrong secret", () => {
    expect(() => verifier().verify(sign(basePayload(), "x".repeat(40)), now)).toThrowError(invalid);
  });

  it("rejects a circzles.in claim signed with the circzles.com secret (cross-site forgery)", () => {
    expect(() => verifier().verify(sign(basePayload({ iss: "circzles.in" }), comSecret), now)).toThrowError(invalid);
  });

  it("rejects an unknown issuer", () => {
    expect(() => verifier().verify(sign(basePayload({ iss: "evil.example" }), comSecret), now)).toThrowError(invalid);
  });

  it("rejects the wrong audience", () => {
    expect(() => verifier().verify(sign(basePayload({ aud: "another-app" }), comSecret), now)).toThrowError(invalid);
  });

  it("rejects an expired token", () => {
    expect(() => verifier().verify(sign(basePayload({ iat: NOW - 400, exp: NOW - 100 }), comSecret), now)).toThrowError(invalid);
  });

  it("rejects a token issued in the future beyond clock skew", () => {
    expect(() => verifier().verify(sign(basePayload({ iat: NOW + 120, exp: NOW + 200 }), comSecret), now)).toThrowError(invalid);
  });

  it("rejects a lifetime over five minutes and accepts exactly five", () => {
    expect(() => verifier().verify(sign(basePayload({ iat: NOW, exp: NOW + 301 }), comSecret), now)).toThrowError(invalid);
    expect(() => verifier().verify(sign(basePayload({ iat: NOW, exp: NOW + 300 }), comSecret), now)).not.toThrow();
  });

  it("rejects an unverified or missing email-verified claim", () => {
    expect(() => verifier().verify(sign(basePayload({ emailVerified: false }), comSecret), now)).toThrowError(invalid);
    const { emailVerified: _omit, ...withoutClaim } = basePayload();
    void _omit;
    expect(() => verifier().verify(sign(withoutClaim, comSecret), now)).toThrowError(invalid);
  });

  it("rejects a missing or malformed email", () => {
    expect(() => verifier().verify(sign(basePayload({ email: "not-an-email" }), comSecret), now)).toThrowError(invalid);
  });

  it("rejects a short jti so single-use identifiers cannot be guessable", () => {
    expect(() => verifier().verify(sign(basePayload({ jti: "short" }), comSecret), now)).toThrowError(invalid);
  });

  it("rejects unexpected payload fields (no browser-injected identity hints)", () => {
    expect(() => verifier().verify(sign(basePayload({ playerId: "victim" }), comSecret), now)).toThrowError(invalid);
  });

  it("rejects alg=none and a wrong typ header", () => {
    expect(() => verifier().verify(sign(basePayload(), comSecret, { alg: "none", typ: "CZ-HANDOFF" }), now)).toThrowError(invalid);
    expect(() => verifier().verify(sign(basePayload(), comSecret, { alg: "HS256", typ: "JWT" }), now)).toThrowError(invalid);
  });

  it.each([
    ["empty", ""],
    ["one part", "abc"],
    ["two parts", "abc.def"],
    ["empty segment", "abc..def"],
    ["non-base64url characters", "a b.c d.e f"],
    ["four parts", "a.b.c.d"],
    ["not JSON", `${Buffer.from("nope").toString("base64url")}.${Buffer.from("nope").toString("base64url")}.sig`],
    ["oversized", "a".repeat(8193)],
  ])("rejects a malformed token: %s", (_label, token) => {
    expect(() => verifier().verify(token, now)).toThrowError(invalid);
  });

  it("normalises email case", () => {
    expect(verifier().verify(sign(basePayload({ email: "Player@EXAMPLE.com" }), comSecret), now).verifiedEmail).toBe("player@example.com");
  });

  it("reports a controlled error when the issuer's secret is not configured", () => {
    expect(() => new AuthHandoffVerifier({ circzlesCom: comSecret }).verify(sign(basePayload({ iss: "circzles.in" }), inSecret), now))
      .toThrowError(expect.objectContaining({ code: "AUTH_HANDOFF_NOT_CONFIGURED" }));
  });
});
