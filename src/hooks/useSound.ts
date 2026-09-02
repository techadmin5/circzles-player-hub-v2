"use client";

import { create } from "zustand";

interface SoundState {
  master: boolean;
  effects: boolean;
  reducedMotion: boolean;
  setSound: (patch: Partial<Omit<SoundState, "setSound" | "play">>) => void;
  play: (name: string) => void;
}

export const useSound = create<SoundState>((set, get) => ({
  master: true,
  effects: true,
  reducedMotion: false,
  setSound: (patch) => set(patch),
  play: () => {
    const { master, effects } = get();
    if (!master || !effects) return;
  },
}));

export const sound = {
  playButton: () => useSound.getState().play("button"),
  playCoin: () => useSound.getState().play("coin"),
  playXp: () => useSound.getState().play("xp"),
  playMission: () => useSound.getState().play("mission"),
  playWheelTick: () => useSound.getState().play("wheelTick"),
  playReward: () => useSound.getState().play("reward"),
  playPurchase: () => useSound.getState().play("purchase"),
  playBadge: () => useSound.getState().play("badge"),
  playLevelUp: () => useSound.getState().play("levelUp"),
};
