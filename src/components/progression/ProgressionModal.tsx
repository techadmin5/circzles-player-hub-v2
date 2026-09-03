"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { ProgressionTrack } from "./ProgressionTrack";

export function ProgressionModal({ open, onClose, progressionLevel }: { open: boolean; onClose: () => void; progressionLevel: number }) {
  return <AnimatePresence>
    {open && <motion.div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="game-card max-h-[86dvh] w-full max-w-2xl overflow-auto p-5" initial={{ y: 18, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 18, scale: 0.98 }} transition={{ duration: 0.22 }}>
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[var(--cyan)]">Placeholder progression ladder</p>
            <h2 className="font-display text-4xl font-bold">Rank Path</h2>
          </div>
          <button className="btn btn-ghost min-h-10 px-3" onClick={onClose} aria-label="Close progression"><X className="h-5 w-5" /></button>
        </div>
        <ProgressionTrack progressionLevel={progressionLevel} />
      </motion.section>
    </motion.div>}
  </AnimatePresence>;
}
