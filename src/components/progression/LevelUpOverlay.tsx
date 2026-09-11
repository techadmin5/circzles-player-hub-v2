"use client";
import { useEffect, useId, useState } from "react";
import { Check, Gift, X } from "lucide-react";
import { motion } from "framer-motion";
import { playSound } from "@/hooks/useSound";
import { ProgressionBadge } from "./ProgressionBadge";

export type ProgressionRewardPreview = { type: "SYNAPSE_POINTS" | "BADGE" | "FRAME" | "AVATAR" | "RENAME_CARD" | "COUPON" | "ITEM"; label: string; amount?: number; image?: string };

export function LevelUpOverlay({ previousRankName, newRankName, progressionLevel, rewards, onCollectRewards, onDismiss, reducedMotion }: { previousRankName?: string; newRankName: string; progressionLevel: number; rewards?: ProgressionRewardPreview[]; onCollectRewards?: () => void; onDismiss: () => void; reducedMotion: boolean }) {
  const id = useId();
  const [collected, setCollected] = useState(false);
  const hasCollect = Boolean(rewards?.length && onCollectRewards);
  useEffect(() => {
    playSound("rankBuild");
    if (reducedMotion) { playSound("rankReveal"); return; }
    const impact = window.setTimeout(() => playSound("rankImpact"), 1500);
    const reveal = window.setTimeout(() => { playSound("rankReveal"); playSound("rankUp"); }, 1900);
    return () => { window.clearTimeout(impact); window.clearTimeout(reveal); };
  }, [reducedMotion]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onDismiss(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);
  const collect = () => { if (!onCollectRewards || collected) return; onCollectRewards(); setCollected(true); playSound("rewardCollect"); };
  return <div className="pointer-events-auto absolute inset-0 flex items-center justify-center overflow-y-auto bg-black/80 px-4 py-[max(1rem,env(safe-area-inset-top))] backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
    <motion.div className="relative my-auto w-full max-w-xl text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <button type="button" onClick={onDismiss} aria-label="Dismiss level up" className="absolute right-0 top-0 z-30 grid h-10 w-10 place-items-center rounded-full border border-white/25 bg-black/55 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cz-aqua)]"><X size={20} /></button>
      <div className="relative mx-auto h-52 w-52 sm:h-64 sm:w-64" aria-hidden="true">
        {previousRankName && <motion.div className="absolute inset-0 grid place-items-center" initial={{ opacity: 0, scale: .72 }} animate={{ opacity: [0, .75, 0], scale: [.72, .82, .55], filter: ["grayscale(0)", "grayscale(0)", "grayscale(1)"] }} transition={{ duration: reducedMotion ? .35 : .8 }}><ProgressionBadge rankName={previousRankName} size="lg" decorative /></motion.div>}
        {!reducedMotion && Array.from({ length: 5 }, (_, index) => <motion.div key={index} className="absolute inset-0 grid place-items-center" style={{ clipPath: `inset(${index * 20}% 0 ${80 - index * 20}% 0)` }} initial={{ x: index % 2 ? 130 : -130, y: (index - 2) * 30, rotateY: index % 2 ? 70 : -70, opacity: 0 }} animate={{ x: 0, y: 0, rotateY: 0, opacity: [0, 1, 1, 0] }} transition={{ delay: .72 + index * .05, duration: .78, ease: [0.2, .85, .2, 1] }}><ProgressionBadge rankName={newRankName} size="hero" decorative /></motion.div>)}
        <motion.div className="absolute inset-0 grid place-items-center" initial={{ opacity: 0, scale: reducedMotion ? .9 : 1.18, rotateY: reducedMotion ? 0 : 110 }} animate={{ opacity: 1, scale: reducedMotion ? 1 : [1.18, .96, 1], rotateY: 0, x: reducedMotion ? 0 : [0, -3, 3, 0] }} transition={{ delay: reducedMotion ? .18 : 1.5, duration: reducedMotion ? .25 : .45 }}><ProgressionBadge rankName={newRankName} size="hero" animated decorative /></motion.div>
        {!reducedMotion && <motion.span className="absolute inset-[14%] rounded-full border-2 border-white/60" initial={{ opacity: 0, scale: .4 }} animate={{ opacity: [0, .85, 0], scale: [.4, 1.7] }} transition={{ delay: 1.54, duration: .65 }} />}
      </div>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reducedMotion ? .3 : 1.95 }}>
        <p className="cz-display text-sm font-extrabold uppercase text-[var(--cz-aqua)]">Level Up</p>
        <h2 id={`${id}-title`} className="cz-display mt-1 text-3xl font-extrabold text-white sm:text-5xl">{newRankName}</h2>
        <p id={`${id}-description`} className="mt-1 text-sm text-[var(--cz-text-secondary)]">Progression Level {progressionLevel}</p>
        {rewards?.length ? <div className="mx-auto mt-4 max-w-lg"><p className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-[var(--cz-gold)]">Rewards Unlocked</p><div className="mt-2 flex flex-wrap justify-center gap-2">{rewards.map((reward) => <span key={`${reward.type}-${reward.label}`} className="rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">{reward.label}</span>)}</div></div> : null}
        {collected && <p role="status" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[var(--cz-aqua)]"><Check size={16} /> Rewards Collected</p>}
        <div className="mx-auto mt-5 grid max-w-sm gap-2 sm:grid-cols-2">{hasCollect && <button type="button" onClick={collect} disabled={collected} className="cz-btn cz-btn-primary justify-center"><Gift size={17} />{collected ? "Collected" : "Collect Rewards"}</button>}<button type="button" onClick={onDismiss} className="cz-btn cz-btn-ghost justify-center">Okay</button></div>
      </motion.div>
    </motion.div>
  </div>;
}
