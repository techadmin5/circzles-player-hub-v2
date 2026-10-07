import type { RankName, Rarity } from "@/types";

/**
 * Replaceable asset maps. Final professional artwork will be dropped into these
 * same public paths later WITHOUT any code changes required.
 */

export const DEFAULT_AVATAR = "/brand/avatar.svg";

export const RANK_EMBLEM: Record<string, string> = {
  peasant: "/ranks/peasant/emblem.svg",
  farmer: "/ranks/farmer/emblem.svg",
  squire: "/ranks/squire/emblem.svg",
  knight: "/ranks/knight/emblem.svg",
  apprentice: "/ranks/apprentice/emblem.svg",
  nobleman: "/ranks/nobleman/emblem.svg",
  master: "/ranks/master/emblem.svg",
  hero: "/ranks/hero/emblem.svg",
  conqueror: "/ranks/conqueror/emblem.svg",
};

export function rankEmblem(rank: RankName | string): string {
  return RANK_EMBLEM[String(rank).toLowerCase()] ?? RANK_EMBLEM.peasant;
}

export const FRAME_ASSETS: Record<string, string | undefined> = {
  "Neon Circuit": "/ui-lab/claude/frames/circuit-cyan.svg",
  "Competitor Silver": "/ui-lab/claude/frames/competitor-silver.svg",
  "Champion Gold": "/ui-lab/claude/frames/champion-gold.svg",
  "Starter Frame": undefined,
};

export function frameAsset(name?: string): string | undefined {
  if (!name) return undefined;
  if (name.startsWith("/") || name.startsWith("https://")) return name;
  return FRAME_ASSETS[name];
}

export interface AvatarAsset {
  id: string;
  label: string;
  src: string;
  group: "CircZles Avatars" | "Unlocked";
  locked?: boolean;
}

export const AVATAR_ASSETS: AvatarAsset[] = [
  { id: "aqua-circuit", label: "Aqua Circuit", src: "/ui-lab/avatars/aqua-circuit.svg", group: "CircZles Avatars" },
  { id: "solar-solver", label: "Solar Solver", src: "/ui-lab/avatars/solar-solver.svg", group: "CircZles Avatars" },
  { id: "violet-node", label: "Violet Node", src: "/ui-lab/avatars/violet-node.svg", group: "CircZles Avatars" },
  { id: "silver-focus", label: "Silver Focus", src: "/ui-lab/avatars/silver-focus.svg", group: "Unlocked" },
  { id: "champion-mark", label: "Champion Mark", src: "/ui-lab/avatars/champion-mark.svg", group: "Unlocked" },
];

export const BADGE_ICON: Record<string, string> = {
  "First Solve": "/ui-lab/claude/badges/first-solve.svg",
  "Top 10": "/ui-lab/claude/badges/top-10.svg",
  "Sprint Finisher": "/ui-lab/claude/badges/streak-keeper.svg",
  "Streak Keeper": "/ui-lab/claude/badges/streak-keeper.svg",
  "Hidden Gem": "/ui-lab/claude/badges/hidden-gem.svg",
  "Expert Puzzler": "/ui-lab/claude/badges/expert-puzzler.svg",
  "Event Winner": "/ui-lab/claude/badges/event-winner.svg",
};

export function badgeIcon(name: string): string | undefined {
  return BADGE_ICON[name];
}

export interface AchievementDef {
  name: string;
  description: string;
  rarity: Rarity;
}

/** Presentation catalog for the Achievements showcase (placeholder metadata). */
export const ACHIEVEMENT_CATALOG: AchievementDef[] = [
  { name: "First Solve", description: "Complete your first verified solve.", rarity: "common" },
  { name: "Top 10", description: "Reach the top 10 on any leaderboard.", rarity: "rare" },
  { name: "Sprint Finisher", description: "Finish a weekend sprint mission.", rarity: "rare" },
  { name: "Streak Keeper", description: "Maintain a 14-day solving streak.", rarity: "epic" },
  { name: "Expert Puzzler", description: "Complete 25 approved attempts.", rarity: "epic" },
  { name: "Event Winner", description: "Place #1 in a live CircZles event.", rarity: "legendary" },
  { name: "Hidden Gem", description: "Discover a hidden ecosystem reward.", rarity: "legendary" },
];

export const RARITY_META: Record<Rarity, { label: string; color: string; ring: string }> = {
  common: { label: "Common", color: "var(--cz-text-secondary)", ring: "var(--cz-hairline-strong)" },
  rare: { label: "Rare", color: "var(--cz-blue)", ring: "rgba(76,141,255,0.55)" },
  epic: { label: "Epic", color: "var(--cz-violet)", ring: "rgba(138,109,255,0.55)" },
  legendary: { label: "Legendary", color: "var(--cz-gold)", ring: "rgba(232,180,80,0.6)" },
};

export const PLACEMENT_TONE = (placement: number) =>
  placement === 1 ? "var(--cz-gold)" : placement === 2 ? "var(--cz-silver)" : placement === 3 ? "var(--cz-bronze)" : "var(--cz-text-tertiary)";
