import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { SubmissionComposer } from "@/components/submissions/SubmissionComposer";
import { playerService, puzzleService } from "@/services";
import { dataMode } from "@/config/dataMode";

export default async function Page() {
  const player = dataMode === "mock" ? await playerService.getMockCurrentPlayer() : undefined;
  const puzzles = dataMode === "mock" ? await puzzleService.getOwnedPuzzles() : [];
  return (
    <GameShell player={player}>
      <PageHeader kicker="Mobile-first flow" title="Submit Attempt" subtitle="A premium, verified submission process" />
      <SubmissionComposer initial={puzzles} />
    </GameShell>
  );
}
