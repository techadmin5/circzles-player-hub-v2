import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { MissionBoard } from "@/components/missions/missions";
import { missionService, playerService } from "@/services";

export default async function Page() {
  const [player, missions] = await Promise.all([playerService.getMockCurrentPlayer(), missionService.getMissions()]);
  return (
    <GameShell player={player}>
      <PageHeader kicker="Objectives" title="Missions" subtitle="Daily, weekly, sprint, season, event & achievement goals" />
      <MissionBoard missions={missions} />
    </GameShell>
  );
}
