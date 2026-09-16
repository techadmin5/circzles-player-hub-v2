import { Award, Flame, Gauge, Medal, Sparkles, Trophy } from "lucide-react";
import { GameShell } from "@/components/game-shell/GameShell";
import { SectionHeader, Stat } from "@/components/ui/kit";
import { PlayerIdentityPanel } from "@/components/player/PlayerIdentityPanel";
import { BadgeShowcase } from "@/components/achievements/BadgeShowcase";
import { PuzzleStateBadge } from "@/components/puzzles/cards";
import { ActivityTimeline } from "@/components/activity/ActivityTimeline";
import { activityService, playerService, puzzleService } from "@/services";
import { dataMode } from "@/config/dataMode";

export default async function Page() {
  const [player, puzzles, activity] = await Promise.all([playerService.getMockCurrentPlayer(), puzzleService.getOwnedPuzzles(), activityService.getActivity()]);
  return (
    <GameShell player={player}>
      <div className="grid grid-cols-1 gap-6">
        <PlayerIdentityPanel fallbackPlayer={player} mode={dataMode} placement={null} profileMode />

        <section>
          <SectionHeader title="Competitive Performance" icon={<Trophy size={16} />} />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Completed" value={String(player.stats.completed)} icon={<Sparkles size={12} />} tone="aqua" />
            <Stat label="Approved Attempts" value={String(player.stats.approvedAttempts)} icon={<Gauge size={12} />} />
            <Stat label="Personal Bests" value={String(player.stats.personalBests)} icon={<Medal size={12} />} />
            <Stat label="Podiums" value={String(player.stats.podiums)} icon={<Trophy size={12} />} tone="gold" />
            <Stat label="Season Placement" value={`#${player.stats.seasonRank}`} icon={<Trophy size={12} />} tone="gold" />
            <Stat label="Longest Streak" value={`${player.stats.longestStreak}d`} icon={<Flame size={12} />} />
            <Stat label="Owned Puzzles" value={String(player.stats.ownedPuzzles)} icon={<Sparkles size={12} />} />
            <Stat label="Progression Level" value={String(player.progressionLevel)} icon={<Award size={12} />} tone="aqua" />
          </div>
        </section>

        <section>
          <SectionHeader title="Achievement Showcase" icon={<Award size={16} />} />
          <BadgeShowcase badges={player.badgeShowcase} />
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <div>
            <SectionHeader title="Puzzle History" />
            <ul className="cz-surface divide-y divide-[var(--cz-hairline)]">
              {puzzles.slice(0, 6).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="cz-display truncate text-sm font-semibold">{p.name}</p>
                    <p className="text-xs text-[var(--cz-text-tertiary)]">puzzleId {p.id} · difficulty levelId {p.levelId}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="cz-num text-sm text-[var(--cz-text-secondary)]">{p.personalBest ?? "—"}</span>
                    <PuzzleStateBadge status={p.status} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <SectionHeader title="Recent Results" />
            <ActivityTimeline events={activity} />
          </div>
        </section>
      </div>
    </GameShell>
  );
}
