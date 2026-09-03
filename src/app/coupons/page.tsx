import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { CouponGrid } from "@/components/coupons/CouponGrid";
import { couponService, playerService } from "@/services";

export default async function Page() {
  const [player, coupons] = await Promise.all([playerService.getMockCurrentPlayer(), couponService.getCoupons()]);
  return (
    <GameShell player={player}>
      <PageHeader kicker="Perks" title="Coupons" subtitle="Discount codes earned across the CircZles ecosystem" />
      <CouponGrid coupons={coupons} />
    </GameShell>
  );
}
