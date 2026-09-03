import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { InventoryLocker } from "@/components/inventory/InventoryLocker";
import { inventoryService, playerService } from "@/services";

export default async function Page() {
  const [player, items] = await Promise.all([playerService.getMockCurrentPlayer(), inventoryService.getInventory()]);
  return (
    <GameShell player={player}>
      <PageHeader kicker="Loadout" title="Inventory" subtitle="Your frames, badges, cards, coupons & special items" />
      <InventoryLocker items={items} />
    </GameShell>
  );
}
