import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { StoreBoard } from "@/components/rewards/store";
import { RewardWheel } from "@/components/rewards/RewardWheel";
import { playerService, storeService } from "@/services";

export default async function Page() {
  const [player, items] = await Promise.all([playerService.getMockCurrentPlayer(), storeService.getItems()]);
  return (
    <GameShell player={player}>
      <PageHeader kicker="Economy" title="Rewards Store" subtitle="Spend Synapse Points on collectible cosmetics & utilities" />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <StoreBoard items={items} />
        <div className="lg:sticky lg:top-24 lg:self-start"><RewardWheel /></div>
      </div>
    </GameShell>
  );
}
