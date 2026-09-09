"use client";

import { Lottie } from "lottie-react";
import { useReducedMotion } from "framer-motion";
import rank1 from "@/assets/lottie/leaderboard/rank1.json";
import rank2 from "@/assets/lottie/leaderboard/rank2.json";
import rank3 from "@/assets/lottie/leaderboard/rank3.json";
import { cn } from "@/lib/utils";

type Placement = 1 | 2 | 3;

const effects: Record<Placement, { animation: string; frame: string; source: object }> = {
  1: {
    animation: "right-2 top-1/2 h-24 w-20 -translate-y-1/2 opacity-90 sm:right-1 sm:h-32 sm:w-28",
    frame: "border-[rgba(232,180,80,0.72)] bg-[rgba(232,180,80,0.08)] shadow-[0_0_26px_rgba(232,180,80,0.18),inset_0_1px_0_rgba(255,255,255,0.08)]",
    source: rank1,
  },
  2: {
    animation: "right-2 top-1/2 h-20 w-[4.5rem] -translate-y-1/2 opacity-80 sm:h-28 sm:w-24",
    frame: "border-[rgba(218,228,240,0.48)] bg-[rgba(218,228,240,0.045)] shadow-[0_0_18px_rgba(218,228,240,0.1)]",
    source: rank2,
  },
  3: {
    animation: "right-2 top-1/2 h-20 w-[4.5rem] -translate-y-1/2 opacity-75 sm:h-24 sm:w-20",
    frame: "border-[rgba(197,139,91,0.5)] bg-[rgba(197,139,91,0.045)] shadow-[0_0_14px_rgba(197,139,91,0.08)]",
    source: rank3,
  },
};

export function LeaderboardPlacementEffect({ placement }: { placement: Placement }) {
  const reduceMotion = useReducedMotion();
  const effect = effects[placement];

  return (
    <>
      <span className={cn("pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]", effect.frame)} aria-hidden="true" />
      <span className={cn("pointer-events-none absolute overflow-hidden", effect.animation)} aria-hidden="true">
        <Lottie
          src={effect.source}
          autoplay={!reduceMotion}
          loop={!reduceMotion}
          rendererSettings={{ preserveAspectRatio: "xMidYMid meet" }}
          className="h-full w-full"
        />
      </span>
    </>
  );
}
