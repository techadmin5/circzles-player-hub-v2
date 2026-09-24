import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { CouponGrid } from "@/components/coupons/CouponGrid";
import { couponService, playerService } from "@/services";
import { dataMode } from "@/config/dataMode";
import { FeatureUnavailable } from "@/components/production/FeatureUnavailable";

export default async function Page() {
  if (dataMode === "api") return <GameShell><FeatureUnavailable title="Coupons" description="Coupon ownership exists in the backend but this production screen is not wired yet." /></GameShell>;
  const [player, coupons] = await Promise.all([playerService.getMockCurrentPlayer(), couponService.getCoupons()]);
  return (
    <GameShell player={player}>
      <PageHeader kicker="Perks" title="Coupons" subtitle="Discount codes earned across the CircZles ecosystem" />
      <CouponGrid coupons={coupons} />
    </GameShell>
  );
}
