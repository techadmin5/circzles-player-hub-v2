import { activity, coupons, currentPlayer, friendRequests, inventory, leaderboard, missions, notifications, playerPuzzles, players, puzzles, season, storeItems, submissions } from "@/mocks/data";
import type { LeaderboardFilter, RewardWheelResult, Submission } from "@/types";
import { dataMode } from "@/config/dataMode";
import { apiClient } from "@/lib/apiClient";
import { mockDelay } from "./mockRuntime";

export const playerService = {
  async getCurrentPlayer() {
    if (dataMode === "api") return apiClient.getMe();
    await mockDelay();
    return currentPlayer;
  },
  async getProfile(playerId: string) { await mockDelay(); return players.find((p) => p.publicPlayerId === playerId) ?? currentPlayer; },
  async renameDisplayName(displayName: string) { await mockDelay(); return { ...currentPlayer, displayName }; },
};

export const puzzleService = {
  async getOwnedPuzzles() { await mockDelay(); return playerPuzzles; },
  async getPuzzle(id: string) { await mockDelay(); return playerPuzzles.find((p) => p.id === id) ?? playerPuzzles[0]; },
  async claimBySku(sku: string) { await mockDelay(); return { success: sku.trim().length > 3, puzzle: playerPuzzles[0] }; },
};

export const submissionService = {
  async getSubmissions() { await mockDelay(); return submissions; },
  async getSubmission(id: string) { await mockDelay(); return submissions.find((s) => s.id === id) ?? submissions[0]; },
  async createSubmission(input: Pick<Submission, "puzzleId" | "completionTime">) { await mockDelay(); return { id: "sub-new", status: "PENDING_REVIEW" as const, ...input }; },
};

export const leaderboardService = { async getLeaderboard(filters?: Partial<LeaderboardFilter>) { await mockDelay(); void filters; return { entries: leaderboard, yourRank: 18 }; } };
export const missionService = { async getMissions() { await mockDelay(); return missions; }, async claimMission(missionId: string) { await mockDelay(); return { missionId, status: "CLAIMED" as const, awarded: missions[0].rewards }; } };
export const storeService = { async getItems() { await mockDelay(); return storeItems; }, async purchaseItem(itemId: string) { await mockDelay(); return { itemId, resultingBalance: currentPlayer.synapsePoints - 3000, state: "OWNED" as const }; } };
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
