import Image from "next/image";
import Link from "next/link";
import { Clock, Gauge, Medal } from "lucide-react";
import type { PlayerPuzzle, PuzzleStatus } from "@/types";
import { Chip } from "@/components/ui/kit";
import { cn } from "@/lib/utils";

const STATUS_META: Record<PuzzleStatus, { label: string; tone: "default" | "aqua" | "gold" | "emerald" | "danger" | "violet" }> = {
  OWNED: { label: "Owned", tone: "default" },
  READY_TO_SOLVE: { label: "Ready to Solve", tone: "aqua" },
  SUBMISSION_PENDING: { label: "Submission Pending", tone: "gold" },
  APPROVED: { label: "Approved", tone: "emerald" },
  REJECTED: { label: "Rejected", tone: "danger" },
  COMPLETED: { label: "Completed", tone: "violet" },
};

export function PuzzleStateBadge({ status }: { status: PuzzleStatus }) {
  const meta = STATUS_META[status] ?? { label: status, tone: "default" as const };
  return <Chip tone={meta.tone}>{meta.label}</Chip>;
}

/** Uses real puzzle.image when present; renders a branded slot for placeholder art. */
export function PuzzleArt({ src, className }: { src: string; className?: string }) {
  const isPlaceholder = !src || src.includes("placeholder");
  if (isPlaceholder) {
    return (
      <div className={cn("relative grid place-items-center overflow-hidden bg-[radial-gradient(circle_at_50%_35%,rgba(61,234,212,0.10),transparent_70%)]", className)}>
        <div className="grid place-items-center gap-1 text-[var(--cz-text-tertiary)]">
          <span className="grid h-11 w-11 place-items-center rounded-full border border-[var(--cz-hairline-strong)]"><span className="h-4 w-4 rounded-full border-2 border-[var(--cz-aqua)]" /></span>
          <span className="cz-display text-[0.62rem] uppercase tracking-[0.2em]">CircZles</span>
        </div>
      </div>
    );
  }
  return <div className={cn("relative overflow-hidden", className)}><Image src={src} unoptimized={src.startsWith("https://")} alt="" fill sizes="(min-width:768px) 33vw, 100vw" className="object-cover" /></div>;
}

export function PuzzleCard({ puzzle }: { puzzle: PlayerPuzzle }) {
  return (
    <Link href={`/puzzles/${puzzle.id}`} data-testid={`puzzle-card-${puzzle.id}`} className="cz-raised group block overflow-hidden transition-transform duration-150 hover:-translate-y-0.5">
      <div className="relative">
        <PuzzleArt src={puzzle.image} className="aspect-[16/10] w-full" />
        <div className="absolute left-3 top-3"><PuzzleStateBadge status={puzzle.status} /></div>
      </div>
      <div className="grid gap-3 p-4">
        <div>
          <h3 className="cz-display text-lg font-bold">{puzzle.name}</h3>
          <p className="text-xs text-[var(--cz-text-tertiary)]">puzzleId {puzzle.id} · difficulty levelId {puzzle.levelId}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Meta icon={<Gauge size={13} />} label="Level" value={String(puzzle.levelId)} />
          <Meta icon={<Clock size={13} />} label="Best" value={puzzle.personalBest ?? "—"} />
          <Meta icon={<Medal size={13} />} label="Rank" value={puzzle.leaderboardRank ? `#${puzzle.leaderboardRank}` : "—"} />
        </div>
      </div>
    </Link>
  );
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="cz-inset px-2 py-1.5">
      <p className="flex items-center gap-1 text-[0.6rem] uppercase tracking-wide text-[var(--cz-text-tertiary)]">{icon}{label}</p>
      <p className="cz-num truncate text-sm font-semibold">{value}</p>
    </div>
  );
}
