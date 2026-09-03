import type { ProgressionLevel, RankName, Rarity } from "@/types";

export interface ProgressionRankConfig {
  key: string;
  rank: RankName;
  order: number;
  progressionLevel: number;
  xpRequired: number;
  emblemPath: string;
  rarity: Rarity | "mythic";
  rewards: string[];
  theme: {
    primary: string;
    secondary: string;
    metal: string;
  };
  treatment: {
    locked: string;
    unlocked: string;
    current: string;
  };
  isPlaceholderConfig: true;
}

export const progressionRanks: ProgressionRankConfig[] = [
  { key: "peasant", rank: "Peasant", order: 1, progressionLevel: 1, xpRequired: 0, emblemPath: "/ranks/peasant/emblem.svg", rarity: "common", rewards: ["Starter Frame"], theme: { primary: "#93a4b8", secondary: "#334155", metal: "#cbd5e1" }, treatment: { locked: "Shadowed tin sigil", unlocked: "Polished tin sigil", current: "Active tin glow" }, isPlaceholderConfig: true },
  { key: "farmer", rank: "Farmer", order: 2, progressionLevel: 5, xpRequired: 1200, emblemPath: "/ranks/farmer/emblem.svg", rarity: "common", rewards: ["Bronze Badge"], theme: { primary: "#6ee7b7", secondary: "#14532d", metal: "#86efac" }, treatment: { locked: "Seed-mark outline", unlocked: "Harvest enamel", current: "Harvest pulse" }, isPlaceholderConfig: true },
  { key: "squire", rank: "Squire", order: 3, progressionLevel: 10, xpRequired: 3600, emblemPath: "/ranks/squire/emblem.svg", rarity: "rare", rewards: ["Rename Card"], theme: { primary: "#60a5fa", secondary: "#1d4ed8", metal: "#bfdbfe" }, treatment: { locked: "Blue steel outline", unlocked: "Blue steel crest", current: "Blue steel flare" }, isPlaceholderConfig: true },
  { key: "knight", rank: "Knight", order: 4, progressionLevel: 15, xpRequired: 7600, emblemPath: "/ranks/knight/emblem.svg", rarity: "rare", rewards: ["Knight Frame"], theme: { primary: "#38bdf8", secondary: "#0f766e", metal: "#e0f2fe" }, treatment: { locked: "Closed visor", unlocked: "Open visor", current: "Open visor shine" }, isPlaceholderConfig: true },
  { key: "apprentice", rank: "Apprentice", order: 5, progressionLevel: 20, xpRequired: 12800, emblemPath: "/ranks/apprentice/emblem.svg", rarity: "epic", rewards: ["XP Boost"], theme: { primary: "#a78bfa", secondary: "#6d28d9", metal: "#ddd6fe" }, treatment: { locked: "Dim rune", unlocked: "Lit rune", current: "Lit rune orbit" }, isPlaceholderConfig: true },
  { key: "nobleman", rank: "Nobleman", order: 6, progressionLevel: 30, xpRequired: 24000, emblemPath: "/ranks/nobleman/emblem.svg", rarity: "epic", rewards: ["Gold Badge"], theme: { primary: "#fbbf24", secondary: "#92400e", metal: "#fde68a" }, treatment: { locked: "Muted signet", unlocked: "Gold signet", current: "Gold signet glint" }, isPlaceholderConfig: true },
  { key: "master", rank: "Master", order: 7, progressionLevel: 40, xpRequired: 42000, emblemPath: "/ranks/master/emblem.svg", rarity: "legendary", rewards: ["Master Aura"], theme: { primary: "#f472b6", secondary: "#9d174d", metal: "#fbcfe8" }, treatment: { locked: "Sealed mastery mark", unlocked: "Mastery mark", current: "Mastery mark aura" }, isPlaceholderConfig: true },
  { key: "hero", rank: "Hero", order: 8, progressionLevel: 55, xpRequired: 72000, emblemPath: "/ranks/hero/emblem.svg", rarity: "legendary", rewards: ["Hero Coupon"], theme: { primary: "#fb7185", secondary: "#991b1b", metal: "#fecdd3" }, treatment: { locked: "Quiet hero crest", unlocked: "Hero crest", current: "Hero crest blaze" }, isPlaceholderConfig: true },
  { key: "conqueror", rank: "Conqueror", order: 9, progressionLevel: 75, xpRequired: 120000, emblemPath: "/ranks/conqueror/emblem.svg", rarity: "mythic", rewards: ["Conqueror Frame"], theme: { primary: "#facc15", secondary: "#7c2d12", metal: "#fef08a" }, treatment: { locked: "Locked crown crest", unlocked: "Crown crest", current: "Crown crest ignition" }, isPlaceholderConfig: true },
];

export const progressionMap: ProgressionLevel[] = progressionRanks.map(({ progressionLevel, rank, xpRequired, rewards }) => ({
  progressionLevel,
  rank,
  xpRequired,
  rewards,
}));

export function getProgressionRank(progressionLevel: number) {
  return progressionRanks.reduce((current, rank) => (rank.progressionLevel <= progressionLevel ? rank : current), progressionRanks[0]);
}
