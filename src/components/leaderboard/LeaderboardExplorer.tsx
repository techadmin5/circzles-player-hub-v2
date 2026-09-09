"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Medal, RefreshCw, Trophy } from "lucide-react";
import { EmptyState, LoadingState, Surface } from "@/components/ui/kit";
import type { DataMode } from "@/config/dataMode";
import { playSound } from "@/hooks/useSound";
import { ApiClientError } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import { leaderboardService } from "@/services";
import type { LeaderboardCatalog, LeaderboardCatalogItem, LeaderboardCategory, LeaderboardResponse, LeaderboardRow } from "@/types";

const CATEGORIES: Array<{ id: LeaderboardCategory; label: string }> = [
  { id: "MAIN_LEVEL", label: "Levels" },
  { id: "SIDE_QUEST", label: "Side Quests" },
];

export function LeaderboardExplorer({ mode }: { mode: DataMode }) {
  const [catalog, setCatalog] = useState<LeaderboardCatalog | null>(null);
  const [category, setCategory] = useState<LeaderboardCategory>("MAIN_LEVEL");
  const [selectedPuzzleId, setSelectedPuzzleId] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [boardAttempt, setBoardAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    leaderboardService.getLeaderboardCatalog(controller.signal).then((result) => {
      setCatalog(result);
      const initial = result.mainLevels[0] ?? result.sideQuests[0] ?? null;
      setCategory(result.mainLevels.length > 0 ? "MAIN_LEVEL" : "SIDE_QUEST");
      setSelectedPuzzleId(initial?.puzzleId ?? null);
      setBoardLoading(Boolean(initial));
    }).catch((error: unknown) => {
      if (!isAbortError(error)) setCatalogError(errorMessage(error, "We couldn't load the competition list."));
    }).finally(() => {
      if (!controller.signal.aborted) setCatalogLoading(false);
    });
    return () => controller.abort();
  }, [catalogAttempt]);

  useEffect(() => {
    if (!selectedPuzzleId) return;
    const controller = new AbortController();
    leaderboardService.getLeaderboard(selectedPuzzleId, controller.signal).then(setBoard).catch((error: unknown) => {
      if (!isAbortError(error)) setBoardError(errorMessage(error, "We couldn't load this leaderboard."));
    }).finally(() => {
      if (!controller.signal.aborted) setBoardLoading(false);
    });
    return () => controller.abort();
  }, [selectedPuzzleId, boardAttempt]);

  const items = useMemo(() => categoryItems(catalog, category), [catalog, category]);
  const changeCategory = useCallback((nextCategory: LeaderboardCategory) => {
    playSound("tab");
    setCategory(nextCategory);
    const nextItems = categoryItems(catalog, nextCategory);
    const next = nextItems.some((item) => item.puzzleId === selectedPuzzleId) ? selectedPuzzleId : nextItems[0]?.puzzleId ?? null;
    if (next !== selectedPuzzleId) {
      setBoard(null);
      setBoardError(null);
      setBoardLoading(Boolean(next));
      setSelectedPuzzleId(next);
    }
  }, [catalog, selectedPuzzleId]);

  if (catalogLoading) return <LoadingState rows={4} />;
  if (catalogError) return <RequestError message={catalogError} onRetry={() => {
    setCatalogLoading(true);
    setCatalogError(null);
    setCatalogAttempt((value) => value + 1);
  }} />;
  if (!catalog || (catalog.mainLevels.length === 0 && catalog.sideQuests.length === 0)) {
    return <EmptyState title="No leaderboard challenges are available yet." body="Competition leaderboards will appear here when they are available." icon={<Trophy size={24} />} />;
  }

  return (
    <div className="grid gap-5" data-data-mode={mode}>
      <div className="flex gap-1.5" role="tablist" aria-label="Competition category">
        {CATEGORIES.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={category === item.id}
            className={cn("cz-btn cz-btn-sm", category === item.id ? "cz-btn-primary" : "cz-btn-ghost")}
            onClick={() => changeCategory(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState title={category === "MAIN_LEVEL" ? "No Levels available yet." : "No Side Quests available yet."} body="There are no competitions in this category yet." icon={<Trophy size={24} />} />
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Choose a competition">
            {items.map((item) => (
              <button key={item.puzzleId} type="button" aria-pressed={selectedPuzzleId === item.puzzleId}
                onClick={() => {
                  playSound("tab");
                  if (selectedPuzzleId === item.puzzleId) return;
                  setBoard(null);
                  setBoardError(null);
                  setBoardLoading(true);
                  setSelectedPuzzleId(item.puzzleId);
                }}
                className={cn("cz-btn min-w-fit px-3 py-2 text-left", selectedPuzzleId === item.puzzleId ? "cz-btn-primary" : "cz-btn-ghost")}>
                <span className="block text-xs font-semibold">{competitionLabel(item)}</span>
                <span className="block text-[0.68rem] opacity-75">{item.puzzleName}{item.runCode ? ` · ${item.runCode}` : ""}</span>
              </button>
            ))}
          </div>
          {boardLoading && <LoadingState rows={5} />}
          {boardError && <RequestError message={boardError} onRetry={() => {
            setBoardLoading(true);
            setBoardError(null);
            setBoardAttempt((value) => value + 1);
          }} />}
          {board && <CompetitionBoard board={board} />}
        </>
      )}
    </div>
  );
}

function CompetitionBoard({ board }: { board: LeaderboardResponse }) {
  const entries = board.entries.slice(0, 10);
  const top = entries.slice(0, 3);
  const rest = entries.slice(3);
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-[var(--cz-hairline)] pb-4">
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--cz-aqua)]">{board.puzzle.category === "MAIN_LEVEL" ? "Level competition" : "Side quest"}</p>
          <h2 className="cz-display text-lg font-bold">{board.puzzle.puzzleName}</h2>
        </div>
        <p className="text-xs text-[var(--cz-text-secondary)]">{competitionLabel(board.puzzle)}{board.puzzle.runCode ? ` · ${board.puzzle.runCode}` : ""}</p>
      </div>
      {entries.length === 0 ? (
        <EmptyState title="No ranked solves yet." body="Be the first to set a verified time." icon={<Trophy size={24} />} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">{top.map((entry) => <PodiumEntry key={entry.publicPlayerId} entry={entry} />)}</div>
          {rest.length > 0 && (
            <Surface className="overflow-hidden p-2">
              <div className="grid grid-cols-[44px_minmax(0,1fr)_minmax(88px,auto)] gap-2 px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--cz-text-tertiary)]">
                <span>Rank</span><span>Player</span><span className="text-right">Best time</span>
              </div>
              {rest.map((entry) => <StandingRow key={entry.publicPlayerId} entry={entry} />)}
            </Surface>
          )}
        </>
      )}
      {board.currentPlayerEntry && !entries.some((entry) => entry.isCurrentPlayer) && (
        <Surface className="p-2 cz-ring-aqua">
          <p className="px-3 pt-1 text-[0.62rem] font-semibold uppercase tracking-wide text-[var(--cz-aqua)]">Your rank</p>
          <StandingRow entry={board.currentPlayerEntry} />
        </Surface>
      )}
    </div>
  );
}

function PodiumEntry({ entry }: { entry: LeaderboardRow }) {
  const tones = ["var(--cz-gold)", "var(--cz-text-secondary)", "#c58b5b"];
  return (
    <div className={cn("cz-raised grid min-h-32 content-between gap-4 p-4", entry.isCurrentPlayer && "cz-ring-aqua")}>
      <div className="flex items-center justify-between gap-3">
        <Medal size={22} style={{ color: tones[entry.rank - 1] ?? "var(--cz-text-secondary)" }} aria-hidden="true" />
        <span className="cz-num text-sm font-bold">#{entry.rank}</span>
      </div>
      <div className="min-w-0">
        <p className="truncate font-semibold">{entry.displayName}{entry.isCurrentPlayer ? " (You)" : ""}</p>
        <p className="cz-num mt-1 text-xl font-bold text-[var(--cz-gold)]">{entry.bestTime}</p>
      </div>
    </div>
  );
}

function StandingRow({ entry }: { entry: LeaderboardRow }) {
  return (
    <div className={cn("grid min-h-14 grid-cols-[44px_minmax(0,1fr)_minmax(88px,auto)] items-center gap-2 rounded-md px-3 py-2", entry.isCurrentPlayer ? "bg-[var(--cz-aqua-dim)] text-[var(--cz-aqua)]" : "border-t border-[var(--cz-hairline)]")}>
      <span className="cz-num font-bold">#{entry.rank}</span>
      <span className="min-w-0 truncate text-sm font-semibold">{entry.displayName}{entry.isCurrentPlayer ? " (You)" : ""}</span>
      <span className="cz-num text-right text-sm font-bold">{entry.bestTime}</span>
    </div>
  );
}

function RequestError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="cz-surface grid justify-items-center gap-3 border-[rgba(242,85,90,0.4)] p-5 text-center" role="alert">
      <AlertCircle className="text-[var(--cz-danger)]" size={22} aria-hidden="true" />
      <p className="text-sm text-[var(--cz-text-secondary)]">{message}</p>
      <button type="button" className="cz-btn cz-btn-ghost cz-btn-sm" onClick={onRetry}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
    </div>
  );
}

function categoryItems(catalog: LeaderboardCatalog | null, category: LeaderboardCategory): LeaderboardCatalogItem[] {
  if (!catalog) return [];
  return category === "MAIN_LEVEL" ? catalog.mainLevels : catalog.sideQuests;
}

function competitionLabel(puzzle: Pick<LeaderboardCatalogItem, "category" | "levelId">) {
  return `${puzzle.category === "MAIN_LEVEL" ? "Level" : "Side Quest"} ${puzzle.levelId}`;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorMessage(error: unknown, fallback: string) {
  if (!(error instanceof ApiClientError)) return fallback;
  if (error.status === 401) return "Your session has expired. Sign in again to view this leaderboard.";
  if (error.status === 404) return "This competition is not available.";
  return fallback;
}
