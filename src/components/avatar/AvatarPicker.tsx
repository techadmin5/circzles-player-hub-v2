"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Upload, X } from "lucide-react";
import { AVATAR_ASSETS } from "@/config/assets";
import { playSound } from "@/hooks/useSound";
import { cn } from "@/lib/utils";

const GROUPS = ["CircZles Avatars", "Unlocked"] as const;

export function AvatarPicker({ open, currentAvatar, onPreview, onClose }: { open: boolean; currentAvatar: string; onPreview: (src: string) => void; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/72 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.section
            className="cz-surface cz-elevate max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-b-none p-5 sm:rounded-b-2xl"
            initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} transition={{ type: "spring", damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            data-testid="avatar-picker"
          >
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--cz-aqua)]">Customize</p>
                <h2 className="cz-display text-xl font-bold">Change Avatar</h2>
              </div>
              <button onClick={() => { playSound("modalClose"); onClose(); }} aria-label="Close avatar picker" data-testid="avatar-picker-close" className="grid h-9 w-9 place-items-center rounded-full text-[var(--cz-text-tertiary)] hover:bg-white/5 hover:text-[var(--cz-text-primary)]"><X size={18} /></button>
            </div>

            {GROUPS.map((group) => (
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
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button className="cz-btn cz-btn-ghost" onClick={() => { playSound("button"); onClose(); }}>Done</button>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
