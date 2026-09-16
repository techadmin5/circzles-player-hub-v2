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
  player?: PlayerUiSnapshot;
  displayedSynapsePoints?: number;
  balancePulse: boolean;
  hydrate: (player: PlayerProfile) => void;
  applyClaim: (claim: MissionClaimResult, previous: PlayerUiSnapshot) => PlayerUiSnapshot;
  setDisplayedSynapsePoints: (value: number) => void;
  setSynapsePoints: (value: number) => void;
  setBalancePulse: (value: boolean) => void;
}

export const usePlayerUiState = create<PlayerUiStore>((set) => ({
  balancePulse: false,
  hydrate: (profile) => set({ player: snapshotFromProfile(profile), displayedSynapsePoints: profile.synapsePoints }),
  applyClaim: (claim, previous) => {
    const player: PlayerUiSnapshot = {
      synapsePoints: claim.playerState.synapsePoints,
      xp: claim.playerState.xp,
      xpNeeded: previous.xpNeeded,
      progressionLevel: claim.playerState.progressionLevel,
      rankName: claim.playerState.rankName,
    };
    set({ player, displayedSynapsePoints: previous.synapsePoints });
    return player;
  },
  setDisplayedSynapsePoints: (displayedSynapsePoints) => set({ displayedSynapsePoints }),
  setSynapsePoints: (synapsePoints) => set((state) => ({ player: state.player ? { ...state.player, synapsePoints } : state.player, displayedSynapsePoints: synapsePoints, balancePulse: true })),
  setBalancePulse: (balancePulse) => set({ balancePulse }),
}));

export function snapshotFromProfile(profile: PlayerProfile): PlayerUiSnapshot {
  return { synapsePoints: profile.synapsePoints, xp: profile.xp, xpNeeded: profile.xpNeeded, progressionLevel: profile.progressionLevel, rankName: profile.rank };
}

export function currentPlayerSnapshot(fallback: PlayerProfile): PlayerUiSnapshot {
  return usePlayerUiState.getState().player ?? snapshotFromProfile(fallback);
}
