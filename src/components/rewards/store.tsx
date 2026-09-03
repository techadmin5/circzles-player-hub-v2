"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { BadgeCheck, Check, Frame as FrameIcon, Gem, Package, Ticket, Wrench } from "lucide-react";
import type { StoreItem } from "@/types";
import { Chip } from "@/components/ui/kit";
import { RARITY_META } from "@/config/assets";
import { storeService } from "@/services";
import { playSound } from "@/hooks/useSound";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<StoreItem["type"], React.ReactNode> = {
  Frame: <FrameIcon size={18} />, Badge: <BadgeCheck size={18} />, Utility: <Wrench size={18} />, Coupon: <Ticket size={18} />,
};

const TABS = ["Featured", "Frames", "Badges", "Utilities", "Coupons"] as const;

function PurchaseButton({ item }: { item: StoreItem }) {
  const [state, setState] = useState<StoreItem["state"]>(item.state);
  const [busy, setBusy] = useState(false);
  const disabled = state === "OWNED" || state === "EQUIPPED" || state === "SOLD_OUT" || state === "COMING_SOON";
  const label = busy ? "Buying…" : state === "EQUIPPED" ? "Equipped" : state === "OWNED" ? "Owned" : state === "SOLD_OUT" ? "Sold Out" : state === "COMING_SOON" ? "Coming Soon" : "Buy";

  async function buy() {
    if (disabled) return;
    setBusy(true);
    playSound("purchase");
    await storeService.purchaseItem(item.id);
    setState("OWNED");
    setBusy(false);
    playSound("coin");
  }
  return (
    <button onClick={buy} disabled={disabled || busy} data-testid={`buy-${item.id}`}
      className={cn("cz-btn cz-btn-sm w-full", state === "BUY" ? "cz-btn-primary" : "cz-btn-ghost")}>
      {(state === "OWNED" || state === "EQUIPPED") && <Check size={14} />}{label}
    </button>
  );
}

export function StoreItemCard({ item, featured = false }: { item: StoreItem; featured?: boolean }) {
  const rarity = RARITY_META[item.rarity];
  return (
    <motion.article layout className={cn("cz-surface flex flex-col gap-3 overflow-hidden p-4", featured && "md:flex-row md:items-center md:gap-5")} data-testid={`store-item-${item.id}`}
      style={{ boxShadow: item.rarity === "legendary" ? "inset 0 0 0 1px rgba(232,180,80,0.28)" : undefined }}>
      <div className={cn("relative grid aspect-[16/9] place-items-center rounded-xl border bg-[var(--cz-inset)] sm:aspect-square", featured ? "md:h-32 md:w-32 md:shrink-0" : "")}
        style={{ borderColor: rarity.ring }}>
        <span style={{ color: rarity.color }}>{TYPE_ICON[item.type]}</span>
        <span className="absolute -bottom-2 left-1/2 -translate-x-1/2"><Chip tone={item.rarity === "legendary" ? "gold" : item.rarity === "epic" ? "violet" : item.rarity === "rare" ? "aqua" : "default"}>{rarity.label}</Chip></span>
      </div>
      <div className="flex flex-1 flex-col gap-2 pt-1">
        <div>
          <h3 className="cz-display text-base font-bold">{item.name}</h3>
          <p className="text-xs text-[var(--cz-text-secondary)]">{item.description}</p>
        </div>
        <div className="mt-auto flex items-center justify-between gap-3">
          <span className="cz-num inline-flex items-center gap-1.5 text-lg font-bold text-[var(--cz-gold)]"><Gem size={15} />{formatNumber(item.cost)}</span>
          <div className="w-28"><PurchaseButton item={item} /></div>
        </div>
      </div>
    </motion.article>
  );
}

export function StoreBoard({ items }: { items: StoreItem[] }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Featured");
  const map: Record<(typeof TABS)[number], StoreItem[]> = {
    Featured: items,
    Frames: items.filter((i) => i.type === "Frame"),
    Badges: items.filter((i) => i.type === "Badge"),
    Utilities: items.filter((i) => i.type === "Utility"),
    Coupons: items.filter((i) => i.type === "Coupon"),
  };
  const list = map[tab];
  const featured = tab === "Featured" ? list.find((i) => i.rarity === "legendary") ?? list[0] : undefined;
  const grid = tab === "Featured" && featured ? list.filter((i) => i.id !== featured.id) : list;

  return (
    <div className="grid gap-4">
      <div className="cz-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Store categories">
        {TABS.map((t) => (
          <button key={t} onClick={() => { playSound("tab"); setTab(t); }} data-testid={`store-tab-${t}`}
            className={cn("cz-btn cz-btn-sm shrink-0", tab === t ? "cz-btn-primary" : "cz-btn-ghost")}>{t}</button>
        ))}
      </div>
      {featured && <StoreItemCard item={featured} featured />}
      {grid.length === 0
        ? <p className="cz-surface flex items-center justify-center gap-2 p-8 text-sm text-[var(--cz-text-tertiary)]"><Package size={16} />No items in this category yet.</p>
        : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{grid.map((i) => <StoreItemCard key={i.id} item={i} />)}</div>}
    </div>
  );
}
