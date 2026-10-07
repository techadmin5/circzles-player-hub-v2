"use client";
import type { ReactNode } from "react";
import type { PlayerProfile } from "@/types";
import { formatNumber } from "@/lib/format";
import { usePlayerUiState } from "@/stores/playerUiState";
import { ProgressionBadge } from "@/components/progression/ProgressionBadge";
import { HubAnimatedMetricIcon } from "./HubAnimatedMetricIcon";

export function HubMetricStrip({ player, mode }: { player: PlayerProfile; mode: "mock" | "api" }) {
  const live = usePlayerUiState((state) => state.player);
  const rankName = live?.rankName ?? player.rank;
  return <section className="cz-surface grid min-w-0 grid-cols-2 gap-px overflow-hidden p-px lg:grid-cols-4" aria-label="Player metrics">
    <Metric label="Progression" icon={<ProgressionBadge rankName={rankName} size="sm" animated decorative />} value={rankName} detail={`Level ${live?.progressionLevel ?? player.progressionLevel}`} />
    <Metric label="Synapse Points" icon={<HubAnimatedMetricIcon animation="coin" />} value={formatNumber(live?.synapsePoints ?? player.synapsePoints)} detail="Available balance" />
    <Metric label="Puzzle Streak" icon={<HubAnimatedMetricIcon animation="fireStreak" />} value={mode === "mock" ? `${player.streak} days` : "—"} detail={mode === "mock" ? "Demo streak" : "Unavailable"} />
    <Metric label="Rewards Wheel" icon={<HubAnimatedMetricIcon animation="fortuneWheel" />} value={mode === "mock" ? "Ready" : "—"} detail={mode === "mock" ? "Demo status" : "Unavailable"} />
  </section>;
}
function Metric({ label, icon, value, detail }: { label: string; icon: ReactNode; value: string; detail: string }) {
  return <div className="flex min-w-0 items-center gap-2.5 bg-[#0c111d] px-3 py-3 sm:gap-3 sm:px-4"><div className="grid h-14 w-14 shrink-0 place-items-center">{icon}</div><div className="min-w-0"><p className="truncate text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-[var(--cz-text-tertiary)]">{label}</p><p className="cz-display cz-num truncate text-base font-bold text-white sm:text-lg">{value}</p><p className="truncate text-[0.65rem] text-[var(--cz-text-tertiary)]">{detail}</p></div></div>;
}
