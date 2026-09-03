import { progressionRanks } from "@/config/progression";
import { ProgressionRankEmblem } from "./ProgressionRankEmblem";

export function ProgressionTrack({ progressionLevel }: { progressionLevel: number }) {
  return <div className="grid gap-3">
    {progressionRanks.map((rank) => {
      const state = rank.progressionLevel > progressionLevel ? "locked" : rank.progressionLevel === progressionLevel ? "current" : "unlocked";
      return <div key={rank.key} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-white/10 bg-white/[.03] p-3">
        <ProgressionRankEmblem rank={rank} state={state} size="sm" />
        <div>
          <p className="font-display text-xl font-bold">{rank.rank}</p>
          <p className="text-xs text-[var(--text-secondary)]">Progression Level {rank.progressionLevel} unlock threshold</p>
        </div>
        <span className="rounded border border-white/10 px-2 py-1 text-xs text-[var(--text-secondary)]">{state}</span>
      </div>;
    })}
  </div>;
}
