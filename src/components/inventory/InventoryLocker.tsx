"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import Image from "next/image";
import { BadgeCheck, Check, CircleUserRound, Frame as FrameIcon, Package, Sparkles, Ticket, Wrench, X } from "lucide-react";
import type { EquipmentSlot, InventoryItem } from "@/types";
import { Chip } from "@/components/ui/kit";
import { RARITY_META } from "@/config/assets";
import { inventoryService } from "@/services";
import { playSound } from "@/hooks/useSound";
import { cn } from "@/lib/utils";
import type { DataMode } from "@/config/dataMode";
import { useGameFeedback } from "@/components/feedback/GameFeedbackProvider";
import { apiClient, ApiClientError } from "@/lib/apiClient";
import { usePlayerUiState } from "@/stores/playerUiState";

const CATEGORY_ICON: Record<InventoryItem["category"], React.ReactNode> = {
  Frames: <FrameIcon size={20} />, Badges: <BadgeCheck size={20} />, Avatars: <CircleUserRound size={20} />, "Rename Cards": <Wrench size={20} />, Coupons: <Ticket size={20} />, Special: <Sparkles size={20} />,
};

const TABS: (InventoryItem["category"] | "All")[] = ["All", "Frames", "Badges", "Avatars", "Rename Cards", "Coupons", "Special"];

function InventoryCard({ item, mode, onItemsChange }: { item: InventoryItem; mode: DataMode; onItemsChange: (items: InventoryItem[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
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
          : mode === "api" && item.category === "Rename Cards"
            ? (item.quantity ?? 0) > 0
              ? <button type="button" className="cz-btn cz-btn-primary cz-btn-sm" data-sound="silent" onClick={() => setRenameOpen(true)}>Use Rename Card</button>
              : <span className="cz-chip justify-center">Used / No cards remaining</span>
            : <span className="cz-chip justify-center">{item.state}</span>}
      {renameOpen && <RenameCardDialog item={item} onClose={() => setRenameOpen(false)} onItemsChange={onItemsChange} />}
    </motion.article>
  );
}

function RenameCardDialog({ item, onClose, onItemsChange }: { item: InventoryItem; onClose: () => void; onItemsChange: (items: InventoryItem[]) => void }) {
  const [currentName, setCurrentName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loadingIdentity, setLoadingIdentity] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intentKey = useRef<string | null>(null);
  const { showErrorFeedback } = useGameFeedback();
  const characterCount = [...displayName].length;

  useEffect(() => {
    let cancelled = false;
    apiClient.getMe().then((me) => { if (!cancelled) { setCurrentName(me.displayName); usePlayerUiState.getState().setDisplayName(me.displayName); } })
      .catch(() => { if (!cancelled) setError("Current player identity could not be loaded."); })
      .finally(() => { if (!cancelled) setLoadingIdentity(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  async function confirmRename() {
    const normalized = displayName.trim(); const length = [...normalized].length;
    if (length < 2 || length > 32) { setError("Display name must be between 2 and 32 characters."); return; }
    if (/[\p{Cc}\p{Cf}]/u.test(displayName)) { setError("Display name must be a single line without control characters."); return; }
    if (normalized === currentName) { setError("Choose a display name different from your current name."); return; }
    const key = intentKey.current ?? crypto.randomUUID(); intentKey.current = key; setBusy(true); setError(null);
    try {
      const result = await inventoryService.renameDisplayName(item.id, normalized, key);
      intentKey.current = null; onItemsChange(result.items); usePlayerUiState.getState().setDisplayName(result.displayName); playSound("success"); onClose();
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.status > 0 && cause.status < 500) intentKey.current = null;
      const message = renameErrorMessage(cause); setError(message); showErrorFeedback(message);
    } finally { setBusy(false); }
  }

  return createPortal(
    <div className="fixed inset-0 z-[120] grid items-end bg-black/65 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="rename-card-title" className="w-full rounded-t-lg border border-[var(--cz-hairline)] bg-[#080b12] p-5 shadow-2xl sm:mx-auto sm:max-w-md sm:rounded-lg sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><h2 id="rename-card-title" className="cz-display text-lg font-bold">Use Rename Card</h2><p className="mt-1 text-sm text-[var(--cz-text-tertiary)]">Your Player ID will stay the same.</p></div>
          <button type="button" className="cz-icon-btn shrink-0 text-[var(--cz-text-primary)]" aria-label="Close display name dialog" data-sound="silent" disabled={busy} onClick={onClose}><X size={19} /></button>
        </div>
        <div className="mt-5 grid gap-4">
          <div><p className="text-xs uppercase tracking-wider text-[var(--cz-text-tertiary)]">Current display name</p><p className="mt-1 font-semibold">{loadingIdentity ? "Loading..." : currentName}</p></div>
          <label className="grid gap-1.5 text-sm font-medium">New display name
            <input autoFocus value={displayName} maxLength={64} disabled={busy || loadingIdentity} onChange={(event) => { setDisplayName(event.target.value); setError(null); }} className="cz-input" autoComplete="off" />
            <span className="flex justify-between gap-3 text-xs text-[var(--cz-text-tertiary)]"><span>{error ?? "2-32 characters"}</span><span className={characterCount > 32 ? "text-[var(--cz-danger)]" : ""}>{characterCount}/32</span></span>
          </label>
          <div className="grid grid-cols-2 gap-2"><button type="button" className="cz-btn cz-btn-ghost" data-sound="silent" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="cz-btn cz-btn-primary" data-sound="silent" disabled={busy || loadingIdentity} onClick={confirmRename}>{busy ? "Renaming..." : "Confirm Rename"}</button></div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function renameErrorMessage(cause: unknown) {
  if (!(cause instanceof ApiClientError)) return "Display name could not be changed.";
  if (cause.code === "DISPLAY_NAME_UNCHANGED") return "Choose a display name different from your current name.";
  if (cause.code === "RENAME_CARD_NOT_AVAILABLE") return "No Rename Card is available.";
  if (cause.code === "RENAME_CARD_REQUIRED") return "The selected item is not a Rename Card.";
  if (cause.code === "IDEMPOTENCY_CONFLICT") return "This rename request conflicts with an earlier attempt. Please try again.";
  if (cause.code === "VALIDATION_FAILED") return cause.message;
  return cause.status === 0 ? "Network error. Your Rename Card was not changed locally; retry to check the same request." : "Display name could not be changed.";
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
