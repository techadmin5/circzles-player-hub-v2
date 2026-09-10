"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { LoadingState } from "@/components/ui/kit";
import type { DataMode } from "@/config/dataMode";
import { playSound } from "@/hooks/useSound";
import { ApiClientError } from "@/lib/apiClient";
import { missionService } from "@/services";
import type { Mission, MissionClaimResult } from "@/types";
import { MissionBoard } from "./missions";
import { useGameFeedback } from "@/components/feedback/GameFeedbackProvider";
import { snapshotFromProfile, usePlayerUiState, type PlayerUiSnapshot } from "@/stores/playerUiState";
import { currentPlayer } from "@/mocks/data";

export function MissionExplorer({ mode }: { mode: DataMode }) {
  const { celebrateReward, showErrorFeedback } = useGameFeedback();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busyMissionIds, setBusyMissionIds] = useState<ReadonlySet<string>>(() => new Set());
  const [claimErrors, setClaimErrors] = useState<Record<string, string>>({});
  const [claimResults, setClaimResults] = useState<Record<string, MissionClaimResult>>({});
  const pendingClaims = useRef(new Set<string>());
  const claimKeys = useRef(new Map<string, string>());

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    missionService.getMissions(controller.signal).then(setMissions).catch((error: unknown) => {
      if (!isAbortError(error)) setLoadError(loadErrorMessage(error));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [attempt]);

  const claimMission = useCallback(async (missionId: string) => {
    if (pendingClaims.current.has(missionId)) return;
    pendingClaims.current.add(missionId);
    setBusyMissionIds((current) => new Set(current).add(missionId));
    setClaimErrors((current) => omitKey(current, missionId));
    const idempotencyKey = claimKeys.current.get(missionId) ?? crypto.randomUUID();
    claimKeys.current.set(missionId, idempotencyKey);
    playSound("button");

    try {
      const result = await missionService.claimMission(missionId, idempotencyKey);
      const previousPlayerState = usePlayerUiState.getState().player
        ?? (mode === "mock" ? snapshotFromProfile(currentPlayer) : snapshotFromClaim(result));
      const newPlayerState = usePlayerUiState.getState().applyClaim(result, previousPlayerState);
      setClaimResults((current) => ({ ...current, [missionId]: result }));
      setMissions((current) => current.map((mission) => mission.missionId === missionId ? { ...mission, status: "CLAIMED", claimable: false } : mission));
      claimKeys.current.delete(missionId);
      celebrateReward({
        source: "MISSION",
        synapsePoints: result.awarded.synapsePoints,
        xp: result.awarded.xp,
        previousPlayerState,
        newPlayerState,
        label: "Mission Complete",
      });

      if (mode === "api") {
        try {
          setMissions(await missionService.getMissions());
        } catch {
          setClaimErrors((current) => ({ ...current, [missionId]: "Reward claimed. Mission status could not be refreshed." }));
        }
      }
    } catch (error) {
      setClaimErrors((current) => ({ ...current, [missionId]: claimErrorMessage(error) }));
      showErrorFeedback("Mission reward could not be claimed.");
    } finally {
      pendingClaims.current.delete(missionId);
      setBusyMissionIds((current) => {
        const next = new Set(current);
        next.delete(missionId);
        return next;
      });
    }
  }, [celebrateReward, mode, showErrorFeedback]);

  return (
    <div data-data-mode={mode}>
      {loading
        ? <LoadingState rows={4} />
        : loadError
          ? <RequestError message={loadError} onRetry={() => setAttempt((value) => value + 1)} />
          : <MissionBoard missions={missions} busyMissionIds={busyMissionIds} claimErrors={claimErrors} claimResults={claimResults} onClaim={claimMission} />}
    </div>
  );
}

function snapshotFromClaim(result: MissionClaimResult): PlayerUiSnapshot {
  return {
    synapsePoints: result.playerState.synapsePoints,
    xp: result.playerState.xp,
    xpNeeded: undefined,
    progressionLevel: result.playerState.progressionLevel,
    rankName: result.playerState.rankName,
  };
}

function RequestError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="cz-surface grid justify-items-center gap-3 border-[rgba(242,85,90,0.4)] p-5 text-center" role="alert">
      <AlertCircle className="text-[var(--cz-danger)]" size={22} aria-hidden="true" />
      <p className="text-sm text-[var(--cz-text-secondary)]">{message}</p>
      <button type="button" className="cz-btn cz-btn-ghost cz-btn-sm" onClick={onRetry}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
    </div>
  );
}

function omitKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function loadErrorMessage(error: unknown) {
  if (error instanceof ApiClientError && error.status === 401) return "Your session has expired. Sign in again to view missions.";
  return "We couldn't load missions. Please try again.";
}

function claimErrorMessage(error: unknown) {
  if (!(error instanceof ApiClientError)) return "The reward could not be claimed. Please try again.";
  const messages: Record<string, string> = {
    MISSION_NOT_CLAIMABLE: "This mission is not ready to claim.",
    MISSION_ALREADY_CLAIMED: "This mission reward has already been claimed.",
    MISSION_NOT_AVAILABLE: "This mission is no longer available.",
    IDEMPOTENCY_CONFLICT: "This claim could not be retried safely. Refresh and try again.",
    MISSION_REWARD_CONFIG_INVALID: "This mission reward is temporarily unavailable.",
  };
  return messages[error.code] ?? "The reward could not be claimed. Please try again.";
}
