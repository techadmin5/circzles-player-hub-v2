"use client";

import Link from "next/link";
import { Camera, Gauge, RotateCcw, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { dataMode } from "@/config/dataMode";
import { puzzleService, submissionService } from "@/services";
import type { PlayerPuzzle, Submission } from "@/types";
import { EmptyState, LoadingState, SectionHeader, Stat } from "@/components/ui/kit";
import { SubmissionCard } from "@/components/submissions/cards";
import { PuzzleArt, PuzzleStateBadge } from "./cards";

export function PuzzleDetailExplorer({ id, initialPuzzle, initialSubmissions = [] }: { id: string; initialPuzzle?: PlayerPuzzle; initialSubmissions?: Submission[] }) {
  const [puzzle, setPuzzle] = useState(initialPuzzle);
  const [submissions, setSubmissions] = useState(initialSubmissions);
  const [loading, setLoading] = useState(dataMode === "api");
  const [error, setError] = useState("");
  useEffect(() => {
    if (dataMode !== "api") return;
    Promise.all([puzzleService.getPuzzle(id), submissionService.getSubmissions()]).then(([nextPuzzle, nextSubmissions]) => {
      setPuzzle(nextPuzzle);
      setSubmissions(nextSubmissions);
    }).catch(() => setError("Puzzle details could not be loaded.")).finally(() => setLoading(false));
  }, [id]);
  if (loading) return <LoadingState rows={5} />;
  if (error || !puzzle) return <EmptyState title="Puzzle unavailable" body={error || "This puzzle could not be found."} />;
  const related = submissions.filter((submission) => submission.puzzleId === puzzle.id).slice(0, 3);
  return <>
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)]">
      <div className="cz-surface min-w-0 overflow-hidden"><PuzzleArt src={puzzle.image} className="aspect-[4/3] w-full" /></div>
      <div className="cz-surface flex min-w-0 flex-col gap-4 p-5">
        <PuzzleStateBadge status={puzzle.status} />
        <p className="text-sm text-[var(--cz-text-secondary)]">{puzzle.description}</p>
        <div className="grid grid-cols-1 gap-2 min-[390px]:grid-cols-3"><Stat label="Difficulty levelId" value={String(puzzle.levelId)} icon={<Gauge size={12} />} tone="aqua" /><Stat label="Personal Best" value={puzzle.personalBest ?? "Unavailable"} /><Stat label="Placement" value={puzzle.leaderboardRank ? `#${puzzle.leaderboardRank}` : "Unavailable"} tone="gold" /></div>
        <div className="mt-auto flex flex-wrap gap-2"><Link href="/submissions/new" className="cz-btn cz-btn-primary"><Camera size={16} />Submit Attempt</Link><Link href="/leaderboard" className="cz-btn cz-btn-ghost"><Trophy size={16} />Leaderboard</Link><Link href="/puzzles" className="cz-btn cz-btn-ghost"><RotateCcw size={16} />Back</Link></div>
      </div>
    </div>
    <div className="mt-8"><SectionHeader title="Submission History" />{related.length ? <div className="grid gap-3">{related.map((submission) => <SubmissionCard key={submission.id} submission={submission} />)}</div> : <p className="cz-surface p-6 text-center text-sm text-[var(--cz-text-tertiary)]">No submissions yet for this puzzle.</p>}</div>
  </>;
}
