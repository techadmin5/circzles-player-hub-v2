"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Gift, LockKeyhole, X } from "lucide-react";
import type { PlayerProfile } from "@/types";
import { progressionRanks } from "@/config/progression";
import { getProgressionVisual } from "@/config/progressionVisuals";
import { getRankVisualTreatment } from "@/config/rankVisualHierarchy";
import { ProgressionBadge } from "./ProgressionBadge";
import { playSound, useSound } from "@/hooks/useSound";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type RankState = "completed" | "current" | "locked";

function rankFor(progressionLevel: number) {
  return progressionRanks.reduce((current, rank) => (rank.progressionLevel <= progressionLevel ? rank : current), progressionRanks[0]);
}

function stateFor(order: number, currentOrder: number): RankState {
  if (order < currentOrder) return "completed";
  if (order === currentOrder) return "current";
  return "locked";
}

export function ProgressionCodex({ open, onClose, player, showRewardPreview = true }: { open: boolean; onClose: () => void; player: PlayerProfile; showRewardPreview?: boolean }) {
  const current = rankFor(player.progressionLevel);
  const [selectedKey, setSelectedKey] = useState(current.key);
  const selected = progressionRanks.find((r) => r.key === selectedKey) ?? current;
  const state = stateFor(selected.order, current.order);
  const selectedVisual = getRankVisualTreatment(selected.rank);
  const selectedProgressionVisual = getProgressionVisual(selected.rank);
  const systemReducedMotion = useReducedMotion();
  const settingReducedMotion = useSound((sound) => sound.reducedMotion);
  const reducedMotion = Boolean(systemReducedMotion || settingReducedMotion);
  const next = progressionRanks.find((r) => r.order === current.order + 1);
  const pct = state === "current" ? Math.min(100, Math.round((player.xp / Math.max(1, player.xpNeeded)) * 100)) : state === "completed" ? 100 : 0;
  const frameLevel = selectedProgressionVisual.prestigeLevel;
  const frameShadow = `inset 0 0 ${22 + frameLevel * 2}px ${selectedVisual.secondary}12, 0 0 ${6 + frameLevel * 1.5}px ${selectedVisual.primary}${state === "locked" ? "08" : "18"}`;
  const activeFrameShadow = `inset 0 0 ${26 + frameLevel * 2}px ${selectedVisual.secondary}22, 0 0 ${10 + frameLevel * 2.4}px ${selectedVisual.primary}42`;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] grid place-items-center bg-black/72 p-2 backdrop-blur-sm sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="dialog" aria-modal="true" aria-label="Progression ranks"
            className="cz-surface cz-grain cz-elevate h-[min(92dvh,46rem)] w-full min-w-0 max-w-3xl overflow-hidden"
            initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }} transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            data-testid="progression-ranks"
          >
            <div className="flex items-center justify-between border-b border-[var(--cz-hairline)] px-5 py-3.5">
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--cz-aqua)]">Progression</p>
                <h2 className="cz-display text-lg font-bold">Ranks</h2>
              </div>
              <button onClick={() => { playSound("modalClose"); onClose(); }} aria-label="Close" data-testid="codex-close" className="grid h-9 w-9 place-items-center rounded-full text-[var(--cz-text-tertiary)] hover:bg-white/5 hover:text-[var(--cz-text-primary)]"><X size={18} /></button>
            </div>

            <div className="cz-scroll grid h-[calc(100%-65px)] min-w-0 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:overflow-hidden">
              <div className="flex min-w-0 flex-col items-center justify-center gap-4 border-b border-[var(--cz-hairline)] px-4 py-5 md:border-b-0 md:border-r md:px-8 md:py-8">
                <motion.div
                  className="relative grid h-40 w-full max-w-[240px] place-items-center overflow-hidden rounded-2xl border bg-black/15 sm:h-44 sm:max-w-[260px]"
                  style={{ borderColor: `${selectedVisual.primary}${state === "locked" ? "20" : "38"}`, boxShadow: frameShadow }}
                  animate={state === "current" && !reducedMotion ? { borderColor: [`${selectedVisual.primary}38`, `${selectedVisual.primary}70`, `${selectedVisual.primary}38`], boxShadow: [frameShadow, activeFrameShadow, frameShadow] } : undefined}
                  transition={{ duration: 6.8 - frameLevel * 0.18, repeat: Infinity, ease: "easeInOut" }}
                >
                  <ProgressionBadge rankName={selected.rank} size="lg" presentation="preview" animated={state === "current"} muted={state === "locked"} decorative />
                  {state === "locked" && <span className="absolute bottom-3 right-3 z-[2] grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-black/70 text-[var(--cz-text-secondary)]" aria-hidden="true"><LockKeyhole size={15} /></span>}
                </motion.div>
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
                {showRewardPreview && <div className="cz-inset w-full max-w-[230px] px-4 py-3">
                  <p className="mb-1 flex items-center gap-1.5 text-[0.62rem] uppercase tracking-wider text-[var(--cz-text-tertiary)]"><Gift size={12} />Reward preview</p>
                  <p className="text-sm text-[var(--cz-text-secondary)]">{selected.rewards.join(" · ")}</p>
                </div>}
                {next && state === "current" && <p className="text-xs text-[var(--cz-text-tertiary)]">Next rank: <span className="text-[var(--cz-text-secondary)]">{next.rank}</span></p>}
              </div>

              <div className="cz-scroll min-w-0 px-2 py-3 sm:px-3 md:h-full md:overflow-y-auto md:overscroll-contain">
                {progressionRanks.map((rank) => {
                  const s = stateFor(rank.order, current.order);
                  const visual = getRankVisualTreatment(rank.rank);
                  return (
                    <button key={rank.key} data-sound="tab" onClick={() => setSelectedKey(rank.key)} data-testid={`codex-rank-${rank.key}`}
                      className={cn("mb-2 grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2.5 text-left transition-colors min-[390px]:grid-cols-[auto_minmax(0,1fr)_auto]", s === "locked" && "text-[var(--cz-text-secondary)]", selectedKey === rank.key ? "bg-white/[0.055]" : "bg-white/[0.02] hover:bg-white/[0.035]")}
                      style={{ borderColor: selectedKey === rank.key ? `${visual.primary}66` : `${visual.primary}${s === "locked" ? "18" : "30"}`, boxShadow: selectedKey === rank.key ? `inset 3px 0 0 ${visual.primary}aa, inset 0 0 22px ${visual.secondary}0d` : undefined }}>
                      <span className="relative grid h-[42px] w-[42px] shrink-0 place-items-center" style={{ filter: s === "current" ? `drop-shadow(0 0 6px ${visual.primary}66)` : undefined }}>
                        <ProgressionBadge rankName={rank.rank} size="xs" presentation="list" muted={s === "locked"} decorative />
                        {s === "locked" && <span className="absolute -bottom-0.5 -right-0.5 z-[2] grid h-4 w-4 place-items-center rounded-full border border-white/15 bg-black/75 text-[var(--cz-text-tertiary)]" aria-hidden="true"><LockKeyhole size={9} /></span>}
                      </span>
                      <div className="min-w-0">
                        <p className="cz-display truncate text-sm font-semibold">{rank.rank}</p>
                        <p className="text-xs text-[var(--cz-text-tertiary)]">Progression Level {rank.progressionLevel}</p>
                      </div>
                      <span className={cn("cz-chip col-start-2 w-fit min-[390px]:col-start-auto", s === "completed" && "border-[rgba(52,211,153,0.4)] text-[var(--cz-emerald)]", s === "current" && "border-[rgba(61,234,212,0.4)] text-[var(--cz-aqua)]")}>{s}</span>
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
