import Link from "next/link";
import { Camera, Gauge, RotateCcw, Trophy } from "lucide-react";
import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader, SectionHeader, Stat } from "@/components/ui/kit";
import { PuzzleArt, PuzzleStateBadge } from "@/components/puzzles/cards";
import { SubmissionCard } from "@/components/submissions/cards";
import { playerService, puzzleService, submissionService } from "@/services";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [player, puzzle, subs] = await Promise.all([playerService.getMockCurrentPlayer(), puzzleService.getPuzzle(id), submissionService.getSubmissions()]);
  const related = subs.filter((s) => s.puzzleId === puzzle.id).slice(0, 3);

  return (
    <GameShell player={player}>
      <PageHeader kicker={`SKU ${puzzle.sku}`} title={puzzle.name} subtitle={`puzzleId ${puzzle.id}`} />
      <div className="grid gap-5 lg:grid-cols-[0.85fr_1fr]">
        <div className="cz-surface overflow-hidden">
          <PuzzleArt src={puzzle.image} className="aspect-[4/3] w-full" />
        </div>
        <div className="cz-surface flex flex-col gap-4 p-5">
          <PuzzleStateBadge status={puzzle.status} />
          <p className="text-sm text-[var(--cz-text-secondary)]">{puzzle.description}</p>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Difficulty levelId" value={String(puzzle.levelId)} icon={<Gauge size={12} />} tone="aqua" />
            <Stat label="Personal Best" value={puzzle.personalBest ?? "—"} />
            <Stat label="Placement" value={puzzle.leaderboardRank ? `#${puzzle.leaderboardRank}` : "—"} tone="gold" />
          </div>
          <div className="mt-auto flex flex-wrap gap-2">
            <Link href="/submissions/new" className="cz-btn cz-btn-primary"><Camera size={16} />Submit Attempt</Link>
            <Link href="/leaderboard" className="cz-btn cz-btn-ghost"><Trophy size={16} />Leaderboard</Link>
            <Link href="/puzzles" className="cz-btn cz-btn-ghost"><RotateCcw size={16} />Back</Link>
          </div>
        </div>
      </div>
      <div className="mt-8">
        <SectionHeader title="Submission History" />
        {related.length > 0 ? <div className="grid gap-3">{related.map((s) => <SubmissionCard key={s.id} submission={s} />)}</div> : <p className="cz-surface p-6 text-center text-sm text-[var(--cz-text-tertiary)]">No submissions yet for this puzzle.</p>}
      </div>
    </GameShell>
  );
}
