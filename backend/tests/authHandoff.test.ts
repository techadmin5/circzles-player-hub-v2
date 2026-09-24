import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { AuthHandoffVerifier } from "../src/domain/authHandoff.js";

const comSecret = "com-handoff-secret-with-at-least-32-characters";
const inSecret = "in-handoff-secret-with-at-least-32-characters";

describe("production authentication handoff", () => {
  it("verifies a short-lived signed identity without trusting client-selected source data", () => {
    const verifier = new AuthHandoffVerifier({ circzlesCom: comSecret, circzlesIn: inSecret });
    const token = sign({ iss: "circzles.in", sub: "wix-in-member", email: "Player@Example.com", jti: "handoff-identifier-001", iat: 1_790_000_000, exp: 1_790_000_120 }, inSecret);
    expect(verifier.verify(token, new Date(1_790_000_030_000))).toMatchObject({
      sourceSite: "CIRCZLES_IN",
      externalIdentityId: "wix-in-member",
      verifiedEmail: "player@example.com",
      tokenId: "handoff-identifier-001",
    });
  });

  it("rejects tampering, expiry, excessive lifetimes, and unconfigured issuers", () => {
    const verifier = new AuthHandoffVerifier({ circzlesCom: comSecret });
    const valid = sign({ iss: "circzles.com", sub: "member", email: "p@example.com", jti: "handoff-identifier-002", iat: 1_790_000_000, exp: 1_790_000_120 }, comSecret);
    const [header, payload, signature] = valid.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, "base64url").toString()), sub: "victim" })).toString("base64url");
    expect(() => verifier.verify(`${header}.${tamperedPayload}.${signature}`, new Date(1_790_000_030_000))).toThrowError(expect.objectContaining({ code: "AUTH_HANDOFF_INVALID" }));
    expect(() => verifier.verify(valid, new Date(1_790_000_121_000))).toThrowError(expect.objectContaining({ code: "AUTH_HANDOFF_INVALID" }));
    const long = sign({ iss: "circzles.com", sub: "member", email: "p@example.com", jti: "handoff-identifier-003", iat: 1_790_000_000, exp: 1_790_000_301 }, comSecret);
    expect(() => verifier.verify(long, new Date(1_790_000_030_000))).toThrowError(expect.objectContaining({ code: "AUTH_HANDOFF_INVALID" }));
    const inToken = sign({ iss: "circzles.in", sub: "member", email: "p@example.com", jti: "handoff-identifier-004", iat: 1_790_000_000, exp: 1_790_000_120 }, inSecret);
    expect(() => verifier.verify(inToken, new Date(1_790_000_030_000))).toThrowError(expect.objectContaining({ code: "AUTH_HANDOFF_NOT_CONFIGURED" }));
  });
});

function sign(input: { iss: "circzles.com" | "circzles.in"; sub: string; email: string; jti: string; iat: number; exp: number }, secret: string) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "CZ-HANDOFF" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ v: 1, aud: "circzles-player-hub", emailVerified: true, provider: "WIX", ...input })).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}
