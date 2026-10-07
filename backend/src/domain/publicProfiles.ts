import { and, countDistinct, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { playerEquipment, playerInventoryItems, playerProgression, players, rewardDefinitions, submissions, users } from "../db/schema.js";
import { AppError } from "./errors.js";
import { effectiveAvatar } from "./playerAvatar.js";

export interface PublicPlayerProfileDto {
  publicPlayerId: string;
  displayName: string;
  progressionRank: string;
  approvedPuzzlesSolved: number;
  avatarUrl: string | null;
  equippedFrame: string | null;
  displayedBadges: string[];
}

export interface PublicProfileRepository {
  findByPublicPlayerId(publicPlayerId: string): Promise<PublicPlayerProfileDto | null>;
}

export class PublicProfileService {
  constructor(private repo: PublicProfileRepository) {}

  async getPublicProfile(publicPlayerId: string) {
    const profile = await this.repo.findByPublicPlayerId(publicPlayerId);
    if (!profile) throw new AppError("PLAYER_NOT_FOUND", "Player was not found.", 404);
    return profile;
  }
}

export class DrizzlePublicProfileRepository implements PublicProfileRepository {
  constructor(private db: Database) {}

  async findByPublicPlayerId(publicPlayerId: string) {
    const [row] = await this.db.select({
      publicPlayerId: players.publicPlayerId,
      playerId: players.playerId,
      avatarSource: players.avatarSource,
      customAvatarUrl: players.customAvatarUrl,
      displayName: players.displayName,
      progressionRank: playerProgression.rankName,
      approvedPuzzlesSolved: countDistinct(submissions.puzzleId).mapWith(Number),
    })
      .from(players)
      .innerJoin(users, eq(players.userId, users.userId))
      .innerJoin(playerProgression, eq(playerProgression.playerId, players.playerId))
      .leftJoin(submissions, and(eq(submissions.playerId, players.playerId), eq(submissions.status, "APPROVED")))
      .where(and(eq(players.publicPlayerId, publicPlayerId), eq(users.status, "ACTIVE")))
      .groupBy(players.playerId, players.publicPlayerId, players.displayName, playerProgression.rankName)
      .limit(1);

    if (!row) return null;
    const equipped = await this.db.select({ slot: playerEquipment.slot, name: rewardDefinitions.name, imageUrl: rewardDefinitions.imageUrl })
      .from(playerEquipment)
      .innerJoin(playerInventoryItems, eq(playerEquipment.playerInventoryItemId, playerInventoryItems.playerInventoryItemId))
      .innerJoin(rewardDefinitions, eq(playerInventoryItems.rewardDefinitionId, rewardDefinitions.rewardDefinitionId))
      .where(eq(playerEquipment.playerId, row.playerId));
    const avatarUrl = effectiveAvatar(row.avatarSource, row.customAvatarUrl, equipped.find((item) => item.slot === "AVATAR")?.imageUrl);
    const equippedFrame = equipped.find((item) => item.slot === "FRAME")?.name ?? null;
    const displayedBadges = (["BADGE_1", "BADGE_2", "BADGE_3"] as const).flatMap((slot) => equipped.find((item) => item.slot === slot)?.name ?? []);
    return { publicPlayerId: row.publicPlayerId, displayName: row.displayName, progressionRank: row.progressionRank, approvedPuzzlesSolved: row.approvedPuzzlesSolved, avatarUrl, equippedFrame, displayedBadges };
  }
}
