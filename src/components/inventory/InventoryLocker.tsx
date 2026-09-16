"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import { BadgeCheck, Check, CircleUserRound, Frame as FrameIcon, Package, Sparkles, Ticket, Wrench } from "lucide-react";
import type { EquipmentSlot, InventoryItem } from "@/types";
import { Chip } from "@/components/ui/kit";
import { RARITY_META } from "@/config/assets";
import { inventoryService } from "@/services";
import { playSound } from "@/hooks/useSound";
import { cn } from "@/lib/utils";
import type { DataMode } from "@/config/dataMode";
import { useGameFeedback } from "@/components/feedback/GameFeedbackProvider";

const CATEGORY_ICON: Record<InventoryItem["category"], React.ReactNode> = {
  Frames: <FrameIcon size={20} />, Badges: <BadgeCheck size={20} />, Avatars: <CircleUserRound size={20} />, "Rename Cards": <Wrench size={20} />, Coupons: <Ticket size={20} />, Special: <Sparkles size={20} />,
};

const TABS: (InventoryItem["category"] | "All")[] = ["All", "Frames", "Badges", "Avatars", "Rename Cards", "Coupons", "Special"];

function InventoryCard({ item, mode, onItemsChange }: { item: InventoryItem; mode: DataMode; onItemsChange: (items: InventoryItem[]) => void }) {
  const [busy, setBusy] = useState(false);
  const { showErrorFeedback } = useGameFeedback();
  const rarity = RARITY_META[item.rarity];
  const equippedSlots = item.equippedSlots?.length
    ? item.equippedSlots
    : item.state === "Equipped"
      ? [item.category === "Avatars" ? "AVATAR" : "FRAME" as EquipmentSlot]
      : [];
  const equipped = equippedSlots.length > 0;
  const equippable = !equipped && item.state === "Owned" && (item.category === "Frames" || item.category === "Avatars");

  async function equip(slot: EquipmentSlot) {
    setBusy(true);
    try { const items = await inventoryService.equipItem(item.id, slot); onItemsChange(items); playSound("success"); }
    catch { showErrorFeedback("Item could not be equipped."); }
    finally { setBusy(false); }
  }
  async function unequip(slot: EquipmentSlot) {
    setBusy(true);
    try { const items = await inventoryService.unequip(slot); onItemsChange(items); playSound("success"); }
    catch { showErrorFeedback("Item could not be unequipped."); }
    finally { setBusy(false); }
  }

  return (
    <motion.article layout className="cz-surface flex flex-col gap-3 p-4" data-testid={`inventory-item-${item.id}`}>
      <div className="grid aspect-[4/3] place-items-center rounded-xl border bg-[var(--cz-inset)]" style={{ borderColor: rarity.ring }}>
        {item.imageUrl ? <Image unoptimized src={item.imageUrl} alt="" width={180} height={140} className="h-full w-full object-contain p-3" /> : <span style={{ color: rarity.color }}>{CATEGORY_ICON[item.category]}</span>}
      </div>
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="cz-display text-sm font-bold">{item.name}</h3>
          <Chip tone={item.rarity === "legendary" ? "gold" : item.rarity === "epic" ? "violet" : item.rarity === "rare" ? "aqua" : "default"}>{rarity.label}</Chip>
        </div>
        <p className="text-xs text-[var(--cz-text-tertiary)]">{item.category}{(item.quantity ?? 1) > 1 ? ` x${item.quantity}` : ""}</p>
      </div>
      {equipped
        ? <div className="grid gap-1.5">{equippedSlots.map((slot) => <button key={slot} disabled={busy} data-sound="silent" className="cz-btn cz-btn-ghost cz-btn-sm" onClick={() => unequip(slot)}><Check size={13} />{slot.startsWith("BADGE_") ? `Displayed ${slot.at(-1)}` : "Equipped"}</button>)}</div>
        : equippable
          ? <button className="cz-btn cz-btn-ghost cz-btn-sm" disabled={busy} data-sound="silent" onClick={() => equip(item.category === "Avatars" ? "AVATAR" : "FRAME")} data-testid={`equip-${item.id}`}>Equip</button>
          : item.category === "Badges" ? <div className="grid grid-cols-3 gap-1">{(["BADGE_1", "BADGE_2", "BADGE_3"] as EquipmentSlot[]).map((slot) => <button key={slot} disabled={busy} data-sound="silent" className="cz-btn cz-btn-ghost cz-btn-sm px-1" onClick={() => equip(slot)}>Slot {slot.at(-1)}</button>)}</div>
          : <span className="cz-chip justify-center">{mode === "api" && item.category === "Rename Cards" ? "Use coming next" : item.state}</span>}
    </motion.article>
  );
}

export function InventoryLocker({ items, mode = "mock", onItemsChange = () => {} }: { items: InventoryItem[]; mode?: DataMode; onItemsChange?: (items: InventoryItem[]) => void }) {
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
        : <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">{list.map((i) => <InventoryCard key={i.id} item={i} mode={mode} onItemsChange={onItemsChange} />)}</div>}
    </div>
  );
}
