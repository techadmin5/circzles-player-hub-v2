import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { LeaderboardExplorer } from "@/components/leaderboard/LeaderboardExplorer";
import { playerService } from "@/services";
import { dataMode } from "@/config/dataMode";

export default async function Page() {
  const player = dataMode === "mock" ? await playerService.getMockCurrentPlayer() : undefined;
  return (
    <GameShell player={player}>
      <PageHeader kicker="Competitive" title="Leaderboard" subtitle="Verified solve times across the CircZles community" />
      <LeaderboardExplorer mode={dataMode} />
    </GameShell>
  );
}
