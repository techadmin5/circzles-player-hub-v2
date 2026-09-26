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
  previewScale: number;
  listScale: number;
  previewOffsetX: number;
  previewOffsetY: number;
  listOffsetX: number;
  listOffsetY: number;
}

export const progressionVisuals: Record<string, ProgressionVisual> = {
  peasant: visual("Peasant", peasant, "#d9772d", "#f2b04f", 0.14, 0, 1, 1.36, 1.55),
  farmer: visual("Farmer", farmer, "#388cf2", "#5ce1ff", 0.18, 0, 2, 1.38, 1.55),
  squire: visual("Squire", squire, "#e7493f", "#7ac943", 0.21, 0, 3, 1.28, 1.38, -5.5, 0, -5.5, 0),
  knight: visual("Knight", knight, "#c4c9dc", "#9a6dff", 0.24, 0, 4, 1.12, 1.16),
  apprentice: visual("Apprentice", apprentice, "#f28a2e", "#ffd35a", 0.28, 2, 5, 1.14, 1.16, 0, -5.5, 0, -5.5),
  nobleman: visual("Nobleman", nobleman, "#b846e8", "#ff5abf", 0.31, 2, 6, 1.14, 1.16, 2, -7, 2, -7),
  master: visual("Master", master, "#f0ad32", "#ffd76a", 0.35, 3, 7, 1.42, 1.42, 1, 10, 1, 10),
  hero: visual("Hero", hero, "#e83e45", "#f4b53f", 0.39, 4, 8, 1.14, 1.12, -1, 1, -1, 1),
  conqueror: visual("Conqueror", conqueror, "#ef3f42", "#3dead4", 0.45, 5, 9, 1.08, 1.06, 1, -1.5, 1, -1.5),
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
  previewScale: number,
  listScale: number,
  previewOffsetX = 0,
  previewOffsetY = 0,
  listOffsetX = previewOffsetX,
  listOffsetY = previewOffsetY,
): ProgressionVisual {
  return { rankName, badge, aura, glow, ambientIntensity, particleIntensity, prestigeLevel, previewScale, listScale, previewOffsetX, previewOffsetY, listOffsetX, listOffsetY };
}
