import Link from "next/link";
import { ArrowRight, Camera, Gift, Plus, Sparkles, Target, TicketCheck, Trophy } from "lucide-react";
import type { ReactNode } from "react";
import { GameShell } from "@/components/game-shell/GameShell";
import { SectionHeader } from "@/components/ui/kit";
import { PlayerIdentityPanel } from "@/components/player/PlayerIdentityPanel";
import { PuzzleCard } from "@/components/puzzles/cards";
import { LeaderboardRow } from "@/components/leaderboard/board";
import { ActivityTimeline } from "@/components/activity/ActivityTimeline";
import { dataMode } from "@/config/dataMode";
import { activityService, leaderboardService, missionService, playerService, puzzleService, seasonService } from "@/services";
import { formatNumber } from "@/lib/format";

function ActionTile({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <Link href={href} data-testid={`hub-action-${label.replace(/\s+/g, "-").toLowerCase()}`} className="cz-raised flex items-center gap-3 px-4 py-3.5 transition-colors hover:border-[rgba(61,234,212,0.4)]">
      <span className="grid h-10 w-10 place-items-center rounded-xl border border-[rgba(61,234,212,0.3)] bg-[var(--cz-aqua-dim)] text-[var(--cz-aqua)]">{icon}</span>
      <span className="cz-display text-sm font-semibold">{label}</span>
      <ArrowRight size={15} className="ml-auto text-[var(--cz-text-tertiary)]" />
    </Link>
  );
}

function StatusPanel({ icon, label, title, body, tone = "aqua", href }: { icon: ReactNode; label: string; title: string; body: string; tone?: "aqua" | "gold" | "violet"; href?: string }) {
  const color = tone === "gold" ? "var(--cz-gold)" : tone === "violet" ? "var(--cz-violet)" : "var(--cz-aqua)";
  const inner = (
    <div className="cz-surface h-full p-4">
      <p className="flex items-center gap-2 text-[0.62rem] font-semibold uppercase tracking-[0.14em]" style={{ color }}>{icon}{label}</p>
      <h3 className="cz-display mt-2 text-lg font-bold">{title}</h3>
      <p className="mt-1 text-sm text-[var(--cz-text-secondary)]">{body}</p>
    </div>
  );
  return href ? <Link href={href} className="block transition-transform hover:-translate-y-0.5">{inner}</Link> : inner;
}

export default async function Page() {
  const [player, puzzles, missions, activity, lb, season] = await Promise.all([
    playerService.getMockCurrentPlayer(),
    puzzleService.getOwnedPuzzles(),
    missionService.getMissions(),
    activityService.getActivity(),
    leaderboardService.getMockLeaderboard(),
    seasonService.getCurrentSeason(),
  ]);
  const activeMission = missions.find((m) => m.status === "ACTIVE") ?? missions[0];
  const pendingSub = puzzles.find((p) => p.status === "SUBMISSION_PENDING");
  const pct = Math.min(100, Math.round((activeMission.progress.current / Math.max(1, activeMission.progress.target)) * 100));

  return (
    <GameShell player={player}>
      <div className="grid grid-cols-1 gap-6">
        <PlayerIdentityPanel fallbackPlayer={player} mode={dataMode} placement={null} />

        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="cz-surface grid gap-5 p-5">
            <div className="grid gap-2 sm:grid-cols-2">
              <ActionTile href="/puzzles" icon={<Plus size={17} />} label="Add Puzzle" />
              <ActionTile href="/submissions/new" icon={<Camera size={17} />} label="Submit Attempt" />
              <ActionTile href="/leaderboard" icon={<Trophy size={17} />} label="Leaderboard" />
              <ActionTile href="/missions" icon={<Gift size={17} />} label="Claim Missions" />
            </div>
            <div className="cz-inset grid gap-4 p-4 md:grid-cols-[1fr_200px]">
              <div>
                <p className="flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-[var(--cz-aqua)]"><Sparkles size={12} />Active Challenge</p>
                <h2 className="cz-display mt-1 text-xl font-bold">{activeMission.title}</h2>
                <p className="mt-1 text-sm text-[var(--cz-text-secondary)]">{activeMission.description}</p>
                <div className="cz-track mt-3"><div className="cz-track-fill" style={{ width: `${pct}%` }} /></div>
              </div>
              <div className="grid place-items-center gap-1 rounded-xl border border-[rgba(232,180,80,0.28)] bg-[var(--cz-gold-dim)] p-4 text-center">
                <Gift className="h-7 w-7 text-[var(--cz-gold)]" />
                <p className="cz-display text-lg font-bold text-[var(--cz-gold)]">{activeMission.rewards.map((r) => r.label).join(" · ")}</p>
                <p className="text-[0.62rem] text-[var(--cz-text-tertiary)]">On verified completion</p>
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <StatusPanel icon={<Target size={13} />} label="Submission Status" title={pendingSub?.name ?? "No pending solves"} body={pendingSub ? "Pending Review" : "Submit an attempt to appear here."} href="/submissions" />
            <StatusPanel icon={<Trophy size={13} />} label="Competitive Result" tone="gold" title="New Personal Best" body="You moved onto a recent leaderboard placement." href="/leaderboard" />
            <StatusPanel icon={<TicketCheck size={13} />} label="Reward Wheel" tone="violet" title="Daily spin available" body="Spin the premium reward wheel for Synapse Points and more." href="/rewards" />
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <div>
            <SectionHeader title="Leaderboard Snapshot" icon={<Trophy size={16} />} action={<Link href="/leaderboard" className="text-xs text-[var(--cz-aqua)]">Full board</Link>} />
            <div className="cz-surface grid gap-0.5 p-2">{lb.entries.slice(0, 5).map((e) => <LeaderboardRow key={`${e.rank}-${e.player.publicPlayerId}`} entry={e} />)}</div>
          </div>
          <div>
            <SectionHeader title="Recent Activity" icon={<Sparkles size={16} />} action={<Link href="/activity" className="text-xs text-[var(--cz-aqua)]">View all</Link>} />
            <ActivityTimeline events={activity} />
          </div>
        </section>

        <section>
          <SectionHeader title="Puzzle Journey" icon={<Sparkles size={16} />} action={<Link href="/puzzles" className="text-xs text-[var(--cz-aqua)]">Manage</Link>} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{puzzles.slice(0, 3).map((p) => <PuzzleCard key={p.id} puzzle={p} />)}</div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="cz-surface flex items-center justify-between gap-4 p-5">
            <div>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-[var(--cz-gold)]">Current Season</p>
              <h3 className="cz-display mt-1 text-xl font-bold">{season.name}</h3>
              <p className="text-sm text-[var(--cz-text-secondary)]">Season placement #{season.playerRank}</p>
              <Link href="/seasons" className="cz-btn cz-btn-ghost cz-btn-sm mt-3">View Season</Link>
            </div>
            <p className="cz-display cz-num text-4xl font-bold text-[var(--cz-gold)]">#{season.playerRank}</p>
          </div>
          <div className="cz-surface p-5">
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-[var(--cz-aqua)]">Reward Progress</p>
            <h3 className="cz-display mt-1 text-xl font-bold">Season reward track</h3>
            <div className="cz-track mt-3"><div className="cz-track-fill-gold cz-track-fill" style={{ width: "42%" }} /></div>
            <p className="mt-1.5 text-xs text-[var(--cz-text-tertiary)]"><span className="cz-num">{formatNumber(player.synapsePoints)}</span> Synapse Points earned</p>
            <Link href="/rewards" className="cz-btn cz-btn-primary cz-btn-sm mt-3">Open Rewards Store</Link>
          </div>
        </section>
      </div>
    </GameShell>
  );
}
