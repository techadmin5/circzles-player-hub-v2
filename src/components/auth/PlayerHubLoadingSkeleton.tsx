"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { LayoutGrid } from "lucide-react";
import { useEffect, useState } from "react";
import { useSound } from "@/hooks/useSound";

export const SESSION_LOADING_TIPS = [
  "Keep only one pair of hands in frame during your solve.",
  "Practice your solve before recording the final submission.",
  "Keep your submission file under 100 MB.",
  "Record your attempt in one continuous video without cuts.",
  "Make sure the puzzle and your hands stay clearly visible.",
  "Start the timer before opening or solving your CircZles challenge.",
  "A clean camera angle makes verification faster.",
  "CircZles combines physical solving with competitive digital progression.",
  "Verified solves can earn XP and Synapse Points.",
  "Each CircZles challenge is designed for focused, screen-free competition.",
] as const;

const skeletonPulse = "animate-pulse bg-white/[0.065] motion-reduce:animate-none";

function SkeletonBlock({ className }: { className: string }) {
  return <div aria-hidden="true" className={`${skeletonPulse} ${className}`} />;
}

function SessionLoadingTips() {
  const [tipIndex, setTipIndex] = useState(0);
  const prefersReducedMotion = useReducedMotion();
  const reducedMotionSetting = useSound((state) => state.reducedMotion);
  const reduceMotion = Boolean(prefersReducedMotion || reducedMotionSetting);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTipIndex((current) => (current + 1) % SESSION_LOADING_TIPS.length);
    }, 3600);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <section className="cz-inset min-h-[104px] overflow-hidden px-4 py-3.5" aria-live="polite" aria-atomic="true">
      <p className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-[var(--cz-gold)]">While you wait</p>
      <div className="relative mt-2 min-h-[44px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={tipIndex}
            className="absolute inset-x-0 top-0 text-sm leading-5 text-[var(--cz-text-secondary)]"
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -4 }}
            transition={{ duration: reduceMotion ? 0 : 0.24 }}
          >
            {SESSION_LOADING_TIPS[tipIndex]}
          </motion.p>
        </AnimatePresence>
      </div>
    </section>
  );
}

export function PlayerHubLoadingSkeleton() {
  return (
    <div className="min-h-dvh bg-[var(--cz-void)]" aria-busy="true" aria-label="Checking authenticated Player Hub session">
      <div className="min-h-dvh lg:flex">
        <aside className="hidden h-dvh w-[236px] shrink-0 border-r border-[var(--cz-hairline)] bg-[var(--cz-surface)] px-3 py-5 lg:block">
          <div className="mb-7 flex items-center gap-2.5 px-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--cz-aqua-dim)] text-[var(--cz-aqua)]"><LayoutGrid size={17} /></span>
            <SkeletonBlock className="h-4 w-24 rounded" />
          </div>
          <div className="grid gap-2.5 px-2">
            {[0, 1, 2, 3, 4, 5, 6].map((item) => <SkeletonBlock key={item} className="h-9 w-full rounded-xl" />)}
          </div>
        </aside>

        <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
          <header className="flex h-16 items-center justify-between border-b border-[var(--cz-hairline)] bg-[rgba(7,10,18,0.88)] px-4 lg:px-8">
            <div className="flex items-center gap-3 lg:hidden">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--cz-aqua-dim)] text-[var(--cz-aqua)]"><LayoutGrid size={17} /></span>
              <SkeletonBlock className="h-4 w-20 rounded" />
            </div>
            <SkeletonBlock className="hidden h-4 w-40 rounded lg:block" />
            <div className="flex items-center gap-3"><SkeletonBlock className="h-8 w-20 rounded-full" /><SkeletonBlock className="h-9 w-9 rounded-full" /></div>
          </header>

          <main className="mx-auto w-full max-w-[1240px] min-w-0 flex-1 px-4 pb-28 pt-6 lg:px-8 lg:pb-12">
            <div className="grid gap-5">
              <section className="cz-surface grid gap-5 p-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
                <SkeletonBlock className="h-20 w-20 rounded-full" />
                <div className="grid min-w-0 gap-3"><SkeletonBlock className="h-6 w-44 max-w-full rounded" /><SkeletonBlock className="h-4 w-28 rounded" /><SkeletonBlock className="h-2.5 w-full max-w-md rounded-full" /></div>
              </section>

              <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[0, 1, 2, 3].map((item) => <div key={item} className="cz-surface grid gap-3 p-4"><SkeletonBlock className="h-3 w-20 rounded" /><SkeletonBlock className="h-7 w-14 rounded" /></div>)}
              </section>

              <section className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(260px,0.75fr)]">
                <div className="cz-surface grid gap-4 p-5"><SkeletonBlock className="h-5 w-40 rounded" /><SkeletonBlock className="h-24 w-full rounded-xl" /><SkeletonBlock className="h-24 w-full rounded-xl" /></div>
                <div className="grid min-w-0 gap-5"><SessionLoadingTips /><div className="cz-surface grid gap-3 p-5"><SkeletonBlock className="h-5 w-36 rounded" /><SkeletonBlock className="h-14 w-full rounded-xl" /><SkeletonBlock className="h-14 w-full rounded-xl" /></div></div>
              </section>
            </div>
          </main>

          <nav aria-hidden="true" className="fixed inset-x-0 bottom-0 grid grid-cols-6 border-t border-[var(--cz-hairline)] bg-[rgba(14,20,32,0.96)] px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 lg:hidden">
            {[0, 1, 2, 3, 4, 5].map((item) => <div key={item} className="grid justify-items-center gap-1.5 py-1.5"><SkeletonBlock className="h-5 w-5 rounded" /><SkeletonBlock className="h-2 w-8 rounded" /></div>)}
          </nav>
        </div>
      </div>
    </div>
  );
}
