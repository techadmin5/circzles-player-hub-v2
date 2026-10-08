import { PLAYER_STATE_CHANNEL, PlayerStateEvents } from "../src/domain/playerStateEvents.js";
import { DrizzleSubmissionReviewRepository } from "../src/domain/submissionReviews.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile, readdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import * as s from "../src/db/schema.js";
import type { Database } from "../src/db/client.js";
import { PlayerProfileService } from "../src/domain/playerProfile.js";
import { DrizzleNativeAuthRepository } from "../src/domain/nativeAuthRepository.js";
import { NativeAuthService } from "../src/domain/nativeAuth.js";
import { DevelopmentAuthMailer } from "../src/domain/authEmail.js";
import { DrizzleIdentityRepository, IdentityService, toPlayerDto } from "../src/domain/identity.js";
import { DrizzleInventoryRepository } from "../src/domain/inventory.js";
import { DrizzlePublicProfileRepository } from "../src/domain/publicProfiles.js";
import { DrizzleGameStateRepository } from "../src/domain/gameState.js";
import { DrizzleStorePurchaseRepository } from "../src/domain/storePurchases.js";
import { DrizzleMissionClaimRepository, periodKeyFor } from "../src/domain/missions.js";
import { CloudinaryAvatarStorage, decodeAvatar, MAX_AVATAR_BYTES } from "../src/storage/avatarStorage.js";

let pg: PGlite, db: Database, profiles: PlayerProfileService;
const upload = vi.fn(async (_bytes: Buffer, _mime: string, publicId: string) => ({ publicId, url: `https://res.cloudinary.com/test/image/upload/${publicId}.png` }));
const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
let serial = 0;
async function signup() {
  const mailer = new DevelopmentAuthMailer();
  const service = new NativeAuthService(new DrizzleNativeAuthRepository(db), mailer);
  const password = crypto.randomUUID();
  const email = `profile${++serial}@example.test`;
  await service.signup({ email, password, displayName: "Player" });
  const account = await service.verify(mailer.messages.at(-1)!.token);
  return { account, service, email, password, id: account.player.internalId };
}
async function owned(playerId: string, rewardType: "AVATAR" | "FRAME" | "RENAME_CARD", imageUrl = "/owned-avatar.svg") {
  const [reward] = await db.insert(s.rewardDefinitions).values({ code: crypto.randomUUID(), rewardType, name: rewardType, description: "Test", imageUrl }).returning();
  const [item] = await db.insert(s.playerInventoryItems).values({ playerId, rewardDefinitionId: reward.rewardDefinitionId, quantity: 2 }).returning();
  return item.playerInventoryItemId;
}
beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter((file) => file.endsWith(".sql") && file.slice(0,4) < "0022").sort()) await pg.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  // Historical inventory intent survives; historical identity-provider photos do not become selected photos.
  await pg.exec("INSERT INTO users(user_id,verified_email,email_verified_at,avatar_url) VALUES('20000000-0000-4000-8000-000000000001','legacy@example.test',now(),'https://provider.test/photo'); INSERT INTO players(player_id,user_id,display_name) VALUES('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Legacy')");
  const fixture = drizzle(pg, { schema: s });
  const [reward] = await fixture.insert(s.rewardDefinitions).values({ code: "OLD_AVATAR", rewardType: "AVATAR", name: "Old", description: "Test", imageUrl: "/old-owned.svg" }).returning();
  const [item] = await fixture.insert(s.playerInventoryItems).values({ playerId: "10000000-0000-4000-8000-000000000001", rewardDefinitionId: reward.rewardDefinitionId, quantity: 1 }).returning();
  await fixture.insert(s.playerEquipment).values({ playerId: item.playerId, playerInventoryItemId: item.playerInventoryItemId, slot: "AVATAR" });
  const preserved = (await pg.query("SELECT player_id,user_id,player_number,public_player_id,display_name,created_at,updated_at FROM players")).rows;
  await pg.exec(await readFile(new URL("../drizzle/0022_player_profile_avatar.sql", import.meta.url), "utf8"));
  expect((await pg.query("SELECT player_id,user_id,player_number,public_player_id,display_name,created_at,updated_at FROM players")).rows).toEqual(preserved);
  db = fixture as unknown as Database;
  await new DrizzleGameStateRepository(db).seedProgressionLevels([
    { progressionLevel: 1, rankName: "Peasant", xpRequired: 0, rewards: [] },
    { progressionLevel: 5, rankName: "Farmer", xpRequired: 10, rewards: [] },
    { progressionLevel: 10, rankName: "Squire", xpRequired: 40, rewards: [] },
  ]);
  profiles = new PlayerProfileService(db, { upload });
}, 60_000);
afterAll(async () => { await pg.close(); });

describe("persisted authoritative Player Hub profile", () => {
  it("preserves existing intentional inventory selection across the additive migration", async () => {
    expect(await profiles.read("10000000-0000-4000-8000-000000000001")).toMatchObject({ avatarSource: "INVENTORY_AVATAR", avatar: "/old-owned.svg" });
  });
  it("new native and Google players use the neutral icon, never provider photos or initials", async () => {
    const { id, service, email, password } = await signup();
    expect(await profiles.read(id)).toMatchObject({ avatar: "/brand/avatar.svg", avatarSource: "DEFAULT" });
    const google = await new DrizzleNativeAuthRepository(db).googleAccount(crypto.randomUUID(), `google${++serial}@example.test`, "Google", new Date());
    await db.update(s.users).set({ avatarUrl: "https://provider.test/photo" }).where(eq(s.users.userId, google.userId));
    expect(google.player.avatar).toBe("/brand/avatar.svg");
    expect((await profiles.read(google.player.internalId)).avatar).toBe("/brand/avatar.svg");
    expect((await service.login(email, password)).player.avatar).toBe("/brand/avatar.svg");
  });
  it("persists photo, country/state, default reset and re-selection across refresh/login/new device", async () => {
    const { id, service, email, password, account } = await signup();
    const beforeId = account.player.publicPlayerId;
    await profiles.update(id, { country: " India ", state: " Kerala " });
    const photo = await profiles.uploadAvatar(id, { mimeType: "image/png", base64: png.toString("base64") });
    expect(photo).toMatchObject({ avatarSource: "CUSTOM_UPLOAD", customAvatarAvailable: true, country: "India", state: "Kerala", publicPlayerId: beforeId });
    expect(photo.avatar).toMatch(/^https:\/\/res.cloudinary.com\/test\/image\/upload\/circzles\/profile-avatars\/[0-9a-f-]+\.png$/);
    expect(toPlayerDto((await db.select().from(s.players).where(eq(s.players.playerId, id)))[0], "https://provider.test/override").avatar).toBe(photo.avatar);
    const identity = new IdentityService(new DrizzleIdentityRepository(db), "test-session-secret-with-at-least-32-characters");
    const first = await identity.createSession(account.userId);
    await identity.logout(first.token);
    await service.login(email, password);
    const otherDevice = await identity.createSession(account.userId);
    const reloaded = await identity.getPlayerForToken(otherDevice.token);
    expect(await profiles.read(reloaded!.internalId)).toEqual(photo);
    const publicProfile = await new DrizzlePublicProfileRepository(db).findByPublicPlayerId(beforeId);
    expect(publicProfile?.avatarUrl).toBe(photo.avatar);
    expect(publicProfile).not.toHaveProperty("customAvatarPublicId");
    expect((await profiles.selectAvatar(id, { source: "DEFAULT" })).avatar).toBe("/brand/avatar.svg");
    expect((await profiles.selectAvatar(id, { source: "CUSTOM_UPLOAD" })).avatar).toBe(photo.avatar);
    const replacement = await profiles.uploadAvatar(id, { mimeType: "image/png", base64: png.toString("base64") });
    expect(replacement.avatar).not.toBe(photo.avatar);
    await service.login(email, password);
    expect(await profiles.read(id)).toEqual(replacement);
  });
  it("owned inventory equip/unequip and frame return persisted effective cosmetics, never auto-equip a grant", async () => {
    const { id } = await signup();
    const item = await owned(id, "AVATAR"), frame = await owned(id, "FRAME", "https://assets.test/frame.png");
    expect((await profiles.read(id)).avatar).toBe("/brand/avatar.svg");
    const inventory = new DrizzleInventoryRepository(db);
    await inventory.equip(id, item, "AVATAR"); await inventory.equip(id, frame, "FRAME");
    expect(await profiles.read(id)).toMatchObject({ avatar: "/owned-avatar.svg", avatarSource: "INVENTORY_AVATAR", equippedFrame: "https://assets.test/frame.png" });
    expect((await new DrizzlePublicProfileRepository(db).findByPublicPlayerId((await profiles.read(id)).publicPlayerId))?.avatarUrl).toBe("/owned-avatar.svg");
    await inventory.unequip(id, "AVATAR"); expect((await profiles.read(id)).avatar).toBe("/brand/avatar.svg");
    const other = await signup(); await expect(inventory.equip(other.id, item, "AVATAR")).rejects.toMatchObject({ code: "INVENTORY_ITEM_NOT_FOUND" });
  });
  it("native avatar purchase debits the real wallet, refreshes inventory and equips persistently", async () => {
    const { id, service, email, password } = await signup();
    await new DrizzleGameStateRepository(db).creditPoints({ playerId: id, amount: 100, reason: "TEST", sourceType: "TEST" });
    const [reward] = await db.insert(s.rewardDefinitions).values({ code: crypto.randomUUID(), rewardType: "AVATAR", name: "Purchased Avatar", description: "Test", imageUrl: "/purchased.svg" }).returning();
    const [listing] = await db.insert(s.storeListings).values({ rewardDefinitionId: reward.rewardDefinitionId, priceSynapsePoints: 25 }).returning();
    const result = await new DrizzleStorePurchaseRepository(db).purchase({ playerId: id, listingId: listing.storeListingId, idempotencyKey: crypto.randomUUID() });
    const inventory = new DrizzleInventoryRepository(db);
    const items = await inventory.list(id);
    expect(result.balanceAfter).toBe(75); expect((await profiles.read(id)).synapsePoints).toBe(75);
    expect((await profiles.read(id)).avatar).toBe("/brand/avatar.svg");
    await inventory.equip(id, items.items[0].inventoryItemId, "AVATAR");
    await service.login(email, password);
    expect((await profiles.read(id)).avatar).toBe("/purchased.svg");
  });
  it("a real mission claim crosses backend progression thresholds and hydrates the same XP/SP state", async () => {
    const { id } = await signup(); const now = new Date();
    const [mission] = await db.insert(s.missions).values({ title: "Fixture", description: "Test", category: "ACHIEVEMENT", periodType: "LIFETIME" }).returning();
    await db.insert(s.missionRules).values({ missionId: mission.missionId, eventType: "xp.earned", targetCount: 1 });
    await db.insert(s.missionRewards).values([{ missionId: mission.missionId, rewardType: "XP", amount: 12 }, { missionId: mission.missionId, rewardType: "SYNAPSE_POINTS", amount: 100 }]);
    await db.insert(s.playerMissionProgress).values({ playerId: id, missionId: mission.missionId, periodKey: periodKeyFor("LIFETIME", now, mission.missionId), currentCount: 1, targetCountSnapshot: 1, status: "CLAIMABLE", completedAt: now });
    const result = await new DrizzleMissionClaimRepository(db).claim({ playerId: id, missionId: mission.missionId, idempotencyKey: crypto.randomUUID(), now });
    expect(result.playerState).toMatchObject({ xp: 12, synapsePoints: 100, progressionLevel: 5, rankName: "Farmer" });
    expect(await profiles.read(id)).toMatchObject({ xp: 12, xpNeeded: 40, synapsePoints: 100, progressionLevel: 5, rank: "Farmer" });
  });
  it("external submission approval emits a committed player invalidation with canonical rewarded XP/SP/level/rank", async () => {
    const { id, account } = await signup();
    const [admin] = await db.insert(s.adminUsers).values({ userId: account.userId, role: "SUPER_ADMIN" }).returning();
    const [design] = await db.insert(s.puzzleDesigns).values({ name: "Event fixture" }).returning();
    const [puzzle] = await db.insert(s.puzzles).values({ puzzleDesignId: design.puzzleDesignId, name: "Event fixture", levelId: 1 }).returning();
    const [ownedPuzzle] = await db.insert(s.playerPuzzles).values({ playerId: id, puzzleId: puzzle.puzzleId, source: "TEST" }).returning();
    const [video] = await db.insert(s.videoUploads).values({ playerId: id, storageProvider: "TEST", publicId: crypto.randomUUID(), mimeType: "video/mp4", declaredSizeBytes: 1, status: "COMPLETE", expiresAt: new Date(Date.now()+60_000) }).returning();
    const [submission] = await db.insert(s.submissions).values({ playerId: id, playerPuzzleId: ownedPuzzle.playerPuzzleId, puzzleId: puzzle.puzzleId, levelId: 1, completionTimeMs: 1000, videoUploadId: video.videoUploadId }).returning();
    await db.insert(s.puzzleCompetitionSettings).values({ puzzleId: puzzle.puzzleId, category: "MAIN_LEVEL", displayOrder: 0, rewardEnabled: true, synapseReward: 100, xpReward: 12 });
    const events = new PlayerStateEvents(); events.setReady(true);
    const changed = vi.fn(), otherChanged = vi.fn();
    const off = events.subscribe(id, changed, () => undefined)!;
    const otherOff = events.subscribe(crypto.randomUUID(), otherChanged, () => undefined)!;
    const notifications: string[] = [];
    const stop = await pg.listen(PLAYER_STATE_CHANNEL, (payload) => { notifications.push(payload); events.receive(payload); });
    try {
      const reviews = new DrizzleSubmissionReviewRepository(db);
      const input = { submissionId: submission.submissionId, reviewerAdminUserId: admin.adminUserId, decision: "APPROVED" as const, idempotencyKey: crypto.randomUUID() };
      await reviews.review(input);
      expect(changed).toHaveBeenCalled(); expect(otherChanged).not.toHaveBeenCalled();
      expect(notifications.every((payload) => payload === id)).toBe(true);
      expect(await profiles.read(id)).toMatchObject({ xp: 12, xpNeeded: 40, synapsePoints: 100, progressionLevel: 5, rank: "Farmer" });
      const delivered = changed.mock.calls.length;
      await reviews.review(input); expect(changed.mock.calls.length).toBe(delivered);
      await expect(db.transaction(async (tx) => { await tx.execute((await import("drizzle-orm")).sql`select pg_notify(${PLAYER_STATE_CHANNEL}, ${id})`); throw new Error("rollback"); })).rejects.toThrow("rollback");
      expect(changed.mock.calls.length).toBe(delivered);
      await new DrizzleGameStateRepository(db).grantXp({ playerId: id, amount: 1, reason: "ADMIN_TEST", sourceType: "ADMIN" });
      expect(changed.mock.calls.length).toBeGreaterThan(delivered);
    } finally { await stop(); off(); otherOff(); }
  });
  it("Wix provider photo changes never override a chosen Hub photo", async () => {
    const identity = new IdentityService(new DrizzleIdentityRepository(db), "test-session-secret-with-at-least-32-characters");
    const input = { sourceSite: "CIRCZLES_IN", provider: "WIX", externalIdentityId: crypto.randomUUID(), verifiedEmail: `wix${++serial}@example.test`, emailVerified: true, avatarUrl: "https://provider.test/wix-photo" } as const;
    const account = await identity.resolveVerifiedIdentity(input);
    expect(account.player.avatar).toBe("/brand/avatar.svg");
    const photo = await profiles.uploadAvatar(account.player.internalId, { mimeType: "image/png", base64: png.toString("base64") });
    expect((await identity.resolveVerifiedIdentity({ ...input, avatarUrl: "https://provider.test/new-photo" })).player.avatar).toBe(photo.avatar);
  });
  it("profile name changes preserve Rename Card consumption, atomic fields and permanent Player ID", async () => {
    const { id, service, email, password } = await signup(); const card = await owned(id, "RENAME_CARD"); const before = await profiles.read(id);
    await expect(profiles.update(id, { displayName: "Changed", country: "India" })).rejects.toMatchObject({ code: "RENAME_CARD_REQUIRED" });
    expect((await profiles.read(id)).country).toBe("");
    const key = crypto.randomUUID();
    const updated = await profiles.update(id, { displayName: " Changed ", country: "India", state: "Kerala", inventoryItemId: card }, key);
    expect(updated).toMatchObject({ displayName: "Changed", country: "India", state: "Kerala", publicPlayerId: before.publicPlayerId });
    await profiles.update(id, { displayName: "Changed", country: "India", inventoryItemId: card }, key);
    expect((await db.select().from(s.playerInventoryItems).where(eq(s.playerInventoryItems.playerInventoryItemId, card)))[0].quantity).toBe(1);
    expect((await service.login(email, password)).player.displayName).toBe("Changed");
    expect(await profiles.read(id)).toEqual(updated);
  });
  it.each([{ publicPlayerId: "altered_001" }, { player_number: 99 }, { internalId: crypto.randomUUID() }, { verifiedEmail: "changed@example.test" }, { avatarUrl: "https://attacker.test/photo" }, { displayName: "x" }, { displayName: "bad\nname" }, { country: "x".repeat(101) }, { state: "bad\u0000value" }])("rejects invalid/immutable profile payload %j", async (payload) => {
    const { id } = await signup(); await expect(profiles.update(id, payload)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
  it("hydrates backend-owned wallet/XP/threshold/level/rank after valid rewards across refresh", async () => {
    const { id } = await signup(); const state = new DrizzleGameStateRepository(db);
    await state.creditPoints({ playerId: id, amount: 100, reason: "TEST_REWARD", sourceType: "TEST" });
    await state.grantXp({ playerId: id, amount: 12, reason: "TEST_REWARD", sourceType: "TEST" });
    expect(await profiles.read(id)).toMatchObject({ xp: 12, xpNeeded: 40, progressionLevel: 5, rank: "Farmer", synapsePoints: 100 });
    await state.debitPoints({ playerId: id, amount: 25, reason: "TEST_PURCHASE", sourceType: "TEST" });
    expect((await profiles.read(id)).synapsePoints).toBe(75);
  });
});

describe("profile photo validation/storage boundary", () => {
  it.each([["image/svg+xml", png.toString("base64")], ["image/png", "%%%"], ["image/png", ""], ["image/jpeg", png.toString("base64")], ["image/png", Buffer.alloc(MAX_AVATAR_BYTES+1).toString("base64")]])("rejects invalid type/bytes %s", (mime, base64) => {
    expect(() => decodeAvatar(mime, base64)).toThrow();
  });
  it("keeps SDK credentials server-side, transforms images and rejects failed/malformed decoder results", async () => {
    const storage = new CloudinaryAvatarStorage({ cloudName: "test", apiKey: "private-key", apiSecret: "private-secret" });
    const spy = vi.spyOn(cloudinary.uploader, "upload").mockResolvedValue({ public_id: "circzles/profile-avatars/uuid", version: 1, resource_type: "image", format: "png", width: 512, height: 512, bytes: 100 } as UploadApiResponse);
    try {
      const asset = await storage.upload(png, "image/png", "circzles/profile-avatars/uuid");
      expect(asset.url).toMatch(/^https:\/\/res.cloudinary.com\/test\/image\/upload\//);
      expect(asset).not.toHaveProperty("apiSecret");
      expect(spy.mock.calls[0][1]).toMatchObject({ overwrite: false, resource_type: "image", allowed_formats: ["jpg","png","webp"], transformation: [{ width: 512, height: 512, crop: "limit", flags: "force_strip.strip_profile" }] });
      spy.mockRejectedValueOnce(new Error("decoder rejected malformed image"));
      await expect(storage.upload(png, "image/png", "circzles/profile-avatars/uuid")).rejects.toMatchObject({ code: "AVATAR_UPLOAD_FAILED" });
      spy.mockResolvedValueOnce({ public_id: "unrelated", resource_type: "raw" } as UploadApiResponse);
      await expect(storage.upload(png, "image/png", "circzles/profile-avatars/uuid")).rejects.toMatchObject({ code: "AVATAR_UPLOAD_FAILED" });
    } finally { spy.mockRestore(); }
  });
});
