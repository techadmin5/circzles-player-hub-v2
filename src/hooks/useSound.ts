"use client";

import { create } from "zustand";
import { soundAssets, type SoundEvent } from "@/config/sounds";

interface SoundState {
  master: boolean;
  effects: boolean;
  reducedMotion: boolean;
  notifications: boolean;
  setSound: (patch: Partial<Pick<SoundState, "master" | "effects" | "reducedMotion" | "notifications">>) => void;
  play: (name: SoundEvent) => void;
}

export const useSound = create<SoundState>((set, get) => ({
  master: true,
  effects: true,
  reducedMotion: false,
  notifications: true,
  setSound: (patch) => set(patch),
  play: (name) => {
    const { master, effects } = get();
    if (!master || !effects) return;
    if (typeof window === "undefined") return;
    try {
      const audio = new Audio(soundAssets[name]);
      audio.volume = 0.4;
      void audio.play().catch(() => undefined);
    } catch {
      /* Missing placeholder audio or autoplay policy must never block the UI. */
    }
  },
}));

/** Fire-and-forget helper for event handlers in components. */
export function playSound(name: SoundEvent) {
  try {
    useSound.getState().play(name);
  } catch {
    /* no-op */
  }
}
