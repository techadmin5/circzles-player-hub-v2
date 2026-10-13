"use client";

import Link from "next/link";
import { Camera, Gauge, RotateCcw, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { usePlayerUiState } from "@/stores/playerUiState";
import { dataMode } from "@/config/dataMode";
import { puzzleService, submissionService } from "@/services";
import type { PlayerPuzzle, Submission } from "@/types";
import { EmptyState, LoadingState, SectionHeader, Stat } from "@/components/ui/kit";
import { SubmissionCard } from "@/components/submissions/cards";
import { PuzzleArt, PuzzleStateBadge } from "./cards";

export function PuzzleDetailExplorer({ id, initialPuzzle, initialSubmissions = [] }: { id: string; initialPuzzle?: PlayerPuzzle; initialSubmissions?: Submission[] }) {
  const player = usePlayerUiState(state => state.player);
  const [refresh, setRefresh] = useState(0);
  const [puzzle, setPuzzle] = useState(initialPuzzle);
  const [submissions, setSubmissions] = useState(initialSubmissions);
  const [loading, setLoading] = useState(dataMode === "api");
  const [error, setError] = useState("");
  useEffect(() => {
    if (dataMode !== "api") return;
    let cancelled = false;
    Promise.all([puzzleService.getOwnedPuzzles(), submissionService.getSubmissions()]).then(async ([owned, nextSubmissions]) => {
      const nextPuzzle = owned.find(item => item.id === id) ?? await puzzleService.getPuzzle(id);
      if (cancelled) return;
      setPuzzle(nextPuzzle);
      setError("");
      setSubmissions(nextSubmissions);
    }).catch(() => { if (!cancelled) setError("CircZles details could not be loaded."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, player, refresh]);
  useEffect(() => { const update = () => { if (document.visibilityState !== "hidden") setRefresh(value => value + 1); }; window.addEventListener("focus", update); document.addEventListener("visibilitychange", update); return () => { window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); }; }, []);
  if (loading) return <LoadingState rows={5} />;
  if (error || !puzzle) return <EmptyState title="CircZles unavailable" body={error || "This CircZles could not be found."} />;
  const related = submissions.filter((submission) => submission.puzzleId === puzzle.id).slice(0, 3);
  return <>
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)]">
      <div className="cz-surface min-w-0 overflow-hidden"><PuzzleArt src={puzzle.image} className="aspect-[4/3] w-full" /></div>
      <div className="cz-surface flex min-w-0 flex-col gap-4 p-5">
        <PuzzleStateBadge status={puzzle.status} />
        <p className="text-sm text-[var(--cz-text-secondary)]">{puzzle.description}</p>
        <div className="grid grid-cols-1 gap-2 min-[390px]:grid-cols-3"><Stat label="Level" value={String(puzzle.levelId)} icon={<Gauge size={12} />} tone="aqua" /><Stat label="Best" value={puzzle.personalBest ?? "—"} /><Stat label="Rank" value={puzzle.leaderboardEligible === false ? "Inactive" : puzzle.leaderboardRank ? `#${puzzle.leaderboardRank}` : "—"} tone="gold" /></div>
        {puzzle.latestSubmissionStatus && <p className="text-sm">Latest attempt: {puzzle.latestSubmissionStatus.replaceAll("_", " ").toLowerCase()}</p>}
        <div className="mt-auto flex flex-wrap gap-2"><Link href={`/submissions/new?puzzleId=${encodeURIComponent(puzzle.id)}`} className="cz-btn cz-btn-primary"><Camera size={16} />Submit Attempt</Link><Link href="/leaderboard" className="cz-btn cz-btn-ghost"><Trophy size={16} />Leaderboard</Link><Link href="/puzzles" className="cz-btn cz-btn-ghost"><RotateCcw size={16} />Back</Link></div>
      </div>
    </div>
    <div className="mt-8"><SectionHeader title="Submission History" />{related.length ? <div className="grid gap-3">{related.map((submission) => <SubmissionCard key={submission.id} submission={submission} />)}</div> : <p className="cz-surface p-6 text-center text-sm text-[var(--cz-text-tertiary)]">No submissions yet for this CircZles.</p>}</div>
  </>;
}
