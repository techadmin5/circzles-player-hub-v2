import { activity, coupons, currentPlayer, friendRequests, inventory, leaderboard, missions, notifications, playerPuzzles, players, puzzles, season, storeItems, submissions } from "@/mocks/data";
import type { ApiStoreCatalogItem, LeaderboardCatalog, LeaderboardResponse, MissionClaimResult, PublicPlayerProfile, RewardWheelResult, StoreItem } from "@/types";
import { dataMode } from "@/config/dataMode";
import { apiClient, ApiClientError } from "@/lib/apiClient";
import { mockDelay } from "./mockRuntime";

const canUseBrowserApi = () => dataMode === "api" && typeof window !== "undefined";

export const playerService = {
  async getCurrentPlayer() {
    if (dataMode === "api") return apiClient.getMe();
    await mockDelay();
    return currentPlayer;
  },
  async getMockCurrentPlayer() {
    await mockDelay();
    return currentPlayer;
  },
  async getProfile(playerId: string) { await mockDelay(); return players.find((p) => p.publicPlayerId === playerId) ?? currentPlayer; },
  async getPublicProfile(publicPlayerId: string, signal?: AbortSignal): Promise<PublicPlayerProfile> {
    if (canUseBrowserApi()) return apiClient.getPublicPlayerProfile(publicPlayerId, signal);
    await mockDelay();
    const player = players.find((item) => item.publicPlayerId === publicPlayerId) ?? (currentPlayer.publicPlayerId === publicPlayerId ? currentPlayer : null);
    if (!player) throw new ApiClientError("PLAYER_NOT_FOUND", "Player was not found.", 404);
    return {
      publicPlayerId: player.publicPlayerId,
      displayName: player.displayName,
      progressionRank: player.rank,
      approvedPuzzlesSolved: 4,
      avatarUrl: null,
      equippedFrame: null,
      displayedBadges: [],
    };
  },
  async renameDisplayName(displayName: string) { await mockDelay(); return { ...currentPlayer, displayName }; },
};

export const puzzleService = {
  async getOwnedPuzzles() {
    if (canUseBrowserApi()) return apiClient.getOwnedPuzzles();
    await mockDelay();
    return playerPuzzles;
  },
  async getPuzzle(id: string) {
    if (canUseBrowserApi()) return apiClient.getPuzzle(id);
    await mockDelay();
    return playerPuzzles.find((p) => p.id === id) ?? playerPuzzles[0];
  },
  async claimByCode(code: string) {
    if (canUseBrowserApi()) return apiClient.claimPuzzleByCode(code);
    await mockDelay();
    return { success: code.trim().length > 3, puzzle: playerPuzzles[0] };
  },
};

export const submissionService = {
  async getSubmissions() { if (canUseBrowserApi()) return apiClient.getSubmissions(); await mockDelay(); return submissions; },
  async getSubmission(id: string) { if (canUseBrowserApi()) return apiClient.getSubmission(id); await mockDelay(); return submissions.find((s) => s.id === id) ?? submissions[0]; },
  async createSubmission(input: { playerPuzzleId: string; completionTimeMs: number; videoUploadId: string }, idempotencyKey: string) { if (canUseBrowserApi()) return apiClient.createSubmission(input, idempotencyKey); await mockDelay(); return { ...submissions[0], id: "sub-new", status: "PENDING_REVIEW" as const, ...input }; },
};

const mockLeaderboardCatalog: LeaderboardCatalog = {
  mainLevels: [
    { puzzleId: "10000000-0000-4000-8000-000000000001", puzzleName: "Metamorphosis", runCode: "R1", levelId: 1, category: "MAIN_LEVEL", displayOrder: 1 },
    { puzzleId: "10000000-0000-4000-8000-000000000002", puzzleName: "Serpentine", runCode: "R1", levelId: 2, category: "MAIN_LEVEL", displayOrder: 2 },
    { puzzleId: "10000000-0000-4000-8000-000000000003", puzzleName: "Metamorphosis", runCode: "R2", levelId: 3, category: "MAIN_LEVEL", displayOrder: 3 },
  ],
  sideQuests: [
    { puzzleId: "20000000-0000-4000-8000-000000000001", puzzleName: "Midnight Circuit", runCode: "SQ1", levelId: 3.5, category: "SIDE_QUEST", displayOrder: 1 },
  ],
};

function mockLeaderboardResponse(puzzleId: string): LeaderboardResponse {
  const puzzle = [...mockLeaderboardCatalog.mainLevels, ...mockLeaderboardCatalog.sideQuests].find((item) => item.puzzleId === puzzleId) ?? mockLeaderboardCatalog.mainLevels[0];
  return {
    puzzle,
    entries: leaderboard.slice(0, 10).map((entry, index) => ({
      rank: index + 1,
      publicPlayerId: entry.player.publicPlayerId,
      displayName: entry.player.displayName,
      bestTimeMs: 72_420 + index * 3_017,
      bestTime: `0${Math.floor((72_420 + index * 3_017) / 60_000)}:${String(Math.floor(((72_420 + index * 3_017) % 60_000) / 1000)).padStart(2, "0")}.${String((72_420 + index * 3_017) % 1000).padStart(3, "0")}`,
      isCurrentPlayer: index === 4,
    })),
    currentPlayerEntry: null,
  };
}

export const leaderboardService = {
  async getLeaderboardCatalog(signal?: AbortSignal) { if (canUseBrowserApi()) return apiClient.getLeaderboardCatalog(signal); await mockDelay(); return mockLeaderboardCatalog; },
  async getLeaderboard(puzzleId: string, signal?: AbortSignal) { if (canUseBrowserApi()) return apiClient.getLeaderboard(puzzleId, signal); await mockDelay(); return mockLeaderboardResponse(puzzleId); },
  async getMockLeaderboard() { await mockDelay(); return { entries: leaderboard, yourRank: 18 }; },
};
export const missionService = {
  async getMissions(signal?: AbortSignal) {
    if (canUseBrowserApi()) return apiClient.getMissions(signal);
    await mockDelay();
    return missions;
  },
  async claimMission(missionId: string, idempotencyKey: string): Promise<MissionClaimResult> {
    if (canUseBrowserApi()) return apiClient.claimMission(missionId, idempotencyKey);
    await mockDelay();
    const mission = missions.find((item) => item.missionId === missionId);
    const synapsePoints = mission?.rewards.filter((reward) => reward.type === "Synapse Points").reduce((total, reward) => total + (reward.value ?? 0), 0) ?? 0;
    const xp = mission?.rewards.filter((reward) => reward.type === "XP").reduce((total, reward) => total + (reward.value ?? 0), 0) ?? 0;
    return {
      missionClaimId: `mock-${missionId}`,
      missionId,
      periodKey: mission?.periodKey ?? "mock",
      status: "CLAIMED",
      claimedAt: new Date().toISOString(),
      idempotent: false,
      awarded: { synapsePoints, xp },
      playerState: { synapsePoints: currentPlayer.synapsePoints + synapsePoints, xp: currentPlayer.xp + xp, progressionLevel: currentPlayer.progressionLevel, rankName: currentPlayer.rank },
    };
  },
};
export const storeService = {
  async getItems(signal?: AbortSignal) {
    if (canUseBrowserApi()) return (await apiClient.getStoreCatalog(signal)).map(adaptStoreCatalogItem);
    await mockDelay();
    return storeItems;
  },
  async purchaseItem(itemId: string) { await mockDelay(); return { itemId, resultingBalance: currentPlayer.synapsePoints - 3000, state: "OWNED" as const }; },
};

function adaptStoreCatalogItem(item: ApiStoreCatalogItem): StoreItem {
  const type: StoreItem["type"] = item.rewardType === "FRAME" ? "Frame" : item.rewardType === "BADGE" ? "Badge" : item.rewardType === "COUPON" ? "Coupon" : "Utility";
  const rarity = item.rarity?.toLowerCase();
  return {
    id: item.listingId,
    name: item.name,
    type,
    cost: item.priceSynapsePoints,
    state: "COMING_SOON",
    rarity: rarity === "rare" || rarity === "epic" || rarity === "legendary" ? rarity : "common",
    description: item.description,
  };
}
export const inventoryService = { async getInventory() { await mockDelay(); return inventory; }, async equipItem(itemId: string) { await mockDelay(); return { itemId, state: "Equipped" as const }; } };
export const couponService = { async getCoupons() { await mockDelay(); return coupons; } };
export const activityService = { async getActivity() { await mockDelay(); return activity; } };
export const friendService = { async getFriends() { await mockDelay(); return players.slice(1).map((player) => ({ player, since: "2026-08-01" })); }, async searchPlayers(query: string) { await mockDelay(); return players.filter((p) => `${p.publicPlayerId} ${p.displayName}`.toLowerCase().includes(query.toLowerCase())); }, async sendRequest(playerId: string) { await mockDelay(); return { playerId, status: "SENT" }; }, async getRequests() { await mockDelay(); return friendRequests; } };
export const notificationService = { async getNotifications() { await mockDelay(); return notifications; }, async markAllRead() { await mockDelay(); return true; } };
export const seasonService = { async getCurrentSeason() { await mockDelay(); return season; } };
export const rewardService = { async spinWheel(): Promise<RewardWheelResult> { await mockDelay(); return { rewardId: "rw-coin-700", rewardType: "Synapse Points", rewardLabel: "700 Synapse Points", rewardValue: 700, resultingBalance: currentPlayer.synapsePoints + 700, wheelSegmentIndex: 3 }; } };
export const adminService = {
  async getOverview() { await mockDelay(); return { players: players.length, pendingSubmissions: 8, activeMissions: 12, rewardsDistributed: 18400, season: season.name }; },
  async getPlayers() { await mockDelay(); return players; },
  async getSubmissions() { await mockDelay(); return submissions; },
  async getPuzzles() { await mockDelay(); return puzzles; },
  async getMissions() { await mockDelay(); return missions; },
  async getStoreItems() { await mockDelay(); return storeItems; },
  async getLeaderboardEntries() { await mockDelay(); return leaderboard; },
  async getCurrentSeason() { await mockDelay(); return season; },
  async getNotifications() { await mockDelay(); return notifications; },
  async reviewSubmission(submissionId: string, action: "approve" | "reject" | "resubmission") { await mockDelay(); return { submissionId, action }; },
};
