import { GameShell } from "@/components/game-shell/GameShell";
import { PlayerProfileView } from "@/components/player/PlayerProfileView";
import { dataMode } from "@/config/dataMode";
import { playerService, puzzleService } from "@/services";

export default async function Page() {
  const player = dataMode === "mock" ? await playerService.getMockCurrentPlayer() : undefined;
  const puzzles = dataMode === "mock" ? await puzzleService.getOwnedPuzzles() : [];
  return <GameShell player={player}><PlayerProfileView mode={dataMode} initialPlayer={player} initialPuzzles={puzzles} /></GameShell>;
}
