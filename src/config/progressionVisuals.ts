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
}

export const progressionVisuals: Record<string, ProgressionVisual> = {
  peasant: visual("Peasant", peasant, "#d9772d", "#f2b04f", 0.18, 0),
  farmer: visual("Farmer", farmer, "#388cf2", "#5ce1ff", 0.2, 0),
  squire: visual("Squire", squire, "#e7493f", "#7ac943", 0.22, 0),
  knight: visual("Knight", knight, "#c4c9dc", "#9a6dff", 0.25, 0),
  apprentice: visual("Apprentice", apprentice, "#f28a2e", "#ffd35a", 0.28, 2),
  nobleman: visual("Nobleman", nobleman, "#b846e8", "#ff5abf", 0.3, 3),
  master: visual("Master", master, "#f0ad32", "#ffd76a", 0.34, 4),
  hero: visual("Hero", hero, "#e83e45", "#f4b53f", 0.38, 5),
  conqueror: visual("Conqueror", conqueror, "#ef3f42", "#ffc343", 0.44, 6),
};

export const progressionRankNames = ["Peasant", "Farmer", "Squire", "Knight", "Apprentice", "Nobleman", "Master", "Hero", "Conqueror"] as const;

export function getProgressionVisual(rankName: string): ProgressionVisual & { known: boolean } {
  const found = progressionVisuals[normalizeRankName(rankName)];
  return found ? { ...found, known: true } : { ...progressionVisuals.peasant, rankName: rankName || "Unknown Rank", known: false };
}

export function normalizeRankName(rankName: string) {
  return rankName.trim().toLowerCase().replace(/[^a-z]/g, "");
}

function visual(rankName: string, badge: StaticImageData, aura: string, glow: string, ambientIntensity: number, particleIntensity: number): ProgressionVisual {
  return { rankName, badge, aura, glow, ambientIntensity, particleIntensity };
}
