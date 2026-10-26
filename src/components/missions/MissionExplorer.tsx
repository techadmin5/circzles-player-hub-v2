"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { LoadingState } from "@/components/ui/kit";
import type { DataMode } from "@/config/dataMode";
import { playSound } from "@/hooks/useSound";
import { ApiClientError } from "@/lib/apiClient";
import { missionService } from "@/services";
import type { Mission, MissionClaimResult } from "@/types";
import { MissionBoard, missionKey } from "./missions";
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
    missionService.getMissionPeriods(controller.signal).then(setMissions).catch((error: unknown) => {
      if (!isAbortError(error)) setLoadError(loadErrorMessage(error));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [attempt]);

  const claimMission = useCallback(async (mission: Mission) => {
    const { missionId, periodKey } = mission;
    const claimKey = missionKey(mission);
    if (pendingClaims.current.has(claimKey)) return;
    pendingClaims.current.add(claimKey);
    setBusyMissionIds((current) => new Set(current).add(claimKey));
    setClaimErrors((current) => omitKey(current, claimKey));
    const idempotencyKey = claimKeys.current.get(claimKey) ?? crypto.randomUUID();
    claimKeys.current.set(claimKey, idempotencyKey);
    playSound("button");
    const beforeClaim = usePlayerUiState.getState().player;

    try {
      const result = await missionService.claimMission(missionId, idempotencyKey, periodKey);
      const previousPlayerState = beforeClaim
        ?? (mode === "mock" ? snapshotFromProfile(currentPlayer) : snapshotFromClaim(result));
      const newPlayerState = mode === "api" ? usePlayerUiState.getState().player ?? snapshotFromClaim(result) : usePlayerUiState.getState().applyClaim(result, previousPlayerState);
      setClaimResults((current) => ({ ...current, [claimKey]: result }));
      setMissions((current) => current.map((mission) => missionKey(mission) === claimKey ? { ...mission, status: "CLAIMED", claimable: false } : mission));
      claimKeys.current.delete(claimKey);
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
          setMissions(await missionService.getMissionPeriods());
        } catch {
          setClaimErrors((current) => ({ ...current, [claimKey]: "Reward claimed. Mission status could not be refreshed." }));
        }
      }
    } catch (error) {
      setClaimErrors((current) => ({ ...current, [claimKey]: claimErrorMessage(error) }));
      showErrorFeedback(claimErrorMessage(error));
    } finally {
      pendingClaims.current.delete(claimKey);
      setBusyMissionIds((current) => {
        const next = new Set(current);
        next.delete(claimKey);
        return next;
      });
    }
  }, [celebrateReward, mode, showErrorFeedback]);

  return (
    <div data-data-mode={mode}>
      <button type="button" className="cz-btn cz-btn-ghost cz-btn-sm mb-4" disabled={loading || busyMissionIds.size > 0} onClick={() => setAttempt(value => value + 1)}><RefreshCw size={14} aria-hidden="true" /> Refresh missions</button>
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
    MISSION_CAPACITY_PENDING: "Your on-time claim is recorded for administrator recovery. No XP/SP was awarded. Contact support; retrying will not authorize recovery.",
    MISSION_CLAIM_EXPIRED: "The original claim deadline has passed.",
    MISSION_CLAIMS_MAINTENANCE: "Mission claims are temporarily paused. Earned rewards are retained; original deadlines still apply.",
    MISSION_NOT_CLAIMABLE: "This mission is not ready to claim.",
    MISSION_ALREADY_CLAIMED: "This mission reward has already been claimed.",
    MISSION_NOT_AVAILABLE: "This mission is no longer available.",
    IDEMPOTENCY_CONFLICT: "This claim could not be retried safely. Refresh and try again.",
    MISSION_REWARD_CONFIG_INVALID: "This mission reward is temporarily unavailable.",
  };
  return messages[error.code] ?? "The reward could not be claimed. Please try again.";
}
