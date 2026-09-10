"use client";

import { create } from "zustand";
import { backgroundMusicAsset, soundAssets, type SoundEvent } from "@/config/sounds";

const STORAGE_KEY = "circzles.audio.v1";
const audioCache = new Map<string, HTMLAudioElement>();
let music: HTMLAudioElement | undefined;
let preferencesHydrated = false;

type SoundPreferences = Pick<SoundState, "master" | "effects" | "music" | "notifications" | "reducedMotion" | "effectsVolume" | "musicVolume">;

interface SoundState {
  master: boolean;
  effects: boolean;
  music: boolean;
  notifications: boolean;
  reducedMotion: boolean;
  effectsVolume: number;
  musicVolume: number;
  setSound: (patch: Partial<SoundPreferences>) => void;
  play: (name: SoundEvent) => void;
}

const defaults: SoundPreferences = { master: true, effects: true, music: false, notifications: true, reducedMotion: false, effectsVolume: 0.4, musicVolume: 0.25 };

export const useSound = create<SoundState>((set, get) => ({
  ...defaults,
  setSound: (patch) => {
    set(patch);
    persistPreferences({ ...get(), ...patch });
    syncMusic({ ...get(), ...patch });
  },
  play: (name) => {
    if (typeof window === "undefined") return;
    const state = get();
    const asset = soundAssets[name];
    if (!state.master || !asset.path) return;
    if (asset.category === "effect" && !state.effects) return;
    if (asset.category === "notification" && !state.notifications) return;
    try {
      const audio = audioCache.get(asset.path) ?? new Audio(asset.path);
      audioCache.set(asset.path, audio);
      audio.pause();
      audio.currentTime = 0;
      audio.volume = state.effectsVolume;
      void audio.play().catch(() => undefined);
    } catch {
      // Optional audio and autoplay policy never block interaction.
    }
  },
}));

export function hydrateAudioPreferences() {
  if (typeof window === "undefined" || preferencesHydrated) return;
  preferencesHydrated = true;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<SoundPreferences>;
    useSound.setState({ ...defaults, ...saved });
  } catch {
    useSound.setState(defaults);
  }
}

export function armBackgroundMusic() {
  if (typeof window === "undefined") return () => undefined;
  const start = () => syncMusic(useSound.getState());
  window.addEventListener("pointerdown", start, { once: true });
  window.addEventListener("keydown", start, { once: true });
  return () => {
    window.removeEventListener("pointerdown", start);
    window.removeEventListener("keydown", start);
  };
}

function syncMusic(state: SoundPreferences) {
  if (!backgroundMusicAsset || typeof window === "undefined") return;
  music ??= new Audio(backgroundMusicAsset);
  music.loop = true;
  music.volume = state.musicVolume;
  if (state.master && state.music) void music.play().catch(() => undefined);
  else music.pause();
}

function persistPreferences(state: SoundPreferences) {
  if (typeof window === "undefined" || !preferencesHydrated) return;
  const { master, effects, music: musicEnabled, notifications, reducedMotion, effectsVolume, musicVolume } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ master, effects, music: musicEnabled, notifications, reducedMotion, effectsVolume, musicVolume }));
}

export function playSound(name: SoundEvent) {
  try { useSound.getState().play(name); } catch { /* optional feedback only */ }
}
