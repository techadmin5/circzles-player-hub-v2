import { GameShell } from "@/components/game-shell/GameShell";
import { ProductionHub } from "@/components/hub/ProductionHub";
import { dataMode } from "@/config/dataMode";
import { playerService } from "@/services";

export default async function Page() {
  const mockPlayer = dataMode === "mock" ? await playerService.getMockCurrentPlayer() : undefined;
  return <GameShell player={mockPlayer}><ProductionHub fallbackPlayer={mockPlayer} mode={dataMode} /></GameShell>;
}
