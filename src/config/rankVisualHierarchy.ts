export type RankVisualTier = 1 | 2 | 3 | 4 | 5;

export interface RankVisualTreatment {
  tier: RankVisualTier;
  primary: string;
  secondary: string;
  haloOpacity: number;
  ringOpacity: number;
  breathe: boolean;
  sheen: boolean;
  radialEnergy: boolean;
  sparkCount: number;
}

const RANK_VISUALS: Record<string, RankVisualTreatment> = {
  peasant: treatment(1, "#93a4b8", "#334155", 0.08, 0.18),
  farmer: treatment(1, "#6ee7b7", "#14532d", 0.11, 0.22, true),
  squire: treatment(2, "#60a5fa", "#1d4ed8", 0.14, 0.28, true),
  knight: treatment(2, "#38bdf8", "#0f766e", 0.17, 0.34, true, true),
  apprentice: treatment(3, "#a78bfa", "#3dead4", 0.2, 0.38, true, true),
  nobleman: treatment(3, "#fbbf24", "#92400e", 0.22, 0.42, true, true),
  master: treatment(4, "#f472b6", "#8a6dff", 0.25, 0.48, true, true, true),
  hero: treatment(4, "#fb7185", "#e8b450", 0.28, 0.54, true, true, true),
  conqueror: treatment(5, "#facc15", "#3dead4", 0.34, 0.64, true, true, true, 3),
};

export function getRankVisualTreatment(rank: string): RankVisualTreatment {
  return RANK_VISUALS[rank.trim().toLowerCase()] ?? RANK_VISUALS.peasant;
}

function treatment(
  tier: RankVisualTier,
  primary: string,
  secondary: string,
  haloOpacity: number,
  ringOpacity: number,
  breathe = false,
  sheen = false,
  radialEnergy = false,
  sparkCount = 0,
): RankVisualTreatment {
  return { tier, primary, secondary, haloOpacity, ringOpacity, breathe, sheen, radialEnergy, sparkCount };
}
