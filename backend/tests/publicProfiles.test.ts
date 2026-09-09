import { describe, expect, it } from "vitest";
import { PublicProfileService, type PublicPlayerProfileDto, type PublicProfileRepository } from "../src/domain/publicProfiles.js";

interface Attempt {
  publicPlayerId: string;
  puzzleId: string;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "RESUBMISSION_REQUIRED";
}

class ProfileFixtureRepository implements PublicProfileRepository {
  active = true;
  attempts: Attempt[] = [];
  profile = { publicPlayerId: "CZ-8F42KD", displayName: "Smokey_OP", progressionRank: "Peasant" };

  async findByPublicPlayerId(publicPlayerId: string): Promise<PublicPlayerProfileDto | null> {
    if (!this.active || publicPlayerId !== this.profile.publicPlayerId) return null;
    const approvedPuzzles = new Set(this.attempts.filter((attempt) => attempt.publicPlayerId === publicPlayerId && attempt.status === "APPROVED").map((attempt) => attempt.puzzleId));
    return { ...this.profile, approvedPuzzlesSolved: approvedPuzzles.size, avatarUrl: null, equippedFrame: null, displayedBadges: [] };
  }
}

describe("public player profiles", () => {
  it("returns only the safe public profile contract", async () => {
    const profile = await new PublicProfileService(new ProfileFixtureRepository()).getPublicProfile("CZ-8F42KD");
    expect(profile).toEqual({
      publicPlayerId: "CZ-8F42KD",
      displayName: "Smokey_OP",
      progressionRank: "Peasant",
      approvedPuzzlesSolved: 0,
      avatarUrl: null,
      equippedFrame: null,
      displayedBadges: [],
    });
  });

  it("counts distinct approved canonical puzzles once and excludes other statuses", async () => {
    const repo = new ProfileFixtureRepository();
    repo.attempts.push(
      { publicPlayerId: "CZ-8F42KD", puzzleId: "puzzle-1", status: "APPROVED" },
      { publicPlayerId: "CZ-8F42KD", puzzleId: "puzzle-1", status: "APPROVED" },
      { publicPlayerId: "CZ-8F42KD", puzzleId: "puzzle-2", status: "APPROVED" },
      { publicPlayerId: "CZ-8F42KD", puzzleId: "puzzle-3", status: "PENDING_REVIEW" },
      { publicPlayerId: "CZ-8F42KD", puzzleId: "puzzle-4", status: "REJECTED" },
      { publicPlayerId: "CZ-8F42KD", puzzleId: "puzzle-5", status: "RESUBMISSION_REQUIRED" },
    );
    const profile = await new PublicProfileService(repo).getPublicProfile("CZ-8F42KD");
    expect(profile.approvedPuzzlesSolved).toBe(2);
  });

  it("returns controlled PLAYER_NOT_FOUND for unknown or inactive players", async () => {
    const repo = new ProfileFixtureRepository();
    const service = new PublicProfileService(repo);
    await expect(service.getPublicProfile("CZ-UNKNOWN")).rejects.toMatchObject({ code: "PLAYER_NOT_FOUND", statusCode: 404 });
    repo.active = false;
    await expect(service.getPublicProfile("CZ-8F42KD")).rejects.toMatchObject({ code: "PLAYER_NOT_FOUND", statusCode: 404 });
  });
});
