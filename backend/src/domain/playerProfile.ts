import { and, count, countDistinct, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { leaderboardEntries, playerEquipment, playerInventoryItems, playerPuzzles, players, rewardDefinitions, submissions } from "../db/schema.js";
import { AppError, validationFailed } from "./errors.js";
import { DrizzleGameStateRepository, getPlayerGameStateInTransaction } from "./gameState.js";
import { toPlayerDto } from "./identity.js";
import { effectiveAvatar } from "./playerAvatar.js";
import { normalizeDisplayName, renameDisplayNameInTransaction } from "./playerIdentityActions.js";
import { decodeAvatar, MAX_AVATAR_BYTES, avatarMimeTypes, type AvatarStorage } from "../storage/avatarStorage.js";

const location = z.string().trim().max(100).refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "Location must not contain control characters.");
export const profileUpdateSchema = z.object({ displayName: z.string().max(128).optional(), country: location.optional(), state: location.optional(), inventoryItemId: z.string().uuid().optional() }).strict().refine((value) => value.displayName !== undefined || value.country !== undefined || value.state !== undefined, "Provide a profile field.");
export const photoUploadSchema = z.object({ mimeType: z.enum(avatarMimeTypes), base64: z.string().min(1).max(4 * Math.ceil(MAX_AVATAR_BYTES / 3)) }).strict();
export const avatarSelectionSchema = z.object({ source: z.enum(["DEFAULT", "CUSTOM_UPLOAD"]) }).strict();

export class PlayerProfileService {
  constructor(private db: Database, private storage: AvatarStorage) {}
  async read(playerId: string) {
    await new DrizzleGameStateRepository(this.db).ensurePlayerGameState(playerId);
    return this.db.transaction(async (tx) => {
      // A repeatable snapshot prevents wallet, progression and profile being mixed across reads.
      await tx.execute(sql`set transaction isolation level repeatable read`);
      const [row] = await tx.select().from(players).where(eq(players.playerId, playerId));
      if (!row) throw new AppError("PLAYER_NOT_FOUND", "Player was not found.", 404);
      const state = await getPlayerGameStateInTransaction(tx, playerId);
      const equipped = await tx.select({ slot: playerEquipment.slot, name: rewardDefinitions.name, imageUrl: rewardDefinitions.imageUrl }).from(playerEquipment)
        .innerJoin(playerInventoryItems, and(eq(playerEquipment.playerInventoryItemId, playerInventoryItems.playerInventoryItemId), eq(playerInventoryItems.playerId, playerId)))
        .innerJoin(rewardDefinitions, eq(rewardDefinitions.rewardDefinitionId, playerInventoryItems.rewardDefinitionId)).where(eq(playerEquipment.playerId, playerId));
      const [owned] = await tx.select({ value: count() }).from(playerPuzzles).where(eq(playerPuzzles.playerId, playerId));
      const [approved] = await tx.select({ attempts: count(), puzzles: countDistinct(submissions.puzzleId) }).from(submissions).where(and(eq(submissions.playerId, playerId), eq(submissions.status, "APPROVED")));
      const [bests] = await tx.select({ value: count() }).from(leaderboardEntries).where(eq(leaderboardEntries.playerId, playerId));
      return { ...toPlayerDto(row),
        avatar: effectiveAvatar(row.avatarSource, row.customAvatarUrl, equipped.find((item) => item.slot === "AVATAR")?.imageUrl),
        equippedFrame: equipped.find((item) => item.slot === "FRAME")?.imageUrl ?? "",
        badgeShowcase: equipped.filter((item) => item.slot.startsWith("BADGE_")).map((item) => item.imageUrl ?? item.name),
        synapsePoints: state.synapsePoints, xp: state.totalXp, xpNeeded: state.xpNeeded, progressionLevel: state.progressionLevel, rank: state.rankName,
        stats: { ownedPuzzles: owned.value, completed: approved.puzzles, approvedAttempts: approved.attempts, personalBests: bests.value, podiums: 0, seasonRank: 0, longestStreak: 0 },
      };
    });
  }
  async update(playerId: string, input: unknown, idempotencyKey?: string) {
    const parsed = profileUpdateSchema.safeParse(input);
    if (!parsed.success) throw validationFailed("Invalid profile update.", parsed.error.flatten());
    const value = parsed.data;
    const displayName = value.displayName === undefined ? undefined : normalizeDisplayName(value.displayName);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${playerId}:display-name`}, 0))`);
      const [row] = await tx.select().from(players).where(eq(players.playerId, playerId)).for("update");
      if (!row) throw new AppError("PLAYER_NOT_FOUND", "Player was not found.", 404);
      if (displayName !== undefined && displayName !== row.displayName) {
        if (!value.inventoryItemId || !idempotencyKey?.trim() || idempotencyKey.length > 200) throw new AppError("RENAME_CARD_REQUIRED", "Changing your display name requires an owned Rename Card.", 409);
        await renameDisplayNameInTransaction(tx, { playerId, displayName, inventoryItemId: value.inventoryItemId, idempotencyKey: idempotencyKey.trim() });
      }
      await tx.update(players).set({ country: value.country, state: value.state, updatedAt: new Date() }).where(eq(players.playerId, playerId));
    });
    return this.read(playerId);
  }
  async selectAvatar(playerId: string, input: unknown) {
    const parsed = avatarSelectionSchema.safeParse(input);
    if (!parsed.success) throw validationFailed("Invalid avatar selection.");
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${playerId}:equipment`}, 0))`);
      const [row] = await tx.select().from(players).where(eq(players.playerId, playerId)).for("update");
      if (!row) throw new AppError("PLAYER_NOT_FOUND", "Player was not found.", 404);
      if (parsed.data.source === "CUSTOM_UPLOAD" && !row.customAvatarUrl) throw new AppError("AVATAR_PHOTO_NOT_FOUND", "Upload your photo first.", 409);
      await tx.delete(playerEquipment).where(and(eq(playerEquipment.playerId, playerId), eq(playerEquipment.slot, "AVATAR")));
      await tx.update(players).set({ avatarSource: parsed.data.source, updatedAt: new Date() }).where(eq(players.playerId, playerId));
    });
    return this.read(playerId);
  }
  async uploadAvatar(playerId: string, input: unknown) {
    const parsed = photoUploadSchema.safeParse(input);
    if (!parsed.success) throw validationFailed("Invalid photo upload.");
    const bytes = decodeAvatar(parsed.data.mimeType, parsed.data.base64);
    const publicId = `circzles/profile-avatars/${crypto.randomUUID()}`;
    const asset = await this.storage.upload(bytes, parsed.data.mimeType, publicId);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${playerId}:equipment`}, 0))`);
      await tx.delete(playerEquipment).where(and(eq(playerEquipment.playerId, playerId), eq(playerEquipment.slot, "AVATAR")));
      await tx.update(players).set({ avatarSource: "CUSTOM_UPLOAD", customAvatarUrl: asset.url, customAvatarPublicId: asset.publicId, updatedAt: new Date() }).where(eq(players.playerId, playerId));
    });
    return this.read(playerId);
  }
}
