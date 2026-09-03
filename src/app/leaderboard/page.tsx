import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { LeaderboardExplorer } from "@/components/leaderboard/LeaderboardExplorer";
import { leaderboardService, playerService } from "@/services";

export default async function Page() {
  const [player, lb] = await Promise.all([playerService.getMockCurrentPlayer(), leaderboardService.getLeaderboard()]);
  return (
    <GameShell player={player}>
      <PageHeader kicker="Competitive" title="Leaderboard" subtitle="Verified solve times across the CircZles community" />
      <LeaderboardExplorer entries={lb.entries} yourRank={lb.yourRank} />
    </GameShell>
  );
}
