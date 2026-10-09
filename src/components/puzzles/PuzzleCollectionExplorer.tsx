"use client";

import { usePlayerUiState } from "@/stores/playerUiState";
import { useEffect, useRef, useState } from "react";
import { Puzzle } from "lucide-react";
import { dataMode } from "@/config/dataMode";
import { puzzleService } from "@/services";
import type { PlayerPuzzle } from "@/types";
import { EmptyState, LoadingState } from "@/components/ui/kit";
import { AddPuzzlePanel } from "./AddPuzzlePanel";
import { PuzzleCard } from "./cards";

export function PuzzleCollectionExplorer({ initial = [] }: { initial?: PlayerPuzzle[] }) {
  const requestVersion = useRef(0);
  const player = usePlayerUiState(state => state.player);
  const [puzzles, setPuzzles] = useState(initial);
  const [loading, setLoading] = useState(dataMode === "api");
  const [error, setError] = useState("");

  useEffect(() => {
    if (dataMode !== "api") return;
    const version = ++requestVersion.current;
    let cancelled = false;
    puzzleService.getOwnedPuzzles().then(rows => { if (!cancelled && requestVersion.current === version) { setPuzzles(rows); setError(""); } }).catch(() => { if (!cancelled && requestVersion.current === version) setError("Your CircZles could not be loaded."); }).finally(() => { if (!cancelled && requestVersion.current === version) setLoading(false); });
    return () => { cancelled = true; };
  }, [player]);

  return <div className="grid min-w-0 gap-5">
    <AddPuzzlePanel onClaimed={puzzle => { requestVersion.current++; setPuzzles(rows => [...rows.filter(row => row.id !== puzzle.id), puzzle]); setError(""); setLoading(false); }} />
    {loading ? <LoadingState rows={3} /> : error ? <p role="alert" className="cz-surface p-5 text-sm text-[var(--cz-danger)]">{error}</p> : puzzles.length ? (
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">{puzzles.map((puzzle) => <PuzzleCard key={puzzle.id} puzzle={puzzle} />)}</div>
    ) : <EmptyState icon={<Puzzle size={22} />} title="No CircZles added" body="Add a CircZles SKU to begin your collection." />}
  </div>;
}
