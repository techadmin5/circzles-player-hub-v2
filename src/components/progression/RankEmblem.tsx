import Image from "next/image";
import { Lock } from "lucide-react";
import type { RankName } from "@/types";
import { rankEmblem } from "@/config/assets";
import { cn } from "@/lib/utils";

export type RankState = "completed" | "current" | "locked";

const AURA_RANKS = new Set(["apprentice", "nobleman", "master", "hero", "conqueror"]);

export function RankEmblem({ rank, state, size = 56 }: { rank: RankName | string; state: RankState; size?: number }) {
  const key = String(rank).toLowerCase();
  const aura = state === "current" && AURA_RANKS.has(key);
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      {aura && <span className="absolute inset-[-18%] animate-pulse rounded-full blur-xl" style={{ background: "radial-gradient(circle, rgba(61,234,212,0.32) 0%, rgba(232,180,80,0.16) 55%, transparent 75%)" }} />}
      <div
        className={cn(
          "relative overflow-hidden rounded-[24%]",
          state === "locked" && "opacity-40 grayscale saturate-0",
          state === "current" && "ring-1 ring-[rgba(61,234,212,0.5)]",
        )}
        style={{ width: size, height: size }}
      >
        <Image src={rankEmblem(rank)} alt={`${rank} progression emblem`} fill sizes={`${size}px`} className="object-contain p-1" />
      </div>
      {state === "locked" && <Lock className="absolute h-4 w-4 text-[var(--cz-text-tertiary)]" />}
    </div>
  );
}
