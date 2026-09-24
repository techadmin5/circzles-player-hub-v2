"use client";

import Image from "next/image";
import { Lock } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import type { RankName } from "@/types";
import { rankEmblem } from "@/config/assets";
import { getRankVisualTreatment } from "@/config/rankVisualHierarchy";
import { useSound } from "@/hooks/useSound";
import { cn } from "@/lib/utils";

export type RankState = "completed" | "current" | "locked";

export function RankEmblem({ rank, state, size = 56 }: { rank: RankName | string; state: RankState; size?: number }) {
  const visual = getRankVisualTreatment(String(rank));
  const systemReduced = useReducedMotion();
  const settingReduced = useSound((sound) => sound.reducedMotion);
  const animated = state === "current" && !systemReduced && !settingReduced;
  const activeBreath = animated && visual.breathe;
  const staticHalo = state === "locked" ? visual.haloOpacity * 0.22 : state === "completed" ? visual.haloOpacity * 0.48 : visual.haloOpacity;

  return (
    <motion.span
      className="relative inline-grid shrink-0 place-items-center isolate"
      style={{ width: size, height: size }}
      animate={activeBreath ? { y: [0, -Math.max(1, visual.tier - 1), 0] } : undefined}
      transition={{ duration: 4.8 - visual.tier * 0.2, repeat: Infinity, ease: "easeInOut" }}
      data-rank-tier={visual.tier}
      data-rank-state={state}
    >
      <motion.span
        aria-hidden="true"
        className="absolute inset-[-18%] rounded-full blur-2xl"
        style={{ background: `radial-gradient(circle, ${visual.primary} 0%, ${visual.secondary} 42%, transparent 72%)`, opacity: staticHalo }}
        animate={activeBreath ? { scale: [0.92, 1.08, 0.92], opacity: [staticHalo * 0.62, staticHalo, staticHalo * 0.62] } : undefined}
        transition={{ duration: 4.6 - visual.tier * 0.18, repeat: Infinity, ease: "easeInOut" }}
      />

      {visual.radialEnergy && state === "current" && <motion.span
        aria-hidden="true"
        className="absolute inset-[-9%] rounded-full border"
        style={{ borderColor: `${visual.primary}55`, boxShadow: `inset 0 0 ${size * 0.16}px ${visual.secondary}22, 0 0 ${size * 0.18}px ${visual.primary}22` }}
        animate={animated ? { rotate: 360, scale: [0.98, 1.03, 0.98] } : undefined}
        transition={{ rotate: { duration: 22 - visual.tier, repeat: Infinity, ease: "linear" }, scale: { duration: 5, repeat: Infinity, ease: "easeInOut" } }}
      />}

      {animated && visual.sparkCount > 0 && Array.from({ length: visual.sparkCount }, (_, index) => <motion.span
        key={index}
        aria-hidden="true"
        className="absolute z-[3] h-1 w-1 rounded-full"
        style={{ background: index % 2 ? visual.secondary : visual.primary, left: `${18 + index * 31}%`, top: `${24 + (index % 2) * 48}%` }}
        animate={{ opacity: [0, 0.7, 0], scale: [0.5, 1, 0.5], y: [3, -6, 3] }}
        transition={{ duration: 3.8 + index * 0.35, repeat: Infinity, delay: index * 0.8, ease: "easeInOut" }}
      />)}

      <span
        className={cn(
          "relative z-[1] overflow-hidden rounded-[24%] border",
          state === "locked" && "opacity-40 grayscale saturate-0",
        )}
        style={{
          width: size,
          height: size,
          borderColor: state === "locked" ? `${visual.primary}26` : `${visual.primary}${toHexAlpha(visual.ringOpacity)}`,
          background: `radial-gradient(circle at 50% 38%, ${visual.primary}12, rgba(7,10,18,0.08) 66%)`,
          boxShadow: state === "current" ? `0 0 0 1px ${visual.primary}26, 0 0 ${size * 0.18}px ${visual.secondary}24` : `inset 0 1px 0 ${visual.primary}18`,
        }}
      >
        <Image src={rankEmblem(rank)} alt={`${rank} progression emblem`} fill sizes={`${size}px`} className="relative z-[1] object-contain p-1" />
        {animated && visual.sheen && <motion.span
          aria-hidden="true"
          className="absolute inset-y-[-20%] z-[2] w-[42%] -skew-x-12 bg-gradient-to-r from-transparent via-white/20 to-transparent blur-[1px]"
          initial={{ x: "-180%" }}
          animate={{ x: "340%" }}
          transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 3.8 - visual.tier * 0.25, ease: "easeInOut" }}
        />}
      </span>
      {state === "locked" && <span className="absolute z-[4] grid h-[34%] w-[34%] min-h-5 min-w-5 place-items-center rounded-full border border-white/10 bg-[rgba(7,10,18,0.88)]"><Lock className="h-[52%] w-[52%] text-[var(--cz-text-tertiary)]" /></span>}
    </motion.span>
  );
}

function toHexAlpha(opacity: number) {
  return Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, "0");
}
