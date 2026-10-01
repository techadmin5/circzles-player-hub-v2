import { resolve } from "path";
import { pathToFileURL } from "url";
import { describe, expect, it } from "vitest";
import { AuthHandoffVerifier } from "../src/domain/authHandoff.js";

// Guards the copy-paste Wix Velo template in docs/wix-player-hub-handoff against drifting from the verifier.
const coreUrl = pathToFileURL(resolve(__dirname, "../../docs/wix-player-hub-handoff/shared/playerHubHandoffCore.js")).href;
const comSecret = "com-handoff-secret-with-at-least-32-characters";
const inSecret = "in-handoff-secret-with-at-least-32-characters";
const now = new Date("2026-10-01T06:00:00Z");
const verifier = new AuthHandoffVerifier({ circzlesCom: comSecret, circzlesIn: inSecret });

const member = {
  id: "f32cbc51-a331-442b-86c2-2c664613e8b9",
  status: "APPROVED",
  loginEmail: "Claude.Morales@example.com",
  loginEmailVerified: true,
  profile: { nickname: "Claude Morales", photo: { url: "//static.wixstatic.com/media/a27d24_0dd318~mv2.jpg" } },
  contact: { firstName: "Claude", lastName: "Morales" },
};

async function core() {
  return await import(coreUrl) as {
    buildHandoffClaims: (m: unknown, o: Record<string, unknown>) => Record<string, unknown>;
    signHandoff: (c: Record<string, unknown>, s: string) => string;
    HandoffRefusal: new (code: string, message: string) => Error & { code: string };
  };
}

describe("Wix Velo handoff template ↔ Player Hub verifier", () => {
  it("produces a token the real verifier accepts for circzles.com", async () => {
    const { buildHandoffClaims, signHandoff } = await core();
    const token = signHandoff(buildHandoffClaims(member, { issuer: "circzles.com", now }), comSecret);
    expect(verifier.verify(token, now)).toMatchObject({
      sourceSite: "CIRCZLES_COM",
      externalIdentityId: member.id,
      verifiedEmail: "claude.morales@example.com",
      displayName: "Claude Morales",
      avatarUrl: "https://static.wixstatic.com/media/a27d24_0dd318~mv2.jpg",
    });
  });

  it("produces a token the real verifier accepts for circzles.in", async () => {
    const { buildHandoffClaims, signHandoff } = await core();
    const token = signHandoff(buildHandoffClaims(member, { issuer: "circzles.in", now }), inSecret);
    expect(verifier.verify(token, now).sourceSite).toBe("CIRCZLES_IN");
  });

  it("omits empty optional fields instead of sending strings the strict schema rejects", async () => {
    const { buildHandoffClaims, signHandoff } = await core();
    const bare = { id: "m-1", status: "APPROVED", loginEmail: "bare@example.com", loginEmailVerified: true, profile: { nickname: "   " }, contact: {} };
    const token = signHandoff(buildHandoffClaims(bare, { issuer: "circzles.com", now }), comSecret);
    expect(verifier.verify(token, now)).toMatchObject({ verifiedEmail: "bare@example.com", displayName: undefined, avatarUrl: undefined });
  });

  it("normalizes legacy Velo profile aliases without weakening member verification", async () => {
    const { buildHandoffClaims, signHandoff } = await core();
    const legacy = { _id: "legacy-1", status: "APPROVED", loginEmail: "legacy@example.com", loginEmailVerified: true, profile: { nickname: "Legacy", profilePhoto: { url: "//static.wixstatic.com/media/legacy.jpg" } }, contactDetails: { firstName: "Legacy", lastName: "Member" } };
    const token = signHandoff(buildHandoffClaims(legacy, { issuer: "circzles.com", now }), comSecret);
    expect(verifier.verify(token, now)).toMatchObject({ externalIdentityId: "legacy-1", verifiedEmail: "legacy@example.com", firstName: "Legacy", lastName: "Member" });
  });

  it("uses a unique jti per handoff and a lifetime well under the five-minute cap", async () => {
    const { buildHandoffClaims } = await core();
    const a = buildHandoffClaims(member, { issuer: "circzles.com", now });
    const b = buildHandoffClaims(member, { issuer: "circzles.com", now });
    expect(a.jti).not.toBe(b.jti);
    expect((a.exp as number) - (a.iat as number)).toBeLessThanOrEqual(120);
  });

  it("requires authoritative member-level email verification", async () => {
    const { buildHandoffClaims } = await core();
    expect(() => buildHandoffClaims({ ...member, loginEmailVerified: false }, { issuer: "circzles.com", now })).toThrowError(expect.objectContaining({ code: "EMAIL_NOT_VERIFIED" }));
    const { loginEmailVerified: _omit, ...withoutVerification } = member;
    expect(() => buildHandoffClaims(withoutVerification, { issuer: "circzles.com", now })).toThrowError(expect.objectContaining({ code: "EMAIL_NOT_VERIFIED" }));
  });

  it.each(["PENDING", "BLOCKED", undefined])("refuses members with status %s", async (status) => {
    const { buildHandoffClaims } = await core();
    expect(() => buildHandoffClaims({ ...member, status }, { issuer: "circzles.com", now })).toThrowError(expect.objectContaining({ code: "MEMBER_NOT_ELIGIBLE" }));
  });

  it("refuses a missing member, missing email, unknown issuer, and short secrets", async () => {
    const { buildHandoffClaims, signHandoff } = await core();
    const options = { issuer: "circzles.com", now };
    expect(() => buildHandoffClaims(undefined, options)).toThrowError(expect.objectContaining({ code: "NOT_LOGGED_IN" }));
    expect(() => buildHandoffClaims({ ...member, loginEmail: "" }, options)).toThrowError(expect.objectContaining({ code: "NO_LOGIN_EMAIL" }));
    expect(() => buildHandoffClaims(member, { ...options, issuer: "evil.example" })).toThrowError(expect.objectContaining({ code: "BAD_ISSUER_CONFIG" }));
    expect(() => signHandoff(buildHandoffClaims(member, options), "short")).toThrowError(expect.objectContaining({ code: "SECRET_NOT_CONFIGURED" }));
  });

  it("never lets a circzles.com token verify against the circzles.in secret", async () => {
    const { buildHandoffClaims, signHandoff } = await core();
    const token = signHandoff(buildHandoffClaims(member, { issuer: "circzles.com", now }), inSecret);
    expect(() => verifier.verify(token, now)).toThrowError(expect.objectContaining({ code: "AUTH_HANDOFF_INVALID" }));
  });
});
