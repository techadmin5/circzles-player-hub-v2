"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Gift, X } from "lucide-react";
import type { PlayerProfile } from "@/types";
import { progressionRanks } from "@/config/progression";
import { RankEmblem, type RankState } from "./RankEmblem";
import { playSound } from "@/hooks/useSound";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

function rankFor(progressionLevel: number) {
  return progressionRanks.reduce((current, rank) => (rank.progressionLevel <= progressionLevel ? rank : current), progressionRanks[0]);
}

function stateFor(order: number, currentOrder: number): RankState {
  if (order < currentOrder) return "completed";
  if (order === currentOrder) return "current";
  return "locked";
}

export function ProgressionCodex({ open, onClose, player }: { open: boolean; onClose: () => void; player: PlayerProfile }) {
  const current = rankFor(player.progressionLevel);
  const [selectedKey, setSelectedKey] = useState(current.key);
  const selected = progressionRanks.find((r) => r.key === selectedKey) ?? current;
  const state = stateFor(selected.order, current.order);
  const next = progressionRanks.find((r) => r.order === current.order + 1);
  const pct = state === "current" ? Math.min(100, Math.round((player.xp / Math.max(1, player.xpNeeded)) * 100)) : state === "completed" ? 100 : 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] grid place-items-center bg-black/72 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="dialog" aria-modal="true" aria-label="Progression Codex"
            className="cz-surface cz-grain cz-elevate max-h-[86vh] w-full max-w-3xl overflow-hidden"
            initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }} transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            data-testid="progression-codex"
          >
            <div className="flex items-center justify-between border-b border-[var(--cz-hairline)] px-5 py-3.5">
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--cz-aqua)]">Progression</p>
                <h2 className="cz-display text-lg font-bold">Rank Codex</h2>
              </div>
              <button onClick={() => { playSound("modalClose"); onClose(); }} aria-label="Close" data-testid="codex-close" className="grid h-9 w-9 place-items-center rounded-full text-[var(--cz-text-tertiary)] hover:bg-white/5 hover:text-[var(--cz-text-primary)]"><X size={18} /></button>
            </div>

            <div className="cz-scroll grid max-h-[calc(86vh-58px)] grid-cols-1 overflow-y-auto md:grid-cols-[1fr_1.1fr] md:overflow-hidden">
              <div className="flex flex-col items-center justify-center gap-4 border-b border-[var(--cz-hairline)] px-5 py-6 md:border-b-0 md:border-r md:px-8 md:py-9">
                <RankEmblem rank={selected.rank} state={state} size={150} />
                <div className="text-center">
                  <p className="cz-display text-2xl font-bold">{selected.rank}</p>
                  <p className={cn("mt-1 text-xs font-semibold tracking-wide", state === "completed" && "text-[var(--cz-emerald)]", state === "current" && "text-[var(--cz-aqua)]", state === "locked" && "text-[var(--cz-text-tertiary)]")}>{state.toUpperCase()}</p>
                </div>
                <div className="w-full max-w-[230px]">
                  <div className="cz-track h-1.5"><div className="cz-track-fill" style={{ width: `${pct}%` }} /></div>
                  <p className="mt-1.5 text-center text-xs text-[var(--cz-text-tertiary)]">
                    {state === "current" ? `${formatNumber(player.xp)} / ${formatNumber(player.xpNeeded)} XP` : `Unlocks at Progression Level ${selected.progressionLevel}`}
                  </p>
                </div>
                <div className="cz-inset w-full max-w-[230px] px-4 py-3">
                  <p className="mb-1 flex items-center gap-1.5 text-[0.62rem] uppercase tracking-wider text-[var(--cz-text-tertiary)]"><Gift size={12} />Reward preview</p>
                  <p className="text-sm text-[var(--cz-text-secondary)]">{selected.rewards.join(" · ")}</p>
                  <p className="mt-1 text-[0.62rem] text-[var(--cz-text-tertiary)]">Placeholder tier · final values set by backend</p>
                </div>
                {next && state === "current" && <p className="text-xs text-[var(--cz-text-tertiary)]">Next rank: <span className="text-[var(--cz-text-secondary)]">{next.rank}</span></p>}
              </div>

              <div className="cz-scroll px-3 py-3 md:overflow-y-auto">
                {progressionRanks.map((rank) => {
                  const s = stateFor(rank.order, current.order);
                  return (
                    <button key={rank.key} data-sound="tab" onClick={() => setSelectedKey(rank.key)} data-testid={`codex-rank-${rank.key}`}
                      className={cn("mb-2 grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors", selectedKey === rank.key ? "border-[rgba(61,234,212,0.4)] bg-[var(--cz-aqua-dim)]" : "border-[var(--cz-hairline)] bg-white/[0.02] hover:border-[var(--cz-hairline-strong)]")}>
                      <RankEmblem rank={rank.rank} state={s} size={42} />
                      <div>
                        <p className="cz-display text-sm font-semibold">{rank.rank}</p>
                        <p className="text-xs text-[var(--cz-text-tertiary)]">Progression Level {rank.progressionLevel}</p>
                      </div>
                      <span className={cn("cz-chip", s === "completed" && "border-[rgba(52,211,153,0.4)] text-[var(--cz-emerald)]", s === "current" && "border-[rgba(61,234,212,0.4)] text-[var(--cz-aqua)]")}>{s}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
