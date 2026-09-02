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
    const player = await service.getPlayerForToken(session.token, new Date("2026-09-20T00:00:00Z"));
    expect(player).toBeNull();
  });
});
