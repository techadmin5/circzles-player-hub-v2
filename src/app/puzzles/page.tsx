import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { AddPuzzlePanel } from "@/components/puzzles/AddPuzzlePanel";
import { PuzzleCard } from "@/components/puzzles/cards";
import { playerService, puzzleService } from "@/services";

export default async function Page() {
  const [player, puzzles] = await Promise.all([playerService.getMockCurrentPlayer(), puzzleService.getOwnedPuzzles()]);
  return (
    <GameShell player={player}>
      <PageHeader kicker="Collection" title="My Puzzles" subtitle={`${puzzles.length} puzzles in your Player Hub`} />
      <div className="grid gap-5">
        <AddPuzzlePanel />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{puzzles.map((p) => <PuzzleCard key={p.id} puzzle={p} />)}</div>
      </div>
    </GameShell>
  );
}
