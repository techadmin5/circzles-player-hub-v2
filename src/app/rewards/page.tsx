import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { StoreExplorer } from "@/components/rewards/StoreExplorer";
import { RewardWheel } from "@/components/rewards/RewardWheel";
import { playerService } from "@/services";
import { dataMode } from "@/config/dataMode";

export default async function Page() {
  const player = dataMode === "mock" ? await playerService.getMockCurrentPlayer() : undefined;
  return (
    <GameShell player={player}>
      <PageHeader kicker="Economy" title="Rewards Store" subtitle="Spend Synapse Points on collectible cosmetics & utilities" />
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <StoreExplorer mode={dataMode} />
        <div className="lg:sticky lg:top-24 lg:self-start"><RewardWheel /></div>
      </div>
    </GameShell>
  );
}
