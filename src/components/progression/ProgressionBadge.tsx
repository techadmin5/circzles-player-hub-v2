"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { useSound } from "@/hooks/useSound";
import { getProgressionVisual } from "@/config/progressionVisuals";
import { cn } from "@/lib/utils";

const sizes = { xs: 38, sm: 56, md: 88, lg: 150, hero: 220 } as const;

export function ProgressionBadge({ rankName, size = "md", animated = false, className, decorative = false }: { rankName: string; size?: keyof typeof sizes; animated?: boolean; className?: string; decorative?: boolean }) {
  const visual = getProgressionVisual(rankName);
  const systemReduced = useReducedMotion();
  const settingReduced = useSound((state) => state.reducedMotion);
  const reduced = systemReduced || settingReduced;
  const pixels = sizes[size];
  const shouldAnimate = animated && !reduced;

  return <motion.span className={cn("relative inline-grid shrink-0 place-items-center", className)} style={{ width: pixels, height: pixels }} animate={shouldAnimate ? { y: [0, -5, 0] } : undefined} transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut" }} aria-hidden={decorative || undefined}>
    <motion.span className="absolute inset-[10%] rounded-full blur-2xl" style={{ background: visual.aura, opacity: visual.ambientIntensity }} animate={shouldAnimate ? { scale: [0.92, 1.08, 0.92], opacity: [visual.ambientIntensity * 0.7, visual.ambientIntensity, visual.ambientIntensity * 0.7] } : undefined} transition={{ duration: 3.8, repeat: Infinity, ease: "easeInOut" }} />
    {visual.particleIntensity > 0 && shouldAnimate && Array.from({ length: visual.particleIntensity }, (_, index) => <motion.span key={index} className="absolute h-1 w-1 rounded-full" style={{ background: index % 2 ? visual.glow : visual.aura, left: `${18 + index * 13}%`, top: `${22 + (index % 3) * 24}%` }} animate={{ opacity: [0, 0.8, 0], scale: [0.5, 1.2, 0.5], y: [5, -9, 5] }} transition={{ duration: 2.8 + index * 0.2, repeat: Infinity, delay: index * 0.35 }} />)}
    <Image src={visual.badge} alt={decorative ? "" : `${visual.rankName} progression badge`} className="relative z-[1] h-full w-full object-contain drop-shadow-[0_10px_18px_rgba(0,0,0,0.45)]" sizes={`${pixels}px`} priority={size === "hero"} />
  </motion.span>;
}
