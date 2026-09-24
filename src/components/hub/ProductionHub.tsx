"use client";

import Link from "next/link";
import { ArrowRight, Camera, Gift, Plus, Sparkles, Target, TicketCheck, Trophy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { HubMetricStrip } from "@/components/hub/HubMetricStrip";
import { PlayerIdentityPanel } from "@/components/player/PlayerIdentityPanel";
import { PuzzleCard } from "@/components/puzzles/cards";
import { EmptyState, LoadingState, SectionHeader } from "@/components/ui/kit";
import type { DataMode } from "@/config/dataMode";
import { leaderboardService, missionService, puzzleService, rewardService } from "@/services";
import type { LeaderboardResponse, Mission, PlayerProfile, PlayerPuzzle, RewardWheelStatus } from "@/types";

interface HubState { puzzles: PlayerPuzzle[]; missions: Mission[]; leaderboard: LeaderboardResponse | null; wheel: RewardWheelStatus | null; }

export function ProductionHub({ fallbackPlayer, mode }: { fallbackPlayer?: PlayerProfile; mode: DataMode }) {
  const { player: authenticatedPlayer } = useAuth();
  const player = authenticatedPlayer ?? fallbackPlayer;
  const [state, setState] = useState<HubState>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const [puzzles, missions, catalog, wheel] = await Promise.all([puzzleService.getOwnedPuzzles(), missionService.getMissions(controller.signal), leaderboardService.getLeaderboardCatalog(controller.signal), rewardService.getWheelStatus(controller.signal)]);
        const firstPuzzle = [...catalog.mainLevels, ...catalog.sideQuests][0];
        const leaderboard = firstPuzzle ? await leaderboardService.getLeaderboard(firstPuzzle.puzzleId, controller.signal) : null;
        if (!controller.signal.aborted) setState({ puzzles, missions, leaderboard, wheel });
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError") && !controller.signal.aborted) setError(true);
      }
    })();
    return () => controller.abort();
  }, [mode]);
  if (!player) return <LoadingState rows={5} />;
  if (!state && !error) return <div className="grid gap-6"><PlayerIdentityPanel fallbackPlayer={player} mode={mode} /><HubMetricStrip player={player} mode={mode} /><LoadingState rows={5} /></div>;
  if (error || !state) return <div className="grid gap-6"><PlayerIdentityPanel fallbackPlayer={player} mode={mode} /><HubMetricStrip player={player} mode={mode} /><EmptyState icon={<Sparkles size={22} />} title="Hub data unavailable" body="Your session is active, but Player Hub data could not be loaded. Try again shortly." /></div>;
  const activeMission = state.missions.find((mission) => mission.status === "ACTIVE") ?? state.missions[0];
  const pendingPuzzle = state.puzzles.find((puzzle) => puzzle.status === "SUBMISSION_PENDING");
  const currentPlacement = state.leaderboard?.currentPlayerEntry;
  const wheel = state.wheel?.wheel;
  const progress = activeMission ? Math.min(100, Math.round((activeMission.progress.current / Math.max(1, activeMission.progress.target)) * 100)) : 0;
  return <div className="grid min-w-0 grid-cols-1 gap-6">
    <PlayerIdentityPanel fallbackPlayer={player} mode={mode} placement={null} />
    <HubMetricStrip player={player} mode={mode} />
    <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <div className="cz-surface grid min-w-0 gap-5 p-4 sm:p-5">
        <div className="grid min-w-0 gap-2 sm:grid-cols-2"><ActionTile href="/puzzles" icon={<Plus size={17} />} label="Add Puzzle" /><ActionTile href="/submissions/new" icon={<Camera size={17} />} label="Submit Attempt" /><ActionTile href="/leaderboard" icon={<Trophy size={17} />} label="Leaderboard" /><ActionTile href="/missions" icon={<Gift size={17} />} label="Claim Missions" /></div>
        {activeMission ? <div className="cz-inset grid min-w-0 gap-4 p-4 md:grid-cols-[minmax(0,1fr)_200px]"><div className="min-w-0"><p className="flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-[var(--cz-aqua)]"><Sparkles size={12} />Active Challenge</p><h2 className="cz-display mt-1 break-words text-xl font-bold">{activeMission.title}</h2><p className="mt-1 text-sm text-[var(--cz-text-secondary)]">{activeMission.description}</p><div className="cz-track mt-3"><div className="cz-track-fill" style={{ width: `${progress}%` }} /></div></div><div className="grid place-items-center gap-1 rounded-xl border border-[rgba(232,180,80,0.28)] bg-[var(--cz-gold-dim)] p-4 text-center"><Gift className="h-7 w-7 text-[var(--cz-gold)]" /><p className="cz-display text-lg font-bold text-[var(--cz-gold)]">{activeMission.rewards.map((reward) => reward.label).join(" + ")}</p><p className="text-[0.62rem] text-[var(--cz-text-tertiary)]">On verified completion</p></div></div> : <EmptyState icon={<Target size={22} />} title="No active missions" body="New verified missions will appear here when available." />}
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-1"><StatusPanel icon={<Target size={13} />} label="Submission Status" title={pendingPuzzle?.name ?? "No pending solves"} body={pendingPuzzle ? "Pending review" : "Submit an attempt to see review status."} href="/submissions" /><StatusPanel icon={<Trophy size={13} />} label="Competitive Result" tone="gold" title={currentPlacement ? `Rank #${currentPlacement.rank}` : "No ranked time yet"} body={currentPlacement ? `${currentPlacement.bestTime} on ${state.leaderboard?.puzzle.puzzleName}` : "Your verified leaderboard placement will appear here."} href="/leaderboard" /><StatusPanel icon={<TicketCheck size={13} />} label="Reward Wheel" tone="violet" title={wheel?.canSpin ? (wheel.nextSpinIsFree ? "Free spin available" : "Spin available") : "No spin available"} body={wheel ? `${wheel.spinsRemaining} of ${wheel.maxSpinsPerCycle} spins remaining.` : "No Reward Wheel is currently active."} href="/rewards" /></div>
    </section>
    <section className="min-w-0"><SectionHeader title="Leaderboard Snapshot" icon={<Trophy size={16} />} action={<Link href="/leaderboard" className="text-xs text-[var(--cz-aqua)]">Full board</Link>} />{state.leaderboard?.entries.length ? <div className="cz-surface min-w-0 divide-y divide-[var(--cz-hairline)] p-2">{state.leaderboard.entries.slice(0, 5).map((entry) => <Link href={`/profile/${entry.publicPlayerId}`} key={entry.publicPlayerId} className="grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-3 hover:bg-white/[0.03]"><span className="cz-num text-sm font-bold text-[var(--cz-gold)]">#{entry.rank}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{entry.displayName}</span><span className="block truncate text-[0.68rem] text-[var(--cz-text-tertiary)]">{entry.publicPlayerId}</span></span><span className="cz-num whitespace-nowrap text-xs text-[var(--cz-text-secondary)]">{entry.bestTime}</span></Link>)}</div> : <EmptyState icon={<Trophy size={22} />} title="No leaderboard entries" body="Verified solve times will appear here." />}</section>
    <section className="min-w-0"><SectionHeader title="Puzzle Journey" icon={<Sparkles size={16} />} action={<Link href="/puzzles" className="text-xs text-[var(--cz-aqua)]">Manage</Link>} />{state.puzzles.length ? <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">{state.puzzles.slice(0, 3).map((puzzle) => <PuzzleCard key={puzzle.id} puzzle={puzzle} />)}</div> : <EmptyState icon={<Plus size={22} />} title="No puzzles added" body="Add a CircZles puzzle to begin your solving journey." />}</section>
  </div>;
}

function ActionTile({ href, icon, label }: { href: string; icon: ReactNode; label: string }) { return <Link href={href} className="cz-raised flex min-w-0 items-center gap-3 px-4 py-3.5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[rgba(61,234,212,0.3)] bg-[var(--cz-aqua-dim)] text-[var(--cz-aqua)]">{icon}</span><span className="cz-display min-w-0 truncate text-sm font-semibold">{label}</span><ArrowRight size={15} className="ml-auto shrink-0 text-[var(--cz-text-tertiary)]" /></Link>; }
function StatusPanel({ icon, label, title, body, tone = "aqua", href }: { icon: ReactNode; label: string; title: string; body: string; tone?: "aqua" | "gold" | "violet"; href: string }) { const color = tone === "gold" ? "var(--cz-gold)" : tone === "violet" ? "var(--cz-violet)" : "var(--cz-aqua)"; return <Link href={href} className="cz-surface block min-w-0 p-4"><p className="flex items-center gap-2 text-[0.62rem] font-semibold uppercase tracking-[0.14em]" style={{ color }}>{icon}{label}</p><h3 className="cz-display mt-2 break-words text-lg font-bold">{title}</h3><p className="mt-1 text-sm text-[var(--cz-text-secondary)]">{body}</p></Link>; }
