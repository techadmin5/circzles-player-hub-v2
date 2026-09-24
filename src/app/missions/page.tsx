import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { MissionExplorer } from "@/components/missions/MissionExplorer";
import { dataMode } from "@/config/dataMode";
import { playerService } from "@/services";

export default async function Page() {
  const player = dataMode === "mock" ? await playerService.getMockCurrentPlayer() : undefined;
  return (
    <GameShell player={player}>
      <PageHeader kicker="Objectives" title="Missions" subtitle="Daily, weekly, sprint, season, event & achievement goals" />
      <MissionExplorer mode={dataMode} />
    </GameShell>
  );
}
