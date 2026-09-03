import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Clock, Gauge, Medal } from "lucide-react";
import type { PlayerPuzzle } from "@/types";
import { PuzzleStatusBadge } from "@/components/ui";

export function PremiumPuzzleCard({ puzzle }: { puzzle: PlayerPuzzle }) {
  return <Link href={`/puzzles/${puzzle.id}`} className="game-card group block overflow-hidden transition-transform duration-150 hover:-translate-y-0.5 active:scale-[.99]">
    <div className="relative">
      <Image src={puzzle.image} alt="" width={640} height={420} className="aspect-[16/10] w-full object-cover brightness-90 transition group-hover:brightness-110" />
      <div className="absolute left-3 top-3"><PuzzleStatusBadge status={puzzle.status} /></div>
    </div>
    <div className="grid gap-4 p-4">
      <div>
        <h3 className="font-display text-3xl font-bold">{puzzle.name}</h3>
        <p className="text-sm text-[var(--text-secondary)]">{puzzle.description}</p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <Meta icon={<Gauge className="h-4 w-4" />} label="levelId" value={String(puzzle.levelId)} />
        <Meta icon={<Clock className="h-4 w-4" />} label="Best" value={puzzle.personalBest ?? "Unsolved"} />
        <Meta icon={<Medal className="h-4 w-4" />} label="Rank" value={puzzle.leaderboardRank ? `#${puzzle.leaderboardRank}` : "NA"} />
      </div>
    </div>
  </Link>;
}

function Meta({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="rounded-lg border border-white/10 bg-white/[.04] p-2">
    <p className="flex items-center gap-1 text-xs text-[var(--text-muted)]">{icon}{label}</p>
    <p className="truncate font-semibold">{value}</p>
  </div>;
}
