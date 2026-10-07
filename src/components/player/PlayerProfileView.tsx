"use client";

import { useEffect, useState } from "react";
import { Puzzle, Sparkles } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { PlayerIdentityPanel } from "@/components/player/PlayerIdentityPanel";
import { EmptyState, LoadingState, SectionHeader } from "@/components/ui/kit";
import type { DataMode } from "@/config/dataMode";
import { puzzleService } from "@/services";
import type { PlayerProfile, PlayerPuzzle } from "@/types";
import { PuzzleStateBadge } from "@/components/puzzles/cards";
import { ProfileEditor } from "./ProfileEditor";

export function PlayerProfileView({ mode, initialPlayer, initialPuzzles = [] }: { mode: DataMode; initialPlayer?: PlayerProfile; initialPuzzles?: PlayerPuzzle[] }) {
  const { player: authenticatedPlayer } = useAuth();
  const player = mode === "api" ? authenticatedPlayer : initialPlayer;
  const [puzzles, setPuzzles] = useState(initialPuzzles);
  const [loading, setLoading] = useState(mode === "api");
  const [error, setError] = useState("");
  useEffect(() => {
    if (mode !== "api") return;
    puzzleService.getOwnedPuzzles().then(setPuzzles).catch(() => setError("Puzzle history could not be loaded.")).finally(() => setLoading(false));
  }, [mode]);
  if (!player) return <LoadingState rows={5} />;
  return <div className="grid min-w-0 gap-6">
    <PlayerIdentityPanel fallbackPlayer={player} mode={mode} placement={null} profileMode />
    {mode === "api" && <ProfileEditor key={player.internalId} />}
    <section className="min-w-0">
      <SectionHeader title="Puzzle History" icon={<Puzzle size={16} />} />
      {loading ? <LoadingState rows={3} /> : error ? <p role="alert" className="cz-surface p-5 text-sm text-[var(--cz-danger)]">{error}</p> : puzzles.length ? <ul className="cz-surface min-w-0 divide-y divide-[var(--cz-hairline)] overflow-hidden">{puzzles.slice(0, 8).map((puzzle) => <li key={puzzle.id} className="flex min-w-0 flex-col gap-2 px-4 py-3 min-[390px]:flex-row min-[390px]:items-center min-[390px]:justify-between"><div className="min-w-0"><p className="cz-display truncate text-sm font-semibold">{puzzle.name}</p><p className="truncate text-xs text-[var(--cz-text-tertiary)]">Level {puzzle.levelId}</p></div><PuzzleStateBadge status={puzzle.status} /></li>)}</ul> : <EmptyState icon={<Sparkles size={22} />} title="No puzzle history" body="Owned puzzles will appear here after they are added." />}
    </section>
  </div>;
}
