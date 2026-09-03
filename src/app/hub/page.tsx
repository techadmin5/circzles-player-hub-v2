import Link from "next/link";
import { AuthenticatedIdentity } from "@/components/AuthenticatedIdentity";
import { PremiumLeaderboard } from "@/components/leaderboard/PremiumLeaderboard";
import { PremiumMissionCard } from "@/components/missions/PremiumMissionCard";
import { PremiumPuzzleCard } from "@/components/puzzles/PremiumPuzzleCard";
import { ActivityItem, AppShell, PageFrame, StatCard } from "@/components/ui";
import { dataMode } from "@/config/dataMode";
import { activityService, leaderboardService, missionService, playerService, puzzleService, seasonService } from "@/services";

export default async function Page() {
  const [player, puzzles, missions, activity, lb, season] = await Promise.all([
    playerService.getMockCurrentPlayer(),
    puzzleService.getOwnedPuzzles(),
    missionService.getMissions(),
    activityService.getActivity(),
    leaderboardService.getLeaderboard(),
    seasonService.getCurrentSeason(),
  ]);

  return <AppShell><PageFrame title="Player Hub" eyebrow="Welcome back"><div className="grid gap-5">
    <AuthenticatedIdentity fallbackPlayer={player} mode={dataMode} />
    <div className="grid gap-3 md:grid-cols-4">
      <StatCard label="Puzzles Completed" value={String(player.stats.completed)} />
      <StatCard label="Best Placement" value="#3" />
      <StatCard label="Season Placement" value={`#${season.playerRank}`} />
      <StatCard label="Podiums" value={String(player.stats.podiums)} />
    </div>
    <div className="grid gap-3 sm:grid-cols-4">
      <Link className="btn btn-primary" href="/puzzles">Add Puzzle</Link>
      <Link className="btn btn-ghost" href="/submissions/new">Submit Attempt</Link>
      <Link className="btn btn-ghost" href="/leaderboard">Leaderboard</Link>
      <Link className="btn btn-ghost" href="/missions">Claim Missions</Link>
    </div>
    <section className="grid gap-5 lg:grid-cols-2">
      <div className="grid gap-3">{missions.slice(0, 2).map((mission) => <PremiumMissionCard key={mission.missionId} mission={mission} />)}</div>
      <div className="grid gap-3">{puzzles.slice(0, 2).map((puzzle) => <PremiumPuzzleCard key={puzzle.id} puzzle={puzzle} />)}</div>
    </section>
    <PremiumLeaderboard entries={lb.entries.slice(0, 5)} />
    <div className="grid gap-3">{activity.map((event) => <ActivityItem key={event.id} event={event} />)}</div>
  </div></PageFrame></AppShell>;
}
