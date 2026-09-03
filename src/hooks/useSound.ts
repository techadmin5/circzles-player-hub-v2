"use client";

import { create } from "zustand";
import { soundAssets, type SoundEvent } from "@/config/sounds";

interface SoundState {
  master: boolean;
  effects: boolean;
  reducedMotion: boolean;
  setSound: (patch: Partial<Omit<SoundState, "setSound" | "play">>) => void;
  play: (name: SoundEvent) => void;
}

export const useSound = create<SoundState>((set, get) => ({
  master: true,
  effects: true,
  reducedMotion: false,
  setSound: (patch) => set(patch),
  play: (name) => {
    const { master, effects } = get();
    if (!master || !effects) return;
    if (typeof window === "undefined") return;
    try {
      const audio = new Audio(soundAssets[name]);
      audio.volume = 0.45;
      void audio.play().catch(() => undefined);
    } catch {
      // Missing placeholder files or browser autoplay policy should never block UI.
    }
  },
}));

export const sound = {
  playButton: () => useSound.getState().play("button"),
  playCoin: () => useSound.getState().play("coin"),
  playXp: () => useSound.getState().play("xp"),
  playMission: () => useSound.getState().play("missionClaim"),
  playWheelTick: () => useSound.getState().play("wheelTick"),
  playReward: () => useSound.getState().play("rewardReveal"),
  playPurchase: () => useSound.getState().play("purchase"),
  playBadge: () => useSound.getState().play("badgeUnlock"),
  playLevelUp: () => useSound.getState().play("rankUp"),
};
