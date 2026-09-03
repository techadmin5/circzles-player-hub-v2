import Link from "next/link";
import type { LeaderboardEntry } from "@/types";
import { AvatarFrame, PlacementMedal } from "@/components/player/AvatarFrame";
import { cn } from "@/lib/utils";

export function LeaderboardPodium({ entries }: { entries: LeaderboardEntry[] }) {
  const byRank = (n: number) => entries.find((e) => e.rank === n);
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1.15fr_1fr] md:items-end" data-testid="leaderboard-podium">
      <PodiumColumn entry={byRank(2)} height={92} tone="var(--cz-silver)" />
      <PodiumColumn entry={byRank(1)} height={132} tone="var(--cz-gold)" champion />
      <PodiumColumn entry={byRank(3)} height={74} tone="var(--cz-bronze)" />
    </div>
  );
}

function PodiumColumn({ entry, height, tone, champion = false }: { entry?: LeaderboardEntry; height: number; tone: string; champion?: boolean }) {
  if (!entry) return <div />;
  return (
    <Link href={`/profile/${entry.player.publicPlayerId}`} className="flex flex-col items-center gap-3 transition-transform hover:-translate-y-0.5">
      <PlacementMedal placement={entry.rank} size={champion ? "lg" : "md"} />
      <AvatarFrame avatar={entry.player.avatar} displayName={entry.player.displayName} size={champion ? 116 : 84} placement={entry.rank} />
      <div className="text-center">
        <p className="cz-display max-w-[150px] truncate text-base font-semibold">{entry.player.displayName}</p>
        <p className="cz-num text-xs text-[var(--cz-text-tertiary)]">{entry.time} · {entry.puzzle}</p>
      </div>
      <div className={cn("cz-raised grid w-full place-items-center rounded-b-none border-b-0 px-4 text-center")} style={{ minHeight: height, borderColor: tone, boxShadow: `inset 0 1px 0 ${tone}30` }}>
        <p className="cz-display cz-num text-2xl font-bold" style={{ color: tone }}>#{entry.rank}</p>
        <p className="text-[0.62rem] uppercase tracking-wide text-[var(--cz-text-tertiary)]">Placement</p>
      </div>
    </Link>
  );
}

export function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
  return (
    <Link href={`/profile/${entry.player.publicPlayerId}`} data-testid={`leaderboard-row-${entry.rank}`}
      className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors", entry.isCurrentPlayer ? "cz-ring-aqua bg-[var(--cz-aqua-dim)]" : "hover:bg-white/[0.03]")}>
      <PlacementMedal placement={entry.rank} size="sm" />
      <AvatarFrame avatar={entry.player.avatar} displayName={entry.player.displayName} size={40} placement={null} />
      <div className="min-w-0 flex-1">
        <p className="cz-display truncate text-sm font-semibold">{entry.player.displayName}{entry.isCurrentPlayer && <span className="ml-2 text-xs font-normal text-[var(--cz-aqua)]">You</span>}</p>
        <p className="truncate text-xs text-[var(--cz-text-tertiary)]">{entry.puzzle} · levelId {entry.levelId} · {entry.region}</p>
      </div>
      <span className="cz-num text-sm font-semibold text-[var(--cz-text-secondary)]">{entry.time}</span>
    </Link>
  );
}
