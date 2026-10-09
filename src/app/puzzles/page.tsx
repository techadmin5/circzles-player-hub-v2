import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { PuzzleCollectionExplorer } from "@/components/puzzles/PuzzleCollectionExplorer";
import { playerService, puzzleService } from "@/services";
import { dataMode } from "@/config/dataMode";

export default async function Page() {
  const player = dataMode === "mock" ? await playerService.getMockCurrentPlayer() : undefined;
  const puzzles = dataMode === "mock" ? await puzzleService.getOwnedPuzzles() : [];
  return (
    <GameShell player={player}>
      <PageHeader kicker="Collection" title="My CircZles" subtitle={dataMode === "mock" ? `${puzzles.length} CircZles in your Player Hub` : "Your authenticated CircZles collection"} />
      <PuzzleCollectionExplorer initial={puzzles} />
    </GameShell>
  );
}
