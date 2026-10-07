"use client";

import { create } from "zustand";
import type { MissionClaimResult, PlayerProfile } from "@/types";

export interface PlayerUiSnapshot {
  synapsePoints: number;
  xp: number;
  xpNeeded?: number;
  progressionLevel: number;
  rankName: string;
}

interface PlayerUiStore {
  player?: PlayerProfile & { rankName: string };
  sessionVersion: number;
  syncError?: string;
  setSyncError: (message?: string) => void;
  displayName?: string;
  displayedSynapsePoints?: number;
  balancePulse: boolean;
  hydrate: (player: PlayerProfile) => void;
  clear: () => void;
  applyClaim: (claim: MissionClaimResult, previous: PlayerUiSnapshot) => PlayerUiSnapshot;
  setDisplayedSynapsePoints: (value: number) => void;
  setSynapsePoints: (value: number) => void;
  setBalancePulse: (value: boolean) => void;
  setDisplayName: (value: string) => void;
}

export const usePlayerUiState = create<PlayerUiStore>((set) => ({
  balancePulse: false,
  sessionVersion: 0,
  setSyncError: (syncError) => set({ syncError }),
  hydrate: (profile) => set({ player: { ...profile, rankName: profile.rank }, displayName: profile.displayName, displayedSynapsePoints: profile.synapsePoints, syncError: undefined }),
  clear: () => set((state) => ({ sessionVersion: state.sessionVersion + 1, player: undefined, displayName: undefined, displayedSynapsePoints: undefined, balancePulse: false, syncError: undefined })),
  applyClaim: (claim, previous) => {
    const player: PlayerUiSnapshot = {
      synapsePoints: claim.playerState.synapsePoints,
      xp: claim.playerState.xp,
      xpNeeded: previous.xpNeeded,
      progressionLevel: claim.playerState.progressionLevel,
      rankName: claim.playerState.rankName,
    };
    // Demo feedback only. Production mutations rehydrate the full profile via /api/me.
    set((state) => ({ player: state.player ? { ...state.player, ...player, rank: player.rankName as PlayerProfile["rank"] } : undefined, displayedSynapsePoints: player.synapsePoints }));
    return player;
  },
  setDisplayedSynapsePoints: (displayedSynapsePoints) => set({ displayedSynapsePoints }),
  setSynapsePoints: (synapsePoints) => set((state) => ({ player: state.player ? { ...state.player, synapsePoints } : state.player, displayedSynapsePoints: synapsePoints, balancePulse: true })),
  setBalancePulse: (balancePulse) => set({ balancePulse }),
  setDisplayName: (displayName) => set((state) => ({ displayName, player: state.player ? { ...state.player, displayName } : undefined })),
}));

export function snapshotFromProfile(profile: PlayerProfile): PlayerUiSnapshot {
  return { synapsePoints: profile.synapsePoints, xp: profile.xp, xpNeeded: profile.xpNeeded, progressionLevel: profile.progressionLevel, rankName: profile.rank };
}

export function currentPlayerSnapshot(fallback: PlayerProfile): PlayerUiSnapshot {
  return usePlayerUiState.getState().player ?? snapshotFromProfile(fallback);
}
