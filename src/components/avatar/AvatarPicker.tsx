"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Upload, X } from "lucide-react";
import { AVATAR_ASSETS } from "@/config/assets";
import { playSound } from "@/hooks/useSound";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { usePlayerUiState } from "@/stores/playerUiState";
import { DEFAULT_AVATAR } from "@/config/assets";
import type { InventoryResponse } from "@/types";

const GROUPS = ["CircZles Avatars", "Unlocked"] as const;

export function AvatarPicker({ open, currentAvatar, onPreview, onClose, mode = "mock" }: { open: boolean; currentAvatar: string; onPreview: (src: string) => void; onClose: () => void; mode?: "api" | "mock" }) {
  const player = usePlayerUiState((state) => state.player);
  const [items, setItems] = useState<InventoryResponse["items"]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open || mode !== "api") return;
    const controller = new AbortController();
    const start = window.setTimeout(() => {
      setLoading(true); setItems([]); setError("");
      apiClient.getInventory(controller.signal).then((inventory) => setItems(inventory.items.filter((item) => item.rewardType === "AVATAR" && item.quantity > 0)))
        .catch(() => { if (!controller.signal.aborted) setError("Owned avatars could not be loaded."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 0);
    return () => { window.clearTimeout(start); controller.abort(); };
  }, [open, mode, player?.internalId]);
  async function save(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); playSound("success"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Avatar could not be saved."); }
    finally { setBusy(false); }
  }
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/72 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.section
            className="cz-surface cz-elevate max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-b-none p-5 sm:rounded-b-2xl"
            initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} transition={{ type: "spring", damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            data-testid="avatar-picker"
            role="dialog" aria-modal="true" aria-label="Change Avatar"
          >
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--cz-aqua)]">Customize</p>
                <h2 className="cz-display text-xl font-bold">Change Avatar</h2>
              </div>
              <button onClick={() => { playSound("modalClose"); onClose(); }} aria-label="Close avatar picker" data-testid="avatar-picker-close" className="grid h-9 w-9 place-items-center rounded-full text-[var(--cz-text-tertiary)] hover:bg-white/5 hover:text-[var(--cz-text-primary)]"><X size={18} /></button>
            </div>

            {mode === "api" ? <div className="grid gap-5">
              <section className="cz-inset grid gap-3 p-4"><h3 className="cz-display font-semibold">Your Photo</h3>
                <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload profile photo" className="sr-only" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void save(() => apiClient.uploadAvatar(file)); }} />
                <button className="cz-btn cz-btn-ghost" disabled={busy} data-testid="avatar-upload" onClick={() => fileInput.current?.click()}><Upload size={16} />{player?.customAvatarAvailable ? "Replace Photo" : "Upload Photo"}</button>
                {player?.customAvatarAvailable && <button className="cz-btn cz-btn-ghost" disabled={busy} onClick={() => save(() => apiClient.selectAvatar("CUSTOM_UPLOAD"))}>Use Your Photo</button>}
                <p className="text-xs text-[var(--cz-text-tertiary)]">JPEG, PNG or WebP up to 2 MiB. Your selected photo appears on your public Player Hub profile.</p>
              </section>
              <section><h3 className="cz-display mb-3 font-semibold">Default</h3><button className="cz-btn cz-btn-ghost" disabled={busy} onClick={() => save(() => apiClient.selectAvatar("DEFAULT"))}><Image src={DEFAULT_AVATAR} alt="" width={32} height={32} />Use Default Avatar</button></section>
              <section><h3 className="cz-display mb-3 font-semibold">Owned Avatars</h3>{loading ? <p>Loading owned avatars…</p> : <div className="grid grid-cols-3 gap-3">{items.map((item) => <button key={item.inventoryItemId} disabled={busy} className={cn("cz-raised grid gap-2 p-3 text-xs", player?.avatarSource === "INVENTORY_AVATAR" && currentAvatar === item.imageUrl && "cz-ring-aqua")} onClick={() => save(() => apiClient.equipInventoryItem(item.inventoryItemId, "AVATAR"))}><Image unoptimized src={item.imageUrl || DEFAULT_AVATAR} alt="" width={64} height={64} className="mx-auto rounded-full" />{item.name}</button>)}</div>}{!loading && !items.length && <p className="text-sm text-[var(--cz-text-secondary)]">Owned CircZles avatars will appear here.</p>}</section>
              {busy && <p role="status">Saving avatar…</p>}{error && <p role="alert" className="text-sm text-[var(--cz-danger)]">{error}</p>}
            </div> : <>{GROUPS.map((group) => (
              <div key={group} className="mb-5">
                <h3 className="cz-display mb-3 text-sm font-semibold">{group}</h3>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                  {AVATAR_ASSETS.filter((a) => a.group === group).map((avatar) => {
                    const selected = currentAvatar === avatar.src;
                    return (
                      <button key={avatar.id} onClick={() => { playSound("button"); onPreview(avatar.src); }} data-testid={`avatar-option-${avatar.id}`}
                        className={cn("cz-raised relative grid gap-2 p-2 text-center text-xs transition-colors", selected ? "border-[rgba(61,234,212,0.5)] cz-ring-aqua" : "hover:border-[var(--cz-hairline-strong)]")}>
                        {selected && <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-[var(--cz-aqua)] text-[var(--cz-void)]"><Check size={12} /></span>}
                        <span className="relative mx-auto block h-16 w-16 overflow-hidden rounded-full"><Image src={avatar.src} alt={avatar.label} fill sizes="64px" className="object-cover" /></span>
                        <span className="text-[var(--cz-text-secondary)]">{avatar.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="cz-inset grid gap-3 p-4">
              <h3 className="cz-display text-sm font-semibold">My Photo</h3>
              <button className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--cz-hairline-strong)] bg-black/20 px-4 text-sm text-[var(--cz-text-secondary)] hover:text-[var(--cz-text-primary)]" data-testid="avatar-upload">
                <Upload size={16} />Upload Photo
              </button>
              <p className="text-xs text-[var(--cz-text-tertiary)]">Preview only for now. Personal photo uploads connect to backend media storage in a later phase.</p>
            </div></>}

            <div className="mt-5 flex justify-end gap-2">
              <button className="cz-btn cz-btn-ghost" onClick={() => { playSound("button"); onClose(); }}>Done</button>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
