import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { SubmissionStepper } from "@/components/submissions/SubmissionStepper";
import { playerService, puzzleService } from "@/services";

export default async function Page() {
  const [player, puzzles] = await Promise.all([playerService.getMockCurrentPlayer(), puzzleService.getOwnedPuzzles()]);
  return (
    <GameShell player={player}>
      <PageHeader kicker="Mobile-first flow" title="Submit Attempt" subtitle="A premium, verified submission process" />
      <SubmissionStepper puzzles={puzzles.map((p) => ({ id: p.id, playerPuzzleId: p.playerPuzzleId, name: p.name, levelId: p.levelId }))} />
    </GameShell>
  );
}
