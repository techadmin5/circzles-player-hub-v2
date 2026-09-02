import type { ProgressionLevel } from "@/types";

export const progressionMap: ProgressionLevel[] = [
  { progressionLevel: 1, rank: "Peasant", xpRequired: 0, rewards: ["Starter Frame"] },
  { progressionLevel: 5, rank: "Farmer", xpRequired: 1200, rewards: ["Bronze Badge"] },
  { progressionLevel: 10, rank: "Squire", xpRequired: 3600, rewards: ["Rename Card"] },
  { progressionLevel: 15, rank: "Knight", xpRequired: 7600, rewards: ["Knight Frame"] },
  { progressionLevel: 20, rank: "Apprentice", xpRequired: 12800, rewards: ["XP Boost"] },
  { progressionLevel: 30, rank: "Nobleman", xpRequired: 24000, rewards: ["Gold Badge"] },
  { progressionLevel: 40, rank: "Master", xpRequired: 42000, rewards: ["Master Aura"] },
  { progressionLevel: 55, rank: "Hero", xpRequired: 72000, rewards: ["Hero Coupon"] },
  { progressionLevel: 75, rank: "Conqueror", xpRequired: 120000, rewards: ["Conqueror Frame"] },
];
