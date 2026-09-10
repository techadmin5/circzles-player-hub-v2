import { notFound } from "next/navigation";
import { GameShell } from "@/components/game-shell/GameShell";
import { playerService } from "@/services";
import { GameFeelLab } from "./GameFeelLab";

export default async function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  const player = await playerService.getMockCurrentPlayer();
  return <GameShell player={player}><GameFeelLab player={player} /></GameShell>;
}
