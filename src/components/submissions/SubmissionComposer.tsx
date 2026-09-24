"use client";

import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import { dataMode } from "@/config/dataMode";
import { puzzleService } from "@/services";
import type { PlayerPuzzle } from "@/types";
import { EmptyState, LoadingState } from "@/components/ui/kit";
import { SubmissionStepper } from "./SubmissionStepper";

export function SubmissionComposer({ initial = [] }: { initial?: PlayerPuzzle[] }) {
  const [puzzles, setPuzzles] = useState(initial);
  const [loading, setLoading] = useState(dataMode === "api");
  const [error, setError] = useState("");
  useEffect(() => {
    if (dataMode !== "api") return;
    puzzleService.getOwnedPuzzles().then(setPuzzles).catch(() => setError("Your puzzles could not be loaded.")).finally(() => setLoading(false));
  }, []);
  if (loading) return <LoadingState rows={4} />;
  if (error) return <p role="alert" className="cz-surface p-5 text-sm text-[var(--cz-danger)]">{error}</p>;
  if (!puzzles.length) return <EmptyState icon={<Camera size={22} />} title="No puzzle available" body="Add a puzzle before submitting a solve attempt." />;
  return <SubmissionStepper puzzles={puzzles.map((puzzle) => ({ id: puzzle.id, playerPuzzleId: puzzle.playerPuzzleId, name: puzzle.name, levelId: puzzle.levelId }))} />;
}
