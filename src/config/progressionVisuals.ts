import type { StaticImageData } from "next/image";
import peasant from "@/assets/progression/peasant.png";
import farmer from "@/assets/progression/farmer.png";
import squire from "@/assets/progression/squire.png";
import knight from "@/assets/progression/knight.png";
import apprentice from "@/assets/progression/apprentice.png";
import nobleman from "@/assets/progression/nobleman.png";
import master from "@/assets/progression/master.png";
import hero from "@/assets/progression/hero.png";
import conqueror from "@/assets/progression/conqueror.png";

export interface ProgressionVisual {
  rankName: string;
  badge: StaticImageData;
  aura: string;
  glow: string;
  ambientIntensity: number;
  particleIntensity: number;
  prestigeLevel: number;
  visibleBounds: { x: number; y: number; width: number; height: number };
  previewVisualSize: number;
  listVisualSize: number;
}

export const progressionVisuals: Record<string, ProgressionVisual> = {
  peasant: visual("Peasant", peasant, "#d9772d", "#f2b04f", 0.14, 0, 1, bounds(52, 125, 196, 237)),
  farmer: visual("Farmer", farmer, "#388cf2", "#5ce1ff", 0.18, 0, 2, bounds(45, 120, 189, 226)),
  squire: visual("Squire", squire, "#e7493f", "#7ac943", 0.21, 0, 3, bounds(42, 124, 264, 235)),
  knight: visual("Knight", knight, "#c4c9dc", "#9a6dff", 0.24, 0, 4, bounds(31, 124, 314, 235)),
  apprentice: visual("Apprentice", apprentice, "#f28a2e", "#ffd35a", 0.28, 2, 5, bounds(27, 124, 315, 287)),
  nobleman: visual("Nobleman", nobleman, "#b846e8", "#ff5abf", 0.31, 2, 6, bounds(31, 124, 316, 302)),
  master: visual("Master", master, "#f0ad32", "#ffd76a", 0.35, 3, 7, bounds(74, 80, 239, 268)),
  hero: visual("Hero", hero, "#e83e45", "#f4b53f", 0.39, 4, 8, bounds(42, 90, 338, 314)),
  conqueror: visual("Conqueror", conqueror, "#ef3f42", "#3dead4", 0.45, 5, 9, bounds(59, 80, 358, 356)),
};

export const progressionRankNames = ["Peasant", "Farmer", "Squire", "Knight", "Apprentice", "Nobleman", "Master", "Hero", "Conqueror"] as const;

export function getProgressionVisual(rankName: string): ProgressionVisual & { known: boolean } {
  const found = progressionVisuals[normalizeRankName(rankName)];
  return found ? { ...found, known: true } : { ...progressionVisuals.peasant, rankName: rankName || "Unknown Rank", known: false };
}

export function normalizeRankName(rankName: string) {
  return rankName.trim().toLowerCase().replace(/[^a-z]/g, "");
}

function visual(
  rankName: string,
  badge: StaticImageData,
  aura: string,
  glow: string,
  ambientIntensity: number,
  particleIntensity: number,
  prestigeLevel: number,
  visibleBounds: ProgressionVisual["visibleBounds"],
): ProgressionVisual {
  return { rankName, badge, aura, glow, ambientIntensity, particleIntensity, prestigeLevel, visibleBounds, previewVisualSize: 112, listVisualSize: 30 };
}

function bounds(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}
