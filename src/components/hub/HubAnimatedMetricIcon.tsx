"use client";

import { useRef } from "react";
import { Lottie } from "lottie-react";
import { useInView, useReducedMotion } from "framer-motion";
import coin from "@/assets/lottie/hub/coin.json";
import fire from "@/assets/lottie/hub/fire.json";
import fireStreakOrange from "@/assets/lottie/hub/fire-streak-orange.json";
import fortuneWheel from "@/assets/lottie/hub/fortune-wheel.json";
import { useSound } from "@/hooks/useSound";
import { cn } from "@/lib/utils";

export type HubMetricAnimation = "coin" | "fire" | "fireStreak" | "fortuneWheel";
const animations: Record<HubMetricAnimation, object> = { coin, fire, fireStreak: fireStreakOrange, fortuneWheel };

export function HubAnimatedMetricIcon({ animation, className }: { animation: HubMetricAnimation; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { margin: "80px" });
  const systemReduced = useReducedMotion();
  const settingReduced = useSound((state) => state.reducedMotion);
  const animate = inView && !systemReduced && !settingReduced;
  return <span ref={ref} className={cn("pointer-events-none block h-14 w-14 overflow-hidden", className)} aria-hidden="true"><Lottie src={animations[animation]} autoplay={animate} loop={animate} rendererSettings={{ preserveAspectRatio: "xMidYMid meet" }} className="h-full w-full" /></span>;
}
