"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { BadgeCheck, Check, Frame as FrameIcon, Package, Sparkles, Ticket, Wrench } from "lucide-react";
import type { InventoryItem } from "@/types";
import { Chip } from "@/components/ui/kit";
import { RARITY_META } from "@/config/assets";
import { inventoryService } from "@/services";
import { playSound } from "@/hooks/useSound";
import { cn } from "@/lib/utils";

const CATEGORY_ICON: Record<InventoryItem["category"], React.ReactNode> = {
  Frames: <FrameIcon size={20} />, Badges: <BadgeCheck size={20} />, "Rename Cards": <Wrench size={20} />, Coupons: <Ticket size={20} />, Special: <Sparkles size={20} />,
};

const TABS: (InventoryItem["category"] | "All")[] = ["All", "Frames", "Badges", "Rename Cards", "Coupons", "Special"];

function InventoryCard({ item }: { item: InventoryItem }) {
  const [state, setState] = useState(item.state);
  const rarity = RARITY_META[item.rarity];
  const equippable = state === "Owned" && item.category === "Frames";

  async function equip() {
    await inventoryService.equipItem(item.id);
    setState("Equipped");
    playSound("success");
  }

  return (
    <motion.article layout className="cz-surface flex flex-col gap-3 p-4" data-testid={`inventory-item-${item.id}`}>
      <div className="grid aspect-[4/3] place-items-center rounded-xl border bg-[var(--cz-inset)]" style={{ borderColor: rarity.ring }}>
        <span style={{ color: rarity.color }}>{CATEGORY_ICON[item.category]}</span>
      </div>
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="cz-display text-sm font-bold">{item.name}</h3>
          <Chip tone={item.rarity === "legendary" ? "gold" : item.rarity === "epic" ? "violet" : item.rarity === "rare" ? "aqua" : "default"}>{rarity.label}</Chip>
        </div>
        <p className="text-xs text-[var(--cz-text-tertiary)]">{item.category}</p>
      </div>
      {state === "Equipped"
        ? <span className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[rgba(61,234,212,0.4)] bg-[var(--cz-aqua-dim)] py-1.5 text-xs font-semibold text-[var(--cz-aqua)]"><Check size={13} />Equipped</span>
        : equippable
          ? <button className="cz-btn cz-btn-ghost cz-btn-sm" data-sound="silent" onClick={equip} data-testid={`equip-${item.id}`}>Equip</button>
          : <span className="cz-chip justify-center">{state}</span>}
    </motion.article>
  );
}

export function InventoryLocker({ items }: { items: InventoryItem[] }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("All");
  const list = tab === "All" ? items : items.filter((i) => i.category === tab);
  return (
    <div className="grid gap-4">
      <div className="cz-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Inventory categories">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} data-sound="tab" onClick={() => setTab(t)} data-testid={`inventory-tab-${t}`}
            className={cn("cz-btn cz-btn-sm shrink-0", tab === t ? "cz-btn-primary" : "cz-btn-ghost")}>{t}</button>
        ))}
      </div>
      {list.length === 0
        ? <p className="cz-surface flex items-center justify-center gap-2 p-8 text-sm text-[var(--cz-text-tertiary)]"><Package size={16} />Nothing in this locker section yet.</p>
        : <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">{list.map((i) => <InventoryCard key={i.id} item={i} />)}</div>}
    </div>
  );
}
