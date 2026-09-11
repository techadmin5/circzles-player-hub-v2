"use client";

import { create } from "zustand";
import { backgroundMusicAsset, soundAssets, type SoundEvent } from "@/config/sounds";

const STORAGE_KEY = "circzles.audio.v1";
const pools = new Map<string, Set<HTMLAudioElement>>();
const lastPlayed = new Map<SoundEvent, number>();
let musicElement: HTMLAudioElement | undefined;
let preferencesHydrated = false;
let audioUnlocked = false;
let duckMultiplier = 1;
let duckTimer: number | undefined;

interface SoundPreferences { master: boolean; effects: boolean; music: boolean; notifications: boolean; reducedMotion: boolean; effectsVolume: number; musicVolume: number }
interface PlayOptions { playbackRate?: number; volume?: number }
interface MusicRuntime { audioUnlocked: boolean; musicPlaying: boolean; musicError?: string }
interface SoundState extends SoundPreferences, MusicRuntime { setSound: (patch: Partial<SoundPreferences>) => void; play: (name: SoundEvent, options?: PlayOptions) => void }

const defaults: SoundPreferences = { master: true, effects: true, music: true, notifications: true, reducedMotion: false, effectsVolume: .4, musicVolume: .1 };

export const useSound = create<SoundState>((set, get) => ({
  ...defaults,
  audioUnlocked: false,
  musicPlaying: false,
  setSound: (patch) => {
    set(patch);
    const next = { ...get(), ...patch };
    persistPreferences(next);
    syncMusic(next);
  },
  play: (name, options) => playEffect(name, get(), options),
}));

export function hydrateAudioPreferences() {
  if (typeof window === "undefined" || preferencesHydrated) return;
  preferencesHydrated = true;
  try { useSound.setState({ ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") }); }
  catch { useSound.setState(defaults); }
}

export function armBackgroundMusic() {
  if (typeof window === "undefined") return () => undefined;
  const unlock = () => {
    audioUnlocked = true;
    useSound.setState({ audioUnlocked: true });
    cleanup();
    syncMusic(useSound.getState());
  };
  const cleanup = () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  return cleanup;
}

/** Explicit development audition: bypasses only saved master/music gates and never persists them. */
export async function previewBackgroundMusic() {
  audioUnlocked = true;
  useSound.setState({ audioUnlocked: true, musicError: undefined });
  const audio = ensureMusic();
  syncMusicVolume();
  try { await audio.play(); updateMusicStatus(); }
  catch (error) { reportMusicError(error); }
}

export function pauseBackgroundMusic() { musicElement?.pause(); updateMusicStatus(); }
export function duckMusic(durationMs = 1800) {
  duckMultiplier = .38;
  syncMusicVolume();
  if (duckTimer) window.clearTimeout(duckTimer);
  duckTimer = window.setTimeout(() => { duckMultiplier = 1; syncMusicVolume(); }, durationMs);
}

function ensureMusic() {
  if (!musicElement) {
    musicElement = new Audio(backgroundMusicAsset);
    musicElement.loop = true;
    musicElement.preload = "auto";
    musicElement.addEventListener("play", updateMusicStatus);
    musicElement.addEventListener("pause", updateMusicStatus);
    musicElement.addEventListener("error", () => reportMusicError(new Error("MediaError")));
  }
  return musicElement;
}

function syncMusic(state: SoundPreferences) {
  if (typeof window === "undefined") return;
  const audio = ensureMusic();
  syncMusicVolume(state);
  if (!audioUnlocked || !state.master || !state.music) { audio.pause(); return; }
  void audio.play().then(updateMusicStatus).catch(reportMusicError);
}

function syncMusicVolume(state: SoundPreferences = useSound.getState()) { if (musicElement) musicElement.volume = clamp(state.musicVolume * duckMultiplier); }
function updateMusicStatus() { useSound.setState({ musicPlaying: Boolean(musicElement && !musicElement.paused), musicError: undefined }); }
function reportMusicError(error: unknown) { const name = error instanceof DOMException || error instanceof Error ? error.name : "PlaybackError"; useSound.setState({ musicPlaying: false, musicError: process.env.NODE_ENV === "development" ? name : undefined }); }

function playEffect(name: SoundEvent, state: SoundState, options?: PlayOptions) {
  if (typeof window === "undefined") return;
  const asset = soundAssets[name]; const now = performance.now();
  if (!state.master || !asset.path || (asset.category === "effect" && !state.effects) || (asset.category === "notification" && !state.notifications)) return;
  if (asset.cooldownMs && now - (lastPlayed.get(name) ?? -Infinity) < asset.cooldownMs) return;
  lastPlayed.set(name, now);
  try {
    const active = pools.get(asset.path) ?? new Set<HTMLAudioElement>(); pools.set(asset.path, active);
    if (active.size >= (asset.maxPolyphony ?? 4)) return;
    const audio = new Audio(asset.path); active.add(audio);
    audio.volume = clamp(state.effectsVolume * (asset.volume ?? 1) * (options?.volume ?? 1));
    audio.playbackRate = options?.playbackRate ?? asset.playbackRate ?? 1;
    audio.currentTime = (asset.startAtMs ?? 0) / 1000;
    let timer: number | undefined;
    const release = () => { if (timer) window.clearTimeout(timer); active.delete(audio); audio.removeEventListener("ended", release); audio.removeEventListener("error", release); };
    audio.addEventListener("ended", release); audio.addEventListener("error", release);
    if (asset.stopAfterMs) timer = window.setTimeout(() => { audio.pause(); release(); }, asset.stopAfterMs);
    void audio.play().catch(release);
  } catch { /* Optional audio never blocks interaction. */ }
}

function persistPreferences(state: SoundPreferences) { if (!preferencesHydrated) return; const { master, effects, music, notifications, reducedMotion, effectsVolume, musicVolume } = state; localStorage.setItem(STORAGE_KEY, JSON.stringify({ master, effects, music, notifications, reducedMotion, effectsVolume, musicVolume })); }
function clamp(value: number) { return Math.max(0, Math.min(1, value)); }
export function playSound(name: SoundEvent, options?: PlayOptions) { try { useSound.getState().play(name, options); } catch { /* Optional feedback only. */ } }
