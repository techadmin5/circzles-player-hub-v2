import { describe, expect, it } from "vitest";
import { generatePublicPlayerId } from "../src/domain/playerId.js";
import { IdentityService } from "../src/domain/identity.js";
import { FakeIdentityRepository } from "./fakes.js";

const secret = "test-session-secret-with-at-least-32-chars";

describe("identity foundation", () => {
  it("generates publicPlayerId values in CZ-XXXXXX format with strong uniqueness", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generatePublicPlayerId()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^CZ-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  });

  it("creates a first-time Wix player", async () => {
    const repo = new FakeIdentityRepository();
    const service = new IdentityService(repo, secret);
    const account = await service.findOrCreateWixIdentity({ wixMemberId: "wix-1", displayName: "Smokey_OP", publicPlayerId: "CZ-8F42KD" });
    expect(account.player.displayName).toBe("Smokey_OP");
    expect(account.player.publicPlayerId).toBe("CZ-8F42KD");
    expect(repo.accounts).toHaveLength(1);
  });

  it("returns an existing Wix player without creating duplicates", async () => {
    const repo = new FakeIdentityRepository();
    const service = new IdentityService(repo, secret);
    const first = await service.findOrCreateWixIdentity({ wixMemberId: "wix-1", displayName: "Smokey_OP" });
    const second = await service.findOrCreateWixIdentity({ wixMemberId: "wix-1", displayName: "OtherName" });
    expect(second.userId).toBe(first.userId);
    expect(second.player.displayName).toBe("Smokey_OP");
    expect(repo.accounts).toHaveLength(1);
  });

  it("resolves a player through a valid session", async () => {
    const repo = new FakeIdentityRepository();
    const service = new IdentityService(repo, secret);
    const account = await service.findOrCreateWixIdentity({ wixMemberId: "wix-1", displayName: "Smokey_OP" });
    const session = await service.createSession(account.userId, new Date("2026-09-01T00:00:00Z"));
    const player = await service.getPlayerForToken(session.token, new Date("2026-09-02T00:00:00Z"));
    expect(player?.publicPlayerId).toBe(account.player.publicPlayerId);
  });

  it("rejects expired sessions", async () => {
    const repo = new FakeIdentityRepository();
    const service = new IdentityService(repo, secret);
    const account = await service.findOrCreateWixIdentity({ wixMemberId: "wix-1", displayName: "Smokey_OP" });
    const session = await service.createSession(account.userId, new Date("2026-09-01T00:00:00Z"));
    const player = await service.getPlayerForToken(session.token, new Date("2026-10-02T00:00:00Z"));
    expect(player).toBeNull();
  });

  it("links verified identities from both Wix sites to one internal player", async () => {
    const repo = new FakeIdentityRepository();
    const service = new IdentityService(repo, secret);
    const first = await service.resolveVerifiedIdentity({ sourceSite: "CIRCZLES_COM", provider: "WIX", externalIdentityId: "com-member", verifiedEmail: "Player@Example.com", emailVerified: true, displayName: "Player" });
    const second = await service.resolveVerifiedIdentity({ sourceSite: "CIRCZLES_IN", provider: "WIX", externalIdentityId: "in-member", verifiedEmail: "player@example.com", emailVerified: true, displayName: "Other" });
    expect(second.userId).toBe(first.userId);
    expect(second.player.internalId).toBe(first.player.internalId);
    expect(repo.accounts).toHaveLength(1);
    expect(repo.accounts[0]?.identities).toHaveLength(2);
  });

  it("fails closed instead of merging unverified or conflicting identities", async () => {
    const repo = new FakeIdentityRepository();
    const service = new IdentityService(repo, secret);
    await service.resolveVerifiedIdentity({ sourceSite: "CIRCZLES_COM", provider: "WIX", externalIdentityId: "member", verifiedEmail: "one@example.com", emailVerified: true });
    await expect(service.resolveVerifiedIdentity({ sourceSite: "CIRCZLES_COM", provider: "WIX", externalIdentityId: "member", verifiedEmail: "two@example.com", emailVerified: true })).rejects.toMatchObject({ code: "IDENTITY_LINK_CONFLICT" });
    await expect(service.resolveVerifiedIdentity({ sourceSite: "CIRCZLES_IN", provider: "WIX", externalIdentityId: "other", verifiedEmail: "one@example.com", emailVerified: false } as never)).rejects.toMatchObject({ code: "VERIFIED_EMAIL_REQUIRED" });
    expect(repo.accounts).toHaveLength(1);
  });

  it("rejects a replayed one-time handoff", async () => {
    const repo = new FakeIdentityRepository();
    const service = new IdentityService(repo, secret);
    const identity = { sourceSite: "CIRCZLES_COM" as const, provider: "WIX" as const, externalIdentityId: "member", verifiedEmail: "one@example.com", emailVerified: true as const, handoff: { tokenIdHash: "handoff-hash", expiresAt: new Date("2026-09-01T00:05:00Z") } };
    await service.resolveVerifiedIdentity(identity, new Date("2026-09-01T00:00:00Z"));
    await expect(service.resolveVerifiedIdentity(identity, new Date("2026-09-01T00:00:01Z"))).rejects.toMatchObject({ code: "AUTH_HANDOFF_ALREADY_USED" });
  });

  it("revokes logout immediately and rolls active sessions after a day", async () => {
    const repo = new FakeIdentityRepository();
    const service = new IdentityService(repo, secret);
    const account = await service.findOrCreateWixIdentity({ wixMemberId: "wix-1" });
    const session = await service.createSession(account.userId, new Date("2026-09-01T00:00:00Z"));
    const refreshed = await service.refreshSession(session.token, new Date("2026-09-03T00:00:00Z"));
    expect(refreshed?.renewed).toBe(true);
    expect(refreshed?.expiresAt.toISOString()).toBe("2026-09-23T00:00:00.000Z");
    expect(await service.logout(session.token, new Date("2026-09-03T00:01:00Z"))).toBe(true);
    expect(await service.getPlayerForToken(session.token, new Date("2026-09-03T00:02:00Z"))).toBeNull();
  });
});
