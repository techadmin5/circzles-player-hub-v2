import { notFound } from "next/navigation";
import { UiLabClient } from "./UiLabClient";
import { leaderboardService, playerService, puzzleService } from "@/services";

export default async function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  const [player, puzzles, leaderboard] = await Promise.all([
    playerService.getMockCurrentPlayer(),
    puzzleService.getOwnedPuzzles(),
    leaderboardService.getMockLeaderboard(),
  ]);

  return <UiLabClient player={player} puzzles={puzzles} leaderboard={leaderboard.entries} />;
}
