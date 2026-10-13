"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Medal, RefreshCw, Trophy } from "lucide-react";
import { EmptyState, LoadingState, Surface } from "@/components/ui/kit";
import type { DataMode } from "@/config/dataMode";
import { usePlayerUiState } from "@/stores/playerUiState";
import { ApiClientError } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import { leaderboardService } from "@/services";
import type { LeaderboardCatalog, LeaderboardCatalogItem, LeaderboardCategory, LeaderboardResponse, LeaderboardRow } from "@/types";
import type { PublicPlayerProfile } from "@/types";
import { PublicPlayerProfileModal } from "./PublicPlayerProfileModal";
import { LeaderboardPlacementEffect } from "./LeaderboardPlacementEffect";
import { LeaderboardPlayerIdentity } from "./LeaderboardPlayerIdentity";

const CATEGORIES: Array<{ id: LeaderboardCategory; label: string }> = [
  { id: "MAIN_LEVEL", label: "Levels" },
  { id: "SIDE_QUEST", label: "Side Quests" },
];

export function LeaderboardExplorer({ mode }: { mode: DataMode }) {
  const [catalog, setCatalog] = useState<LeaderboardCatalog | null>(null);
  const player = usePlayerUiState(state => state.player);
  const [level, setLevel] = useState(1);
  const [category, setCategory] = useState<LeaderboardCategory>("MAIN_LEVEL");
  const [selectedPuzzleId, setSelectedPuzzleId] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [boardAttempt, setBoardAttempt] = useState(0);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [profileCache] = useState(() => new Map<string, PublicPlayerProfile>());
  const closeProfile = useCallback(() => setSelectedProfileId(null), []);

  useEffect(() => {
    const controller = new AbortController();
    leaderboardService.getLeaderboardCatalog(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setCatalog(result);
      setCatalogError(null);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && !isAbortError(error)) setCatalogError(errorMessage(error, "We couldn't load the competition list."));
    }).finally(() => {
      if (!controller.signal.aborted) setCatalogLoading(false);
    });
    return () => controller.abort();
  }, [catalogAttempt, player]);

  const items = useMemo(() => categoryItems(catalog, category).filter(item => category !== "MAIN_LEVEL" || item.levelId === level), [catalog, category, level]);
  const activePuzzleId = items.find(item => item.puzzleId === selectedPuzzleId)?.puzzleId ?? items[0]?.puzzleId ?? null;
  const levels = useMemo(() => [...new Set([...Array.from({ length: 10 }, (_, i) => i + 1), ...(catalog?.mainLevels.map(item => item.levelId) ?? [])])].sort((a, b) => a - b), [catalog]);
  useEffect(() => {
    if (!activePuzzleId) return;
    const controller = new AbortController();
    leaderboardService.getLeaderboard(activePuzzleId, controller.signal).then(result => { if (!controller.signal.aborted) { setBoard(result); setBoardError(null); } }).catch((error: unknown) => {
      if (!controller.signal.aborted && !isAbortError(error)) setBoardError(errorMessage(error, "We couldn't load this leaderboard."));
    }).finally(() => { if (!controller.signal.aborted) setBoardLoading(false); });
    return () => controller.abort();
  }, [activePuzzleId, boardAttempt, player]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== "hidden") { setCatalogAttempt(value => value + 1); setBoardAttempt(value => value + 1); } };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  function resetBoard() { setBoard(null); setBoardError(null); setBoardLoading(false); setSelectedProfileId(null); }
  function changeCategory(next: LeaderboardCategory) { setCategory(next); setSelectedPuzzleId(null); resetBoard(); }

  if (catalogLoading) return <LoadingState rows={4} />;
  if (catalogError) return <RequestError message={catalogError} onRetry={() => {
    setCatalogLoading(true);
    setCatalogError(null);
    setCatalogAttempt((value) => value + 1);
  }} />;

  return (
    <div className="grid gap-5" data-data-mode={mode}>
      <div className="flex gap-1.5" role="tablist" aria-label="Competition category">
        {CATEGORIES.map((item) => (
          <button key={item.id} id={`category-${item.id}`} type="button" role="tab" aria-selected={category === item.id} tabIndex={category === item.id ? 0 : -1} aria-controls="leaderboard-category-panel"
            onKeyDown={event => {
              const index = CATEGORIES.findIndex(value => value.id === item.id);
              const next = event.key === "ArrowRight" ? (index + 1) % CATEGORIES.length : event.key === "ArrowLeft" ? (index + CATEGORIES.length - 1) % CATEGORIES.length : event.key === "Home" ? 0 : event.key === "End" ? CATEGORIES.length - 1 : null;
              if (next === null) return;
              event.preventDefault(); changeCategory(CATEGORIES[next].id);
              document.getElementById(`category-${CATEGORIES[next].id}`)?.focus();
            }}
            data-sound="tab"
            className={cn("cz-btn cz-btn-sm", category === item.id ? "cz-btn-primary" : "cz-btn-ghost")}
            onClick={() => changeCategory(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      <section id="leaderboard-category-panel" role="tabpanel" aria-labelledby={`category-${category}`} className="grid gap-5">
      {category === "MAIN_LEVEL" && <div className="grid grid-cols-2 gap-2 min-[390px]:grid-cols-5 xl:grid-cols-10" role="group" aria-label="Choose a level">{levels.map(value => <button key={value} type="button" aria-pressed={level === value} className={cn("cz-btn cz-btn-sm", level === value ? "cz-btn-primary" : "cz-btn-ghost")} onClick={() => { setLevel(value); setSelectedPuzzleId(null); resetBoard(); }}>Level {value}</button>)}</div>}
      <h2 className="cz-display text-lg">{category === "MAIN_LEVEL" ? `Level ${level} CircZles` : "Side Quest CircZles"}</h2>
      {items.length === 0 ? (
        category === "MAIN_LEVEL" ? <DiscoveryEmpty level={level} configured={false} /> : <EmptyState title="No Side Quests available yet." body="There are no enabled competitions in this category yet." icon={<Trophy size={24} />} />
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="Choose a CircZles">
            {items.map((item) => (
              <button key={item.puzzleId} type="button" aria-pressed={activePuzzleId === item.puzzleId} data-sound="tab"
                onClick={() => {
                  if (activePuzzleId === item.puzzleId) return;
                  setBoard(null);
                  setBoardError(null);
                  setBoardLoading(true);
                  setSelectedPuzzleId(item.puzzleId);
                }}
                className={cn("cz-btn min-w-0 px-3 py-2 text-left", activePuzzleId === item.puzzleId ? "cz-btn-primary" : "cz-btn-ghost")}>
                <span className="block min-w-0 break-words text-sm font-semibold">{item.puzzleName}</span>
              </button>
            ))}
          </div>
          {(boardLoading || !board || board.puzzle.puzzleId !== activePuzzleId) && !boardError && <LoadingState rows={5} />}
          {boardError && <RequestError message={boardError} onRetry={() => {
            setBoardLoading(true);
            setBoardError(null);
            setBoardAttempt((value) => value + 1);
          }} />}
          {!boardLoading && !boardError && board?.puzzle.puzzleId === activePuzzleId && <CompetitionBoard board={board} onOpenProfile={setSelectedProfileId} />}
        </>
      )}
      </section>
      {selectedProfileId && <PublicPlayerProfileModal key={selectedProfileId} publicPlayerId={selectedProfileId} cache={profileCache} onClose={closeProfile} />}
    </div>
  );
}

function CompetitionBoard({ board, onOpenProfile }: { board: LeaderboardResponse; onOpenProfile: (publicPlayerId: string) => void }) {
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
        <p className="text-xs text-[var(--cz-text-secondary)]">{competitionLabel(board.puzzle)}</p>
      </div>
      {entries.length === 0 ? (
        <DiscoveryEmpty level={board.puzzle.levelId} configured category={board.puzzle.category} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">{top.map((entry) => <PodiumEntry key={entry.publicPlayerId} entry={entry} onOpenProfile={onOpenProfile} />)}</div>
          {rest.length > 0 && (
            <Surface className="overflow-hidden p-2">
              <div className="grid grid-cols-[44px_minmax(0,1fr)_minmax(88px,auto)] gap-2 px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--cz-text-tertiary)]">
                <span>Rank</span><span>Player</span><span className="text-right">Best time</span>
              </div>
              {rest.map((entry) => <StandingRow key={entry.publicPlayerId} entry={entry} onOpenProfile={onOpenProfile} />)}
            </Surface>
          )}
        </>
      )}
      {board.currentPlayerEntry && !entries.some((entry) => entry.isCurrentPlayer) && (
        <Surface className="p-2 cz-ring-aqua">
          <p className="px-3 pt-1 text-[0.62rem] font-semibold uppercase tracking-wide text-[var(--cz-aqua)]">Your rank</p>
          <StandingRow entry={board.currentPlayerEntry} onOpenProfile={onOpenProfile} />
        </Surface>
      )}
    </div>
  );
}

function PodiumEntry({ entry, onOpenProfile }: { entry: LeaderboardRow; onOpenProfile: (publicPlayerId: string) => void }) {
  const tones = ["var(--cz-gold)", "var(--cz-text-secondary)", "#c58b5b"];
  const placement = Math.min(3, Math.max(1, entry.rank)) as 1 | 2 | 3;
  return (
    <button type="button" onClick={() => onOpenProfile(entry.publicPlayerId)} aria-label={`View ${entry.displayName}'s public profile`}
      className={cn("cz-raised relative isolate grid overflow-hidden content-between gap-2 px-4 py-3 text-left transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cz-aqua)] sm:min-h-32 sm:gap-4 sm:p-4", placement === 1 && "sm:min-h-36", entry.isCurrentPlayer && "cz-ring-aqua")}>
      <LeaderboardPlacementEffect placement={placement} />
      <div className="relative z-10 flex items-center justify-between gap-3">
        <Medal size={22} style={{ color: tones[entry.rank - 1] ?? "var(--cz-text-secondary)" }} aria-hidden="true" />
        <span className="cz-num text-sm font-bold">#{entry.rank}</span>
      </div>
      <div className="relative z-10 min-w-0 pr-20">
        <LeaderboardPlayerIdentity publicPlayerId={entry.publicPlayerId} displayName={entry.displayName} isCurrentPlayer={entry.isCurrentPlayer} />
        <p className="cz-num mt-1 text-xl font-bold text-[var(--cz-gold)]">{entry.bestTime}</p>
      </div>
    </button>
  );
}

function StandingRow({ entry, onOpenProfile }: { entry: LeaderboardRow; onOpenProfile: (publicPlayerId: string) => void }) {
  return (
    <button type="button" onClick={() => onOpenProfile(entry.publicPlayerId)} aria-label={`View ${entry.displayName}'s public profile`}
      className={cn("grid min-h-14 w-full grid-cols-[44px_minmax(0,1fr)_minmax(88px,auto)] items-center gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cz-aqua)]", entry.isCurrentPlayer ? "bg-[var(--cz-aqua-dim)] text-[var(--cz-aqua)]" : "border-t border-[var(--cz-hairline)]")}>
      <span className="cz-num font-bold">#{entry.rank}</span>
      <LeaderboardPlayerIdentity compact publicPlayerId={entry.publicPlayerId} displayName={entry.displayName} isCurrentPlayer={entry.isCurrentPlayer} />
      <span className="cz-num text-right text-sm font-bold">{entry.bestTime}</span>
    </button>
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

export function levelShopUrl(level: number): string | null {
  if (!Number.isInteger(level) || level < 1 || level > 10) return null;
  return level <= 5 ? "https://www.circzles.com/buy-circular-wooden-puzzles?By+Levels=Level%25201-5" : "https://www.circzles.com/buy-circular-wooden-puzzles?By+Levels=Level%25206-10";
}
function DiscoveryEmpty({ level, configured, category = "MAIN_LEVEL" }: { level: number; configured: boolean; category?: LeaderboardCategory }) {
  const url = category === "MAIN_LEVEL" ? levelShopUrl(level) : null;
  return <section className="cz-surface grid justify-items-center gap-3 p-6 text-center"><Trophy size={24} aria-hidden="true" /><h3 className="cz-display text-xl">{configured ? "Be the First to Set a Record!" : `Discover Level ${level} CircZles`}</h3><p className="text-sm text-[var(--cz-text-secondary)]">{configured ? "Take on the challenge, submit your solve, and earn your place on the leaderboard." : "No playable CircZles has an enabled leaderboard at this level yet."}</p>{url && <a href={url} target="_blank" rel="noopener noreferrer" className="cz-btn cz-btn-primary">Explore Level {level} CircZles</a>}</section>;
}
