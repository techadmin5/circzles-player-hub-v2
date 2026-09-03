"use client";

import { useState } from "react";
import type { LeaderboardEntry } from "@/types";
import { Surface } from "@/components/ui/kit";
import { LeaderboardPodium, LeaderboardRow } from "./board";
import { playSound } from "@/hooks/useSound";
import { cn } from "@/lib/utils";

const MODES = ["Global", "Country", "State", "Friends"] as const;
const PERIODS = ["All Time", "Season"] as const;

export function LeaderboardExplorer({ entries, yourRank }: { entries: LeaderboardEntry[]; yourRank: number }) {
  const [mode, setMode] = useState<(typeof MODES)[number]>("Global");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("All Time");

  const top3 = entries.filter((e) => e.rank <= 3);
  const rest = entries.filter((e) => e.rank > 3);
  const you = entries.find((e) => e.isCurrentPlayer);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Leaderboard scope">
          {MODES.map((m) => (
            <button key={m} onClick={() => { playSound("tab"); setMode(m); }} data-testid={`lb-mode-${m}`}
              className={cn("cz-btn cz-btn-sm", mode === m ? "cz-btn-primary" : "cz-btn-ghost")}>{m}</button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {PERIODS.map((p) => (
            <button key={p} onClick={() => { playSound("tab"); setPeriod(p); }} data-testid={`lb-period-${p}`}
              className={cn("cz-btn cz-btn-sm", period === p ? "cz-btn-primary" : "cz-btn-ghost")}>{p}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterSelect label="Puzzle" options={["All puzzles", ...Array.from(new Set(entries.map((e) => e.puzzle)))]} />
        <FilterSelect label="Difficulty levelId" options={["All levels", ...Array.from(new Set(entries.map((e) => `levelId ${e.levelId}`)))]} />
        <FilterSelect label="Season" options={["Current season", "Monsoon Circuit"]} />
      </div>

      {top3.length > 0 && <LeaderboardPodium entries={top3} />}

      <Surface className="p-2">
        <div className="grid gap-0.5">
          {rest.map((entry) => <LeaderboardRow key={`${entry.rank}-${entry.player.publicPlayerId}`} entry={entry} />)}
        </div>
      </Surface>

      {you && you.rank > 3 && (
        <Surface className="p-2 cz-ring-aqua">
          <p className="px-3 pt-1 text-[0.62rem] uppercase tracking-wide text-[var(--cz-aqua)]">Your standing</p>
          <LeaderboardRow entry={you} />
        </Surface>
      )}
      {!you && (
        <p className="text-center text-xs text-[var(--cz-text-tertiary)]">You are ranked #{yourRank} on the current board.</p>
      )}
    </div>
  );
}

function FilterSelect({ label, options }: { label: string; options: string[] }) {
  return (
    <label className="inline-flex items-center gap-2 rounded-xl border border-[var(--cz-hairline)] bg-white/[0.02] px-3 py-2 text-xs text-[var(--cz-text-tertiary)]">
      <span className="hidden sm:inline">{label}</span>
      <select onChange={() => playSound("tab")} aria-label={label} className="bg-transparent text-sm text-[var(--cz-text-secondary)] outline-none">
        {options.map((o) => <option key={o} className="bg-[var(--cz-surface)]">{o}</option>)}
      </select>
    </label>
  );
}
