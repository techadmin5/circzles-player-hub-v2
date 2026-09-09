"use client";

import { Lottie } from "lottie-react";
import { useReducedMotion } from "framer-motion";
import leaderboardEnergy from "@/assets/lottie/leaderboard-energy.json";
import { cn } from "@/lib/utils";

type Placement = 1 | 2 | 3;

const effects: Record<Placement, { animation: string; frame: string }> = {
  1: {
    animation: "scale-125 opacity-90",
    frame: "border-[rgba(232,180,80,0.72)] bg-[rgba(232,180,80,0.08)] shadow-[0_0_26px_rgba(232,180,80,0.18),inset_0_1px_0_rgba(255,255,255,0.08)]",
  },
  2: {
    animation: "scale-110 opacity-55 grayscale",
    frame: "border-[rgba(218,228,240,0.48)] bg-[rgba(218,228,240,0.045)] shadow-[0_0_18px_rgba(218,228,240,0.1)]",
  },
  3: {
    animation: "scale-100 opacity-40 sepia",
    frame: "border-[rgba(197,139,91,0.5)] bg-[rgba(197,139,91,0.045)] shadow-[0_0_14px_rgba(197,139,91,0.08)]",
  },
};

export function LeaderboardPlacementEffect({ placement }: { placement: Placement }) {
  const reduceMotion = useReducedMotion();
  const effect = effects[placement];

  return (
    <>
      <span className={cn("pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]", effect.frame)} aria-hidden="true" />
      <span className={cn("pointer-events-none absolute inset-0 grid place-items-center overflow-hidden rounded-[inherit]", effect.animation)} aria-hidden="true">
        <Lottie
          src={leaderboardEnergy}
          autoplay={!reduceMotion}
          loop={!reduceMotion}
          rendererSettings={{ preserveAspectRatio: "xMidYMid slice" }}
          className="h-full w-full"
        />
      </span>
    </>
  );
}
