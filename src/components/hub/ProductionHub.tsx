"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Camera, Gift, Plus, Sparkles, Target, TicketCheck, Trophy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { HubMetricStrip } from "@/components/hub/HubMetricStrip";
import { PlayerIdentityPanel } from "@/components/player/PlayerIdentityPanel";
import { PuzzleCard } from "@/components/puzzles/cards";
import { EmptyState, ErrorState, LoadingState, SectionHeader } from "@/components/ui/kit";
import { DEFAULT_AVATAR } from "@/config/assets";
import type { DataMode } from "@/config/dataMode";
import { leaderboardService, missionService, puzzleService, rewardService } from "@/services";
import type { AuthenticatedPlayerIdentity, LeaderboardResponse, Mission, PlayerProfile, PlayerPuzzle, RewardWheelStatus } from "@/types";

type Resource<T> = { status: "loading" } | { status: "error" } | { status: "success"; data: T };
const loadingResource = { status: "loading" } as const;

export function ProductionHub({ fallbackPlayer, mode }: { fallbackPlayer?: PlayerProfile; mode: DataMode }) {
  const { identity: authenticatedIdentity, player: authenticatedPlayer, profileStatus } = useAuth();
  const player = authenticatedPlayer ?? fallbackPlayer;
  const identity = authenticatedIdentity ?? player;
  const [puzzles, setPuzzles] = useState<Resource<PlayerPuzzle[]>>(loadingResource);
  const [missions, setMissions] = useState<Resource<Mission[]>>(loadingResource);
  const [leaderboard, setLeaderboard] = useState<Resource<LeaderboardResponse | null>>(loadingResource);
  const [wheel, setWheel] = useState<Resource<RewardWheelStatus | null>>(loadingResource);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    function load<T>(promise: Promise<T>, setResource: (resource: Resource<T>) => void) {
      promise.then((data) => {
        if (!cancelled) setResource({ status: "success", data });
      }).catch((cause) => {
        if (!cancelled && !(cause instanceof DOMException && cause.name === "AbortError")) setResource({ status: "error" });
      });
    }

    load(puzzleService.getOwnedPuzzles(), setPuzzles);
    load(missionService.getMissions(controller.signal), setMissions);
    load(rewardService.getWheelStatus(controller.signal), setWheel);
    load((async () => {
      const catalog = await leaderboardService.getLeaderboardCatalog(controller.signal);
      const firstPuzzle = [...catalog.mainLevels, ...catalog.sideQuests][0];
      return firstPuzzle ? leaderboardService.getLeaderboard(firstPuzzle.puzzleId, controller.signal) : null;
    })(), setLeaderboard);

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [mode]);

  const activeMission = missions.status === "success" ? missions.data.find((mission) => mission.status === "ACTIVE") ?? missions.data[0] : undefined;
  const pendingPuzzle = puzzles.status === "success" ? puzzles.data.find((puzzle) => puzzle.status === "SUBMISSION_PENDING") : undefined;
  const currentPlacement = leaderboard.status === "success" ? leaderboard.data?.currentPlayerEntry : undefined;
  const wheelData = wheel.status === "success" ? wheel.data?.wheel : undefined;
  const progress = activeMission ? Math.min(100, Math.round((activeMission.progress.current / Math.max(1, activeMission.progress.target)) * 100)) : 0;

  return <div className="grid min-w-0 grid-cols-1 gap-6">
    {player ? <><PlayerIdentityPanel fallbackPlayer={player} mode={mode} placement={null} /><HubMetricStrip player={player} mode={mode} /></> : <><CoreIdentityPanel identity={identity} profileStatus={profileStatus} /><HubMetricLoading /></>}

    <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <div className="cz-surface grid min-w-0 gap-5 p-4 sm:p-5">
        <div className="grid min-w-0 gap-2 sm:grid-cols-2"><ActionTile href="/puzzles" icon={<Plus size={17} />} label="Add Puzzle" /><ActionTile href="/submissions/new" icon={<Camera size={17} />} label="Submit Attempt" /><ActionTile href="/leaderboard" icon={<Trophy size={17} />} label="Leaderboard" /><ActionTile href="/missions" icon={<Gift size={17} />} label="Claim Missions" /></div>
        {missions.status === "loading" ? <LoadingState rows={1} /> : missions.status === "error" ? <ErrorState message="Missions could not be loaded." /> : activeMission ? <div className="cz-inset grid min-w-0 gap-4 p-4 md:grid-cols-[minmax(0,1fr)_200px]"><div className="min-w-0"><p className="flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-[var(--cz-aqua)]"><Sparkles size={12} />Active Challenge</p><h2 className="cz-display mt-1 break-words text-xl font-bold">{activeMission.title}</h2><p className="mt-1 text-sm text-[var(--cz-text-secondary)]">{activeMission.description}</p><div className="cz-track mt-3"><div className="cz-track-fill" style={{ width: `${progress}%` }} /></div></div><div className="grid place-items-center gap-1 rounded-xl border border-[rgba(232,180,80,0.28)] bg-[var(--cz-gold-dim)] p-4 text-center"><Gift className="h-7 w-7 text-[var(--cz-gold)]" /><p className="cz-display text-lg font-bold text-[var(--cz-gold)]">{activeMission.rewards.map((reward) => reward.label).join(" + ")}</p><p className="text-[0.62rem] text-[var(--cz-text-tertiary)]">On verified completion</p></div></div> : <EmptyState icon={<Target size={22} />} title="No active missions" body="New verified missions will appear here when available." />}
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {puzzles.status === "loading" ? <StatusPanelLoading /> : <StatusPanel icon={<Target size={13} />} label="Submission Status" title={puzzles.status === "error" ? "Unavailable" : pendingPuzzle?.name ?? "No pending solves"} body={puzzles.status === "error" ? "Puzzle status could not be loaded." : pendingPuzzle ? "Pending review" : "Submit an attempt to see review status."} href="/submissions" />}
        {leaderboard.status === "loading" ? <StatusPanelLoading /> : <StatusPanel icon={<Trophy size={13} />} label="Competitive Result" tone="gold" title={leaderboard.status === "error" ? "Unavailable" : currentPlacement ? `Rank #${currentPlacement.rank}` : "No ranked time yet"} body={leaderboard.status === "error" ? "Leaderboard status could not be loaded." : currentPlacement ? `${currentPlacement.bestTime} on ${leaderboard.status === "success" ? leaderboard.data?.puzzle.puzzleName : ""}` : "Your verified leaderboard placement will appear here."} href="/leaderboard" />}
        {wheel.status === "loading" ? <StatusPanelLoading /> : <StatusPanel icon={<TicketCheck size={13} />} label="Reward Wheel" tone="violet" title={wheel.status === "error" ? "Unavailable" : wheelData?.canSpin ? (wheelData.nextSpinIsFree ? "Free spin available" : "Spin available") : "No spin available"} body={wheel.status === "error" ? "Reward Wheel status could not be loaded." : wheelData ? `${wheelData.spinsRemaining} of ${wheelData.maxSpinsPerCycle} spins remaining.` : "No Reward Wheel is currently active."} href="/rewards" />}
      </div>
    </section>

    <section className="min-w-0"><SectionHeader title="Leaderboard Snapshot" icon={<Trophy size={16} />} action={<Link href="/leaderboard" className="text-xs text-[var(--cz-aqua)]">Full board</Link>} />{leaderboard.status === "loading" ? <LoadingState rows={3} /> : leaderboard.status === "error" ? <ErrorState message="Leaderboard could not be loaded." /> : leaderboard.data?.entries.length ? <div className="cz-surface min-w-0 divide-y divide-[var(--cz-hairline)] p-2">{leaderboard.data.entries.slice(0, 5).map((entry) => <Link href={`/profile/${entry.publicPlayerId}`} key={entry.publicPlayerId} className="grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-3 hover:bg-white/[0.03]"><span className="cz-num text-sm font-bold text-[var(--cz-gold)]">#{entry.rank}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{entry.displayName}</span><span className="block truncate text-[0.68rem] text-[var(--cz-text-tertiary)]">{entry.publicPlayerId}</span></span><span className="cz-num whitespace-nowrap text-xs text-[var(--cz-text-secondary)]">{entry.bestTime}</span></Link>)}</div> : <EmptyState icon={<Trophy size={22} />} title="No leaderboard entries" body="Verified solve times will appear here." />}</section>

    <section className="min-w-0"><SectionHeader title="Puzzle Journey" icon={<Sparkles size={16} />} action={<Link href="/puzzles" className="text-xs text-[var(--cz-aqua)]">Manage</Link>} />{puzzles.status === "loading" ? <LoadingState rows={3} /> : puzzles.status === "error" ? <ErrorState message="Puzzle journey could not be loaded." /> : puzzles.data.length ? <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">{puzzles.data.slice(0, 3).map((puzzle) => <PuzzleCard key={puzzle.id} puzzle={puzzle} />)}</div> : <EmptyState icon={<Plus size={22} />} title="No puzzles added" body="Add a CircZles puzzle to begin your solving journey." />}</section>
  </div>;
}

function CoreIdentityPanel({ identity, profileStatus }: { identity?: AuthenticatedPlayerIdentity; profileStatus: "idle" | "loading" | "ready" | "error" }) {
  return <section className="cz-surface cz-grain grid min-w-0 gap-5 p-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:p-7" data-testid="core-player-identity">
    <div className="relative h-24 w-24 overflow-hidden rounded-full border border-[var(--cz-hairline-strong)] bg-[var(--cz-surface-raised)] sm:h-28 sm:w-28"><Image src={identity?.avatar || DEFAULT_AVATAR} alt="" fill sizes="112px" className="object-cover" /></div>
    <div className="min-w-0"><p className="cz-display truncate text-2xl font-bold sm:text-3xl">{identity?.displayName ?? "Loading profile"}</p>{identity?.publicPlayerId && <p className="truncate text-sm text-[var(--cz-text-tertiary)]">{identity.publicPlayerId}{identity.country ? ` / ${identity.state ? `${identity.state}, ` : ""}${identity.country}` : ""}</p>}<div className="mt-4 grid max-w-md gap-2" aria-busy={profileStatus === "loading"}><div className="h-3 w-32 animate-pulse rounded bg-white/[0.07] motion-reduce:animate-none" /><div className="h-2 w-full animate-pulse rounded-full bg-white/[0.06] motion-reduce:animate-none" /></div>{profileStatus === "error" && <p className="mt-3 text-sm text-[var(--cz-danger)]">Gameplay profile is temporarily unavailable. Other Hub sections can still load.</p>}</div>
  </section>;
}

function HubMetricLoading() {
  return <section className="cz-surface grid min-w-0 grid-cols-2 gap-px overflow-hidden p-px lg:grid-cols-4" aria-busy="true" aria-label="Loading player metrics">{[0, 1, 2, 3].map((item) => <div key={item} className="grid h-20 gap-2 bg-[#0c111d] px-4 py-3"><span className="h-2.5 w-20 animate-pulse rounded bg-white/[0.06] motion-reduce:animate-none" /><span className="h-5 w-16 animate-pulse rounded bg-white/[0.07] motion-reduce:animate-none" /></div>)}</section>;
}

function StatusPanelLoading() {
  return <div className="cz-surface grid min-h-28 gap-3 p-4" aria-hidden="true"><span className="h-2.5 w-24 animate-pulse rounded bg-white/[0.06] motion-reduce:animate-none" /><span className="h-5 w-32 animate-pulse rounded bg-white/[0.07] motion-reduce:animate-none" /><span className="h-3 w-full animate-pulse rounded bg-white/[0.05] motion-reduce:animate-none" /></div>;
}

function ActionTile({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return <Link href={href} className="cz-raised flex min-w-0 items-center gap-3 px-4 py-3.5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[rgba(61,234,212,0.3)] bg-[var(--cz-aqua-dim)] text-[var(--cz-aqua)]">{icon}</span><span className="cz-display min-w-0 truncate text-sm font-semibold">{label}</span><ArrowRight size={15} className="ml-auto shrink-0 text-[var(--cz-text-tertiary)]" /></Link>;
}

function StatusPanel({ icon, label, title, body, tone = "aqua", href }: { icon: ReactNode; label: string; title: string; body: string; tone?: "aqua" | "gold" | "violet"; href: string }) {
  const color = tone === "gold" ? "var(--cz-gold)" : tone === "violet" ? "var(--cz-violet)" : "var(--cz-aqua)";
  return <Link href={href} className="cz-surface block min-w-0 p-4"><p className="flex items-center gap-2 text-[0.62rem] font-semibold uppercase tracking-[0.14em]" style={{ color }}>{icon}{label}</p><h3 className="cz-display mt-2 break-words text-lg font-bold">{title}</h3><p className="mt-1 text-sm text-[var(--cz-text-secondary)]">{body}</p></Link>;
}
