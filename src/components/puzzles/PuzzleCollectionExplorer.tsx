"use client";

import { useEffect, useState } from "react";
import { Puzzle } from "lucide-react";
import { dataMode } from "@/config/dataMode";
import { puzzleService } from "@/services";
import type { PlayerPuzzle } from "@/types";
import { EmptyState, LoadingState } from "@/components/ui/kit";
import { AddPuzzlePanel } from "./AddPuzzlePanel";
import { PuzzleCard } from "./cards";

export function PuzzleCollectionExplorer({ initial = [] }: { initial?: PlayerPuzzle[] }) {
  const [puzzles, setPuzzles] = useState(initial);
  const [loading, setLoading] = useState(dataMode === "api");
  const [error, setError] = useState("");

  useEffect(() => {
    if (dataMode !== "api") return;
    puzzleService.getOwnedPuzzles().then(setPuzzles).catch(() => setError("Your puzzles could not be loaded.")).finally(() => setLoading(false));
  }, []);

  return <div className="grid min-w-0 gap-5">
    <AddPuzzlePanel />
    {loading ? <LoadingState rows={3} /> : error ? <p role="alert" className="cz-surface p-5 text-sm text-[var(--cz-danger)]">{error}</p> : puzzles.length ? (
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">{puzzles.map((puzzle) => <PuzzleCard key={puzzle.id} puzzle={puzzle} />)}</div>
    ) : <EmptyState icon={<Puzzle size={22} />} title="No puzzles added" body="Add a CircZles puzzle code to begin your collection." />}
  </div>;
}
