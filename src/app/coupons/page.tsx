import { AppShell, CouponCard, PageFrame } from "@/components/ui"; import { couponService } from "@/services";
export default async function Page(){const coupons=await couponService.getCoupons();return <AppShell><PageFrame title="Coupons"><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{coupons.map(c=><CouponCard key={c.id} coupon={c}/>)}</div></PageFrame></AppShell>}
