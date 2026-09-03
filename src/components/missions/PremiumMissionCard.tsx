import type { ReactNode } from "react";
import { CalendarDays, CheckCircle2, Flame, Gift, Lock } from "lucide-react";
import type { Mission } from "@/types";
import { PuzzleStatusBadge } from "@/components/ui";

export function PremiumMissionCard({ mission, action }: { mission: Mission; action?: ReactNode }) {
  const pct = Math.min(100, Math.round((mission.progress.current / Math.max(1, mission.progress.target)) * 100));
  const Icon = mission.status === "LOCKED" ? Lock : mission.claimable ? Gift : mission.status === "COMPLETED" ? CheckCircle2 : Flame;
  return <article className="game-card grid gap-4 p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="grid grid-cols-[auto_1fr] gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-lg border border-[var(--cyan)]/30 bg-black/30 text-[var(--cyan)]"><Icon className="h-5 w-5" /></div>
        <div>
          <h3 className="font-display text-2xl font-bold">{mission.title}</h3>
          <p className="text-sm text-[var(--text-secondary)]">{mission.description}</p>
        </div>
      </div>
      <PuzzleStatusBadge status={mission.status} />
    </div>
    <div>
      <div className="flex justify-between text-xs text-[var(--text-muted)]"><span>{mission.progress.current} / {mission.progress.target}</span><span>{pct}%</span></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-[var(--cyan)] to-[var(--gold)]" style={{ width: `${pct}%` }} /></div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="flex items-center gap-2 text-sm text-[var(--gold)]"><Gift className="h-4 w-4" />{mission.rewards.map((r) => r.label).join(" + ")}</p>
      <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><CalendarDays className="h-4 w-4" />{mission.category} | {mission.timeRemaining}</p>
    </div>
    {action}
  </article>;
}
