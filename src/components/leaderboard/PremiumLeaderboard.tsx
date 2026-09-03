import Link from "next/link";
import type { LeaderboardEntry } from "@/types";
import { cn } from "@/lib/utils";
import { PlacementMedal } from "./PlacementMedal";

export function PremiumLeaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  return <div className="grid gap-4">
    <div className="grid gap-3 md:grid-cols-3">
      {entries.slice(0, 3).map((entry) => <Link key={entry.rank} href={`/profile/${entry.player.publicPlayerId}`} className="game-card glow-border p-5 transition-transform hover:-translate-y-0.5">
        <PlacementMedal rank={entry.rank} />
        <h3 className="mt-4 font-display text-3xl font-bold">{entry.player.displayName}</h3>
        <p className="text-sm text-[var(--text-secondary)]">{entry.time} | {entry.puzzle}</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">Difficulty levelId {entry.levelId} | {entry.region}</p>
      </Link>)}
    </div>
    <div className="game-card overflow-hidden">
      {entries.map((entry) => <Link href={`/profile/${entry.player.publicPlayerId}`} key={`${entry.rank}-${entry.player.publicPlayerId}`} className={cn("grid items-center gap-3 border-t border-white/10 p-4 md:grid-cols-[130px_1fr_120px_1fr_140px]", entry.isCurrentPlayer && "bg-cyan-300/8")}>
        <PlacementMedal rank={entry.rank} />
        <span className="font-semibold">{entry.player.displayName}</span>
        <span>{entry.time}</span>
        <span className="text-[var(--text-secondary)]">{entry.puzzle} | levelId {entry.levelId}</span>
        <span className="text-sm text-[var(--text-muted)]">{entry.region}</span>
      </Link>)}
    </div>
  </div>;
}
