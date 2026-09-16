import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { InventoryExplorer } from "@/components/inventory/InventoryExplorer";
import { playerService } from "@/services";
import { dataMode } from "@/config/dataMode";

export default async function Page() {
  const player = await playerService.getMockCurrentPlayer();
  return (
    <GameShell player={player}>
      <PageHeader kicker="Loadout" title="Inventory" subtitle="Your frames, badges, cards, coupons & special items" />
      <InventoryExplorer mode={dataMode} />
    </GameShell>
  );
}
