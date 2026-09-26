"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { useSound } from "@/hooks/useSound";
import { getProgressionVisual } from "@/config/progressionVisuals";
import { cn } from "@/lib/utils";

const sizes = { xs: 38, sm: 56, md: 88, lg: 150, xl: 190, hero: 220 } as const;
type BadgePresentation = "default" | "preview" | "list";

export function ProgressionBadge({ rankName, size = "md", presentation = "default", animated = false, muted = false, className, decorative = false }: { rankName: string; size?: keyof typeof sizes; presentation?: BadgePresentation; animated?: boolean; muted?: boolean; className?: string; decorative?: boolean }) {
  const visual = getProgressionVisual(rankName);
  const systemReduced = useReducedMotion();
  const settingReduced = useSound((state) => state.reducedMotion);
  const reduced = systemReduced || settingReduced;
  const pixels = sizes[size];
  const shouldAnimate = animated && !reduced && !muted;
  const activePreview = animated && presentation === "preview" && !muted;
  const auraOpacity = Math.min(0.62, (visual.ambientIntensity + (activePreview ? 0.1 : 0)) * (muted ? 0.28 : activePreview ? 1.45 : 1));
  const ringOpacity = (0.045 + visual.prestigeLevel * 0.018 + (activePreview ? 0.055 : 0)) * (muted ? 0.35 : 1);
  const ringDuration = 16 - visual.prestigeLevel * 0.5;
  const normalized = presentation !== "default";
  const visualSize = presentation === "preview" ? visual.previewVisualSize : visual.listVisualSize;
  const visibleAspect = visual.visibleBounds.width / visual.visibleBounds.height;
  const artworkWidth = visualSize * visibleAspect;
  const artworkHeight = visualSize;

  return <motion.span className={cn("relative inline-grid shrink-0 place-items-center", className)} style={{ width: pixels, height: pixels }} aria-hidden={decorative || undefined}>
    <motion.span className="absolute inset-[9%] rounded-full blur-2xl" style={{ background: `radial-gradient(circle, ${visual.glow} 0%, ${visual.aura} 48%, transparent 74%)`, opacity: auraOpacity }} animate={shouldAnimate ? { scale: [0.97, 1.04, 0.97], opacity: [auraOpacity * 0.72, auraOpacity, auraOpacity * 0.72] } : undefined} transition={{ duration: 5.6 - visual.prestigeLevel * 0.12, repeat: Infinity, ease: "easeInOut" }} />
    {visual.prestigeLevel >= 6 && <span className="absolute inset-[15%] rounded-full blur-xl" style={{ background: visual.glow, opacity: auraOpacity * 0.34 }} />}
    {(visual.prestigeLevel >= 3 || activePreview) && <motion.span
      className="absolute inset-[5%] rounded-full"
      style={{
        background: `conic-gradient(from 0deg, transparent 0deg, ${visual.glow} 54deg, transparent 112deg, transparent 250deg, ${visual.aura} 305deg, transparent 360deg)`,
        opacity: ringOpacity,
        WebkitMaskImage: "radial-gradient(circle, transparent 60%, #000 63%, #000 67%, transparent 70%)",
        maskImage: "radial-gradient(circle, transparent 60%, #000 63%, #000 67%, transparent 70%)",
      }}
      animate={shouldAnimate ? { rotate: 360 } : undefined}
      transition={{ duration: ringDuration, repeat: Infinity, ease: "linear" }}
    />}
    {visual.particleIntensity > 0 && shouldAnimate && Array.from({ length: visual.particleIntensity }, (_, index) => <motion.span key={index} className="absolute h-0.5 w-0.5 rounded-full" style={{ background: index % 2 ? visual.glow : visual.aura, left: `${18 + index * 15}%`, top: `${24 + (index % 3) * 22}%` }} animate={{ opacity: [0, 0.72, 0], scale: [0.7, 1.15, 0.7], y: [1, -2, 1] }} transition={{ duration: 3.8 + index * 0.35, repeat: Infinity, delay: index * 0.5, ease: "easeInOut" }} />)}
    {normalized ? <motion.span
      className={cn("relative z-[1] grid place-items-center drop-shadow-[0_8px_14px_rgba(0,0,0,0.45)]", muted && "opacity-55 grayscale")}
      style={{ width: artworkWidth, height: artworkHeight }}
      animate={shouldAnimate && presentation === "preview" ? { y: [0, -1, 0] } : undefined}
      transition={{ duration: 5.4, repeat: Infinity, ease: "easeInOut" }}
    >
      <span className="relative block h-full w-full overflow-hidden">
        <Image
          src={visual.badge}
          alt={decorative ? "" : `${visual.rankName} progression badge`}
          className="absolute max-w-none"
          style={{
            width: `${(visual.badge.width / visual.visibleBounds.width) * 100}%`,
            height: `${(visual.badge.height / visual.visibleBounds.height) * 100}%`,
            left: `${(-visual.visibleBounds.x / visual.visibleBounds.width) * 100}%`,
            top: `${(-visual.visibleBounds.y / visual.visibleBounds.height) * 100}%`,
          }}
          sizes={`${Math.ceil(visualSize)}px`}
          priority={presentation === "preview"}
        />
      </span>
    </motion.span> : <Image src={visual.badge} alt={decorative ? "" : `${visual.rankName} progression badge`} className={cn("relative z-[1] h-full w-full object-contain drop-shadow-[0_8px_14px_rgba(0,0,0,0.45)]", muted && "opacity-55 grayscale")} sizes={`${pixels}px`} priority={size === "hero"} />}
  </motion.span>;
}
