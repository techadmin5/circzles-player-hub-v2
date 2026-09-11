"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Gift, X } from "lucide-react";
import { motion } from "framer-motion";
import { playSound } from "@/hooks/useSound";
import { ProgressionBadge } from "./ProgressionBadge";
import { getProgressionVisual } from "@/config/progressionVisuals";

export type ProgressionRewardPreview = { type: "SYNAPSE_POINTS" | "BADGE" | "FRAME" | "AVATAR" | "RENAME_CARD" | "COUPON" | "ITEM"; label: string; amount?: number; image?: string };

export function LevelUpOverlay({ previousRankName, newRankName, progressionLevel, rewards, onCollectRewards, onDismiss, reducedMotion }: { previousRankName?: string; newRankName: string; progressionLevel: number; rewards?: ProgressionRewardPreview[]; onCollectRewards?: () => void; onDismiss: () => void; reducedMotion: boolean }) {
  const id = useId();
  const [collected, setCollected] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const hasCollect = Boolean(rewards?.length && onCollectRewards);
  const visual = getProgressionVisual(newRankName);
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
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);
  useEffect(() => { popupRef.current?.focus(); }, []);
  const collect = () => { if (!onCollectRewards || collected) return; onCollectRewards(); setCollected(true); playSound("rewardCollect"); };
  return createPortal(<div className="pointer-events-auto fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(2,5,10,0.94)] p-3 backdrop-blur-[2px] sm:p-5" style={{ backgroundImage: `radial-gradient(circle at 50% 45%, ${visual.aura}24 0%, ${visual.glow}0d 25%, transparent 55%)` }} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
    <motion.div ref={popupRef} tabIndex={-1} className="relative w-[94vw] max-w-[660px] overflow-y-auto rounded-xl border border-white/10 bg-[#05070d] px-4 pb-5 pt-6 text-center shadow-[0_28px_100px_rgba(0,0,0,0.9)] outline-none sm:w-[92vw] sm:px-8 sm:pb-7 sm:pt-7" style={{ maxHeight: "calc(100dvh - 24px)", boxShadow: `0 28px 100px rgba(0,0,0,.9), 0 0 42px ${visual.aura}1f` }} initial={{ opacity: 0, scale: reducedMotion ? 1 : .97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: reducedMotion ? 1 : .98 }}>
      <button type="button" onClick={onDismiss} aria-label="Dismiss level up" className="absolute right-2 top-2 z-30 grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-black/60 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cz-aqua)] sm:right-3 sm:top-3"><X size={20} /></button>
      <p className="cz-display pr-10 text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--cz-aqua)] sm:text-sm">Level Up</p>
      <div className="relative mx-auto grid h-[190px] w-full place-items-center sm:h-[240px] [@media(max-height:700px)]:h-[170px]" aria-hidden="true">
        {previousRankName && <motion.div className="absolute inset-0 grid place-items-center" initial={{ opacity: 0, scale: .72 }} animate={{ opacity: [0, .75, 0], scale: [.72, .82, .55], filter: ["grayscale(0)", "grayscale(0)", "grayscale(1)"] }} transition={{ duration: reducedMotion ? .35 : .8 }}><ProgressionBadge rankName={previousRankName} size="lg" decorative /></motion.div>}
        {!reducedMotion && Array.from({ length: 5 }, (_, index) => <motion.div key={index} className="absolute inset-0 grid place-items-center" style={{ clipPath: `inset(${index * 20}% 0 ${80 - index * 20}% 0)` }} initial={{ x: index % 2 ? 130 : -130, y: (index - 2) * 30, rotateY: index % 2 ? 70 : -70, opacity: 0 }} animate={{ x: 0, y: 0, rotateY: 0, opacity: [0, 1, 1, 0] }} transition={{ delay: .72 + index * .05, duration: .78, ease: [0.2, .85, .2, 1] }}><ProgressionBadge rankName={newRankName} size="hero" className="max-sm:!h-[170px] max-sm:!w-[170px] [@media(max-height:700px)]:!h-[150px] [@media(max-height:700px)]:!w-[150px]" decorative /></motion.div>)}
        <motion.div className="absolute inset-0 grid place-items-center" initial={{ opacity: 0, scale: reducedMotion ? .9 : 1.18, rotateY: reducedMotion ? 0 : 110 }} animate={{ opacity: 1, scale: reducedMotion ? 1 : [1.18, .96, 1], rotateY: 0, x: reducedMotion ? 0 : [0, -3, 3, 0] }} transition={{ delay: reducedMotion ? .18 : 1.5, duration: reducedMotion ? .25 : .45 }}><ProgressionBadge rankName={newRankName} size="hero" className="max-sm:!h-[170px] max-sm:!w-[170px] [@media(max-height:700px)]:!h-[150px] [@media(max-height:700px)]:!w-[150px]" animated decorative /></motion.div>
        {!reducedMotion && <motion.span className="absolute inset-[14%] rounded-full border-2 border-white/60" initial={{ opacity: 0, scale: .4 }} animate={{ opacity: [0, .85, 0], scale: [.4, 1.7] }} transition={{ delay: 1.54, duration: .65 }} />}
      </div>
      <motion.div className="grid gap-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reducedMotion ? .3 : 1.95 }}>
        <div className="grid gap-1"><h2 id={`${id}-title`} className="cz-display text-3xl font-extrabold text-white sm:text-5xl">{newRankName}</h2><p id={`${id}-description`} className="text-sm text-[var(--cz-text-secondary)]">Progression Level {progressionLevel}</p></div>
        {rewards?.length ? <div className="mx-auto w-full max-w-lg"><p className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-[var(--cz-gold)]">Rewards Unlocked</p><div className="mt-3 flex flex-wrap justify-center gap-2">{rewards.map((reward) => <span key={`${reward.type}-${reward.label}`} className="max-w-full break-words rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">{reward.label}</span>)}</div></div> : null}
        {collected && <p role="status" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[var(--cz-aqua)]"><Check size={16} /> Rewards Collected</p>}
        <div className="mx-auto grid w-full max-w-sm gap-2 sm:grid-cols-2">{hasCollect && <button type="button" onClick={collect} disabled={collected} className="cz-btn cz-btn-primary justify-center"><Gift size={17} />{collected ? "Collected" : "Collect Rewards"}</button>}<button type="button" onClick={onDismiss} className="cz-btn cz-btn-ghost justify-center">Okay</button></div>
      </motion.div>
    </motion.div>
  </div>, document.body);
}
