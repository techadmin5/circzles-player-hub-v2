"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { CalendarClock, CheckCircle2, Flame, Gift, Lock, Sparkles, Star, Swords, Trophy } from "lucide-react";
import type { Mission, MissionCategory, MissionClaimResult } from "@/types";
import { Chip } from "@/components/ui/kit";
import { cn } from "@/lib/utils";

const CATEGORY_ICON: Record<MissionCategory, React.ReactNode> = {
  DAILY: <Sparkles size={16} />, WEEKLY: <CalendarClock size={16} />, SPRINT: <Flame size={16} />,
  SEASON: <Trophy size={16} />, EVENT: <Star size={16} />, ACHIEVEMENT: <Swords size={16} />,
};

const FILTERS: ("All" | MissionCategory)[] = ["All", "DAILY", "WEEKLY", "SPRINT", "SEASON", "EVENT", "ACHIEVEMENT"];

export function MissionCard({ mission, busy = false, error, claimResult, onClaim }: { mission: Mission; busy?: boolean; error?: string; claimResult?: MissionClaimResult; onClaim?: (missionId: string) => void }) {
  const claimed = mission.status === "CLAIMED";
  const pct = Math.min(100, Math.round((mission.progress.current / Math.max(1, mission.progress.target)) * 100));
  const locked = mission.status === "LOCKED";
  const claimable = mission.claimable && !claimed;
  const Icon = locked ? <Lock size={16} /> : claimable ? <Gift size={16} /> : CATEGORY_ICON[mission.category];

  return (
    <motion.article layout className={cn("cz-surface relative overflow-hidden p-4", claimable && "cz-ring-gold")} data-testid={`mission-${mission.missionId}`}>
      {claimable && <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(232,180,80,0.16), transparent 70%)" }} />}
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl border", claimable ? "border-[rgba(232,180,80,0.4)] bg-[var(--cz-gold-dim)] text-[var(--cz-gold)]" : "border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] text-[var(--cz-aqua)]")}>{Icon}</span>
          <div>
            <h3 className="cz-display text-base font-bold">{mission.title}</h3>
            <p className="text-xs text-[var(--cz-text-secondary)]">{mission.description}</p>
          </div>
        </div>
        <Chip tone={claimed ? "emerald" : claimable ? "gold" : locked ? "default" : "aqua"}>{claimed ? "Claimed" : mission.status}</Chip>
      </div>

      <div className="relative mt-4">
        <div className="mb-1 flex justify-between text-[0.68rem] text-[var(--cz-text-tertiary)]"><span className="cz-num">{mission.progress.current} / {mission.progress.target}</span><span className="inline-flex items-center gap-1"><CalendarClock size={11} />{mission.timeRemaining}</span></div>
        <div className="cz-track"><div className={cn("cz-track-fill", claimable && "cz-track-fill-gold")} style={{ width: `${pct}%` }} /></div>
      </div>

      <div className="relative mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {mission.rewards.map((reward) => <Chip key={`${reward.type}-${reward.label}`} tone="gold"><Gift size={11} />{reward.label}</Chip>)}
        </div>
        {claimed
          ? <span className="inline-flex items-center gap-1.5 text-sm text-[var(--cz-emerald)]"><CheckCircle2 size={15} />Claimed</span>
          : claimable
            ? <button type="button" className="cz-btn cz-btn-gold cz-btn-sm" onClick={() => onClaim?.(mission.missionId)} disabled={busy || !onClaim} data-testid={`claim-${mission.missionId}`}>{busy ? "Claiming..." : "Claim Reward"}</button>
            : null}
      </div>
      {claimResult && <p className="relative mt-3 text-xs text-[var(--cz-emerald)]" role="status">Awarded {formatAward(claimResult)}</p>}
      {error && <p className="relative mt-3 text-xs text-[var(--cz-danger)]" role="alert">{error}</p>}
    </motion.article>
  );
}

export function MissionBoard({ missions, busyMissionIds, claimErrors, claimResults, onClaim }: { missions: Mission[]; busyMissionIds?: ReadonlySet<string>; claimErrors?: Readonly<Record<string, string>>; claimResults?: Readonly<Record<string, MissionClaimResult>>; onClaim?: (missionId: string) => void }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const list = filter === "All" ? missions : missions.filter((mission) => mission.category === filter);
  const claimableCount = missions.filter((mission) => mission.claimable).length;

  return (
    <div className="grid gap-5">
      {claimableCount > 0 && <p className="text-sm text-[var(--cz-gold)]">{claimableCount} reward{claimableCount > 1 ? "s" : ""} ready to claim</p>}
      <div className="cz-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Mission categories">
        {FILTERS.map((filterOption) => (
          <button key={filterOption} type="button" role="tab" aria-selected={filter === filterOption} data-sound="tab" onClick={() => setFilter(filterOption)} data-testid={`mission-filter-${filterOption}`}
            className={cn("cz-btn cz-btn-sm shrink-0 capitalize", filter === filterOption ? "cz-btn-primary" : "cz-btn-ghost")}>{filterOption === "All" ? "All" : filterOption.toLowerCase()}</button>
        ))}
      </div>
      {list.length === 0
        ? <p className="cz-surface p-8 text-center text-sm text-[var(--cz-text-tertiary)]">{filter === "All" ? "No active missions right now." : `No ${filter.toLowerCase()} missions right now.`}</p>
        : <div className="grid gap-3 md:grid-cols-2">{list.map((mission) => <MissionCard key={mission.missionId} mission={mission} busy={busyMissionIds?.has(mission.missionId)} error={claimErrors?.[mission.missionId]} claimResult={claimResults?.[mission.missionId]} onClaim={onClaim} />)}</div>}
    </div>
  );
}

function formatAward(result: MissionClaimResult) {
  const rewards: string[] = [];
  if (result.awarded.synapsePoints > 0) rewards.push(`${result.awarded.synapsePoints} Synapse Points`);
  if (result.awarded.xp > 0) rewards.push(`${result.awarded.xp} XP`);
  return rewards.join(" + ") || "mission reward";
}
