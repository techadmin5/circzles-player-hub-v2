import type { ActivityEvent, Coupon, FriendRequest, InventoryItem, LeaderboardEntry, Mission, Player, PlayerProfile, PlayerPuzzle, Puzzle, Season, StoreItem, Submission } from "@/types";

export const currentPlayer: PlayerProfile = {
  internalId: "7d8c75f2-9c70-4fb7-910d-czmock001",
  publicPlayerId: "CZ-8F42KD",
  displayName: "Smokey_OP",
  avatar: "/brand/avatar.svg",
  country: "India",
  state: "Gujarat",
  progressionLevel: 18,
  rank: "Knight",
  xp: 9450,
  xpNeeded: 12800,
  synapsePoints: 18420,
  streak: 12,
  equippedFrame: "Neon Circuit",
  badgeShowcase: ["First Solve", "Top 10", "Sprint Finisher"],
  stats: { ownedPuzzles: 15, completed: 9, approvedAttempts: 21, personalBests: 6, podiums: 3, seasonRank: 18, longestStreak: 24 },
};

export const players: Player[] = [
  currentPlayer,
  { ...currentPlayer, internalId: "p2", publicPlayerId: "CZ-AX91TR", displayName: "PuzzleRaja", rank: "Hero", progressionLevel: 55, xp: 76000, xpNeeded: 120000, synapsePoints: 44100, state: "Maharashtra", streak: 31 },
  { ...currentPlayer, internalId: "p3", publicPlayerId: "CZ-N0V4IQ", displayName: "NovaSolve", rank: "Master", progressionLevel: 42, xp: 45500, xpNeeded: 72000, synapsePoints: 30150, country: "United States", state: "California", streak: 17 },
  { ...currentPlayer, internalId: "p4", publicPlayerId: "CZ-L7MIND", displayName: "MindMint", rank: "Nobleman", progressionLevel: 32, xp: 25000, xpNeeded: 42000, synapsePoints: 22100, state: "Karnataka", streak: 8 },
];

const puzzleNames = ["Lion", "Metamorphosis", "Synthesis", "Mind Map", "Midnight Bazaar", "Abyss", "Peacock", "Colorstrom", "Spiritual Awakening", "Beyond Dreams", "Pluto", "Aapdo Dham", "Gold Fishing", "DNA-Coded Carbon", "Rickshaw"];

export const puzzles: Puzzle[] = puzzleNames.map((name, index) => ({
  id: `puzzle-${index + 1}`,
  name,
  sku: `CZ-${name.replaceAll(" ", "").slice(0, 5).toUpperCase()}-${100 + index}`,
  levelId: (index % 25) + 1,
  image: "/puzzles/placeholder.svg",
  description: `${name} is a CircZles challenge tuned for pattern recognition, patience, and competitive speed solving.`,
}));

export const playerPuzzles: PlayerPuzzle[] = puzzles.map((puzzle, index) => ({
  ...puzzle,
  status: (["READY_TO_SOLVE", "SUBMISSION_PENDING", "APPROVED", "COMPLETED", "OWNED"] as const)[index % 5],
  personalBest: index % 3 === 0 ? `0${index + 2}:${(24 + index).toString().padStart(2, "0")}` : undefined,
  leaderboardRank: index % 2 === 0 ? index + 4 : undefined,
  latestSubmissionStatus: index % 4 === 0 ? "PENDING_REVIEW" : index % 3 === 0 ? "APPROVED" : undefined,
}));

export const submissions: Submission[] = playerPuzzles.slice(0, 8).map((puzzle, index) => ({
  id: `sub-${index + 1}`,
  puzzleId: puzzle.id,
  puzzleName: puzzle.name,
  levelId: puzzle.levelId,
  completionTime: `0${index + 2}:${(18 + index).toString().padStart(2, "0")}`,
  status: (["PENDING_REVIEW", "APPROVED", "REJECTED", "RESUBMISSION_REQUIRED"] as const)[index % 4],
  createdAt: `2026-08-${(20 + index).toString().padStart(2, "0")}`,
  reviewNote: index % 3 === 0 ? "Video angle needs a clearer final-state frame." : undefined,
}));

export const leaderboard: LeaderboardEntry[] = Array.from({ length: 12 }, (_, index) => {
  const player = players[index % players.length];
  return {
    rank: index + 1,
    player,
    time: `0${Math.floor(index / 3) + 1}:${(12 + index * 3).toString().padStart(2, "0")}`,
    puzzle: puzzles[index % puzzles.length].name,
    levelId: puzzles[index % puzzles.length].levelId,
    region: `${player.state}, ${player.country}`,
    isCurrentPlayer: player.publicPlayerId === currentPlayer.publicPlayerId,
  };
});

export const missions: Mission[] = [
  { missionId: "m1", title: "Daily login streak", description: "Check in to keep your streak alive.", category: "DAILY", status: "CLAIMABLE", progress: { current: 1, target: 1 }, rewards: [{ type: "XP", label: "120 XP", value: 120 }, { type: "Synapse Points", label: "250 SP", value: 250 }], startAt: "2026-09-01T00:00:00+05:30", endAt: "2026-09-01T23:59:59+05:30", timeRemaining: "11h 20m", claimable: true },
  { missionId: "m2", title: "Verified speed solve", description: "Submit one approved attempt.", category: "DAILY", status: "ACTIVE", progress: { current: 0, target: 1 }, rewards: [{ type: "Synapse Points", label: "700 SP", value: 700 }], startAt: "2026-09-01T00:00:00+05:30", endAt: "2026-09-01T23:59:59+05:30", timeRemaining: "11h 20m", claimable: false },
  { missionId: "m3", title: "Level 10 hunter", description: "Complete any puzzle with levelId 10.", category: "WEEKLY", status: "ACTIVE", progress: { current: 1, target: 3 }, rewards: [{ type: "Badge", label: "Level Hunter" }], startAt: "2026-08-31T00:00:00+05:30", endAt: "2026-09-06T23:59:59+05:30", timeRemaining: "4d", claimable: false },
  { missionId: "m4", title: "Weekend sprint", description: "Improve two personal bests before Monday.", category: "SPRINT", status: "LOCKED", progress: { current: 0, target: 2 }, rewards: [{ type: "Frame", label: "Sprint Frame" }], startAt: "2026-09-05T00:00:00+05:30", endAt: "2026-09-07T00:00:00+05:30", timeRemaining: "Starts Sat", claimable: false },
];

export const storeItems: StoreItem[] = [
  { id: "s1", name: "Neon Circuit Frame", type: "Frame", cost: 5200, state: "EQUIPPED", rarity: "epic", description: "Electric cyan profile border for verified competitors." },
  { id: "s2", name: "Rename Card", type: "Utility", cost: 3000, state: "BUY", rarity: "rare", description: "Change displayName only. Player IDs remain immutable." },
  { id: "s3", name: "Gold Solve Badge", type: "Badge", cost: 7800, state: "BUY", rarity: "legendary", description: "Showcase badge for podium-level solvers." },
  { id: "s4", name: "10% Shop Coupon", type: "Coupon", cost: 10000, state: "SOLD_OUT", rarity: "epic", description: "Limited promotional coupon." },
];

export const inventory: InventoryItem[] = [
  { id: "i1", name: "Neon Circuit", category: "Frames", state: "Equipped", rarity: "epic" },
  { id: "i2", name: "First Solve", category: "Badges", state: "Owned", rarity: "common" },
  { id: "i3", name: "Rename Card", category: "Rename Cards", state: "Consumable", rarity: "rare" },
  { id: "i4", name: "Sprint Coupon", category: "Coupons", state: "Owned", rarity: "rare" },
];

export const coupons: Coupon[] = [
  { id: "c1", code: "CZ-SPRINT-10", discount: "10%", source: "Weekend Sprint", createdAt: "2026-08-24", expiry: "2026-09-30", status: "ACTIVE" },
  { id: "c2", code: "CZ-START-5", discount: "5%", source: "Signup", createdAt: "2026-07-02", expiry: "2026-08-15", status: "EXPIRED" },
];

export const activity: ActivityEvent[] = [
  { id: "a1", type: "Submission Approved", title: "Metamorphosis verified", detail: "+450 XP and +900 SP", createdAt: "2026-08-29", category: "Competitive" },
  { id: "a2", type: "Frame Equipped", title: "Neon Circuit equipped", detail: "Profile frame updated", createdAt: "2026-08-27", category: "Rewards" },
  { id: "a3", type: "Friend Added", title: "PuzzleRaja joined your circle", detail: "Friends leaderboard unlocked", createdAt: "2026-08-25", category: "Social" },
];

export const friendRequests: FriendRequest[] = [{ id: "fr1", player: players[2], direction: "INCOMING", createdAt: "2026-08-31" }];
export const notifications = activity.map((event, index) => ({ id: `n${index}`, type: event.type, title: event.title, body: event.detail, read: index > 0, createdAt: event.createdAt }));
export const season: Season = { seasonId: "season-2026-monsoon", name: "Monsoon Circuit", artwork: "/seasons/placeholder.svg", startAt: "2026-08-01", endAt: "2026-09-30", status: "ACTIVE", playerRank: 18, rewards: missions[0].rewards, missions };
