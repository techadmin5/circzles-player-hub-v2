import { GameShell } from "@/components/game-shell/GameShell";
import { PuzzleDetailExplorer } from "@/components/puzzles/PuzzleDetailExplorer";
import { PageHeader } from "@/components/ui/kit";
import { dataMode } from "@/config/dataMode";
import { playerService, puzzleService, submissionService } from "@/services";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = dataMode === "mock" ? await playerService.getMockCurrentPlayer() : undefined;
  const puzzle = dataMode === "mock" ? await puzzleService.getPuzzle(id) : undefined;
  const submissions = dataMode === "mock" ? await submissionService.getSubmissions() : [];
  return <GameShell player={player}>
    <PageHeader kicker={puzzle?.sku ? `SKU ${puzzle.sku}` : "Puzzle detail"} title={puzzle?.name ?? "Puzzle"} subtitle={puzzle ? `puzzleId ${puzzle.id}` : "Authenticated puzzle details"} />
    <PuzzleDetailExplorer id={id} initialPuzzle={puzzle} initialSubmissions={submissions} />
  </GameShell>;
}
