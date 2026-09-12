"use client";

import { useState } from "react";
import { Ticket } from "lucide-react";
import type { Coupon } from "@/types";
import { Chip, EmptyState } from "@/components/ui/kit";
import { playSound } from "@/hooks/useSound";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const TABS = ["ACTIVE", "USED", "EXPIRED"] as const;

function CouponCard({ coupon }: { coupon: Coupon }) {
  const [copied, setCopied] = useState(false);
  const active = coupon.status === "ACTIVE";
  return (
    <div className={cn("cz-surface relative overflow-hidden p-5", !active && "opacity-70")} data-testid={`coupon-${coupon.id}`}>
      <span className="pointer-events-none absolute -left-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-[var(--cz-void)]" />
      <span className="pointer-events-none absolute -right-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-[var(--cz-void)]" />
      <div className="flex items-center justify-between">
        <p className="cz-display cz-num text-3xl font-bold text-[var(--cz-gold)]">{coupon.discount}</p>
        <Chip tone={active ? "emerald" : "default"}>{coupon.status}</Chip>
      </div>
      <p className="cz-display mt-2 text-lg font-bold tracking-wide">{coupon.code}</p>
      <p className="text-xs text-[var(--cz-text-tertiary)]">{coupon.source} · Expires {formatDate(coupon.expiry)}</p>
      {active && (
        <button className="cz-btn cz-btn-ghost cz-btn-sm mt-4 w-full" data-testid={`copy-${coupon.id}`}
          onClick={() => { playSound("button"); navigator.clipboard?.writeText(coupon.code).catch(() => undefined); setCopied(true); }}>
          {copied ? "Copied" : "Copy Code"}
        </button>
      )}
    </div>
  );
}

export function CouponGrid({ coupons }: { coupons: Coupon[] }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("ACTIVE");
  const list = coupons.filter((c) => c.status === tab);
  return (
    <div className="grid gap-4">
      <div className="flex gap-1.5">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} data-sound="tab" onClick={() => setTab(t)} data-testid={`coupon-tab-${t}`}
            className={cn("cz-btn cz-btn-sm capitalize", tab === t ? "cz-btn-primary" : "cz-btn-ghost")}>{t.toLowerCase()}</button>
        ))}
      </div>
      {list.length === 0
        ? <EmptyState icon={<Ticket size={22} />} title={`No ${tab.toLowerCase()} coupons`} body="Coupons earned from missions, seasons and the reward wheel appear here." />
        : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.map((c) => <CouponCard key={c.id} coupon={c} />)}</div>}
    </div>
  );
}
