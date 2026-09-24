import { GameShell } from "@/components/game-shell/GameShell";
import { PublicProfileView } from "@/components/player/PublicProfileView";
import { dataMode } from "@/config/dataMode";
import { playerService } from "@/services";

export default async function Page({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const player = dataMode === "mock" ? await playerService.getMockCurrentPlayer() : undefined;
  const initialProfile = dataMode === "mock" ? await playerService.getPublicProfile(playerId) : undefined;
  return <GameShell player={player}><PublicProfileView publicPlayerId={playerId} mode={dataMode} initialProfile={initialProfile} /></GameShell>;
}
