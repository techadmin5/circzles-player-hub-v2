import { and, countDistinct, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { playerProgression, players, submissions, users } from "../db/schema.js";
import { AppError } from "./errors.js";

export interface PublicPlayerProfileDto {
  publicPlayerId: string;
  displayName: string;
  progressionRank: string;
  approvedPuzzlesSolved: number;
  avatarUrl: null;
  equippedFrame: null;
  displayedBadges: [];
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

    return row ? { ...row, avatarUrl: null, equippedFrame: null, displayedBadges: [] as [] } : null;
  }
}
