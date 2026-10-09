"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AlertCircle, Award, CircleUserRound, Puzzle, RefreshCw, Shield, X } from "lucide-react";
import { ApiClientError } from "@/lib/apiClient";
import { DEFAULT_AVATAR } from "@/config/assets";
import { playerService } from "@/services";
import type { PublicPlayerProfile } from "@/types";
import { usePlayerUiState } from "@/stores/playerUiState";

export function PublicPlayerProfileModal({
  publicPlayerId,
  cache,
  onClose,
}: {
  publicPlayerId: string;
  cache: Map<string, PublicPlayerProfile>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [savedProfile, setProfile] = useState<PublicPlayerProfile | null>(() => cache.get(publicPlayerId) ?? null);
  const live = usePlayerUiState((state) => state.player);
  const profile = savedProfile && live?.publicPlayerId === publicPlayerId ? { ...savedProfile, displayName: live.displayName, avatarUrl: live.avatar, progressionRank: live.rank } : savedProfile;
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])")].filter((element) => !element.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    const cached = cache.get(publicPlayerId);
    if (cached) return;
    const controller = new AbortController();
    playerService.getPublicProfile(publicPlayerId, controller.signal).then((result) => {
      cache.set(publicPlayerId, result);
      setProfile(result);
    }).catch((requestError: unknown) => {
      if (!isAbortError(requestError)) setError(profileErrorMessage(requestError));
    });
    return () => controller.abort();
  }, [attempt, cache, publicPlayerId]);

  const retry = () => {
    setError(null);
    setAttempt((value) => value + 1);
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="public-profile-title"
        className="cz-surface cz-grain relative max-h-[calc(100dvh-2rem)] w-[min(92vw,24rem)] overflow-y-auto rounded-lg border-[var(--cz-hairline)] p-4 shadow-2xl sm:p-5">
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close player profile"
          className="absolute right-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-lg border border-white/20 bg-black/50 text-white opacity-100 shadow-sm hover:border-white/35 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cz-aqua)]" title="Close">
          <X size={20} strokeWidth={2.25} className="block shrink-0 text-white opacity-100" aria-hidden="true" />
        </button>

        {!profile && !error && <ProfileLoading publicPlayerId={publicPlayerId} />}
        {error && (
          <div className="grid min-h-52 place-items-center gap-3 px-3 py-6 text-center" role="alert">
            <AlertCircle size={28} className="text-[var(--cz-danger)]" />
            <div>
              <h2 id="public-profile-title" className="cz-display font-bold">Profile unavailable</h2>
              <p className="mt-1 text-sm text-[var(--cz-text-secondary)]">{error}</p>
            </div>
            <button type="button" className="cz-btn cz-btn-ghost cz-btn-sm" onClick={retry}><RefreshCw size={14} /> Retry</button>
          </div>
        )}
        {profile && <ProfileContent profile={profile} />}
      </div>
    </div>
  );
}

function ProfileLoading({ publicPlayerId }: { publicPlayerId: string }) {
  return (
    <div className="grid min-h-52 animate-pulse content-center justify-items-center gap-4" aria-busy="true" aria-label="Loading player profile">
      <div className="h-16 w-16 rounded-full bg-white/10" />
      <div className="h-5 w-36 rounded bg-white/10" />
      <p className="text-xs text-[var(--cz-text-tertiary)]">{publicPlayerId}</p>
    </div>
  );
}

function ProfileContent({ profile }: { profile: PublicPlayerProfile }) {
  return (
    <div className="grid gap-4 sm:gap-5">
      <div className="flex items-center gap-3 pr-10 sm:gap-4">
        <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full border border-[rgba(61,234,212,0.45)] bg-[var(--cz-aqua-dim)] text-lg font-bold text-[var(--cz-aqua)] sm:h-16 sm:w-16">
          <Image unoptimized={Boolean(profile.avatarUrl)} src={profile.avatarUrl || DEFAULT_AVATAR} alt="" width={64} height={64} className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--cz-aqua)]">Player profile</p>
          <h2 id="public-profile-title" className="cz-display truncate text-xl font-bold">{profile.displayName}</h2>
          <p className="cz-num mt-1 text-xs text-[var(--cz-text-secondary)]">{profile.publicPlayerId}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div className="cz-raised min-w-0 p-3">
          <p className="flex items-center gap-1.5 text-[0.65rem] uppercase tracking-wide text-[var(--cz-text-tertiary)]"><Shield size={13} /> Progression rank</p>
          <p className="mt-2 truncate font-semibold">{profile.progressionRank}</p>
        </div>
        <div className="cz-raised min-w-0 p-3">
          <p className="flex items-center gap-1.5 text-[0.65rem] uppercase tracking-wide text-[var(--cz-text-tertiary)]"><Puzzle size={13} /> Approved CircZles</p>
          <p className="cz-num mt-2 text-xl font-bold text-[var(--cz-gold)]">{profile.approvedPuzzlesSolved}</p>
        </div>
      </div>

      {profile.equippedFrame && <p className="flex items-center gap-2 text-sm text-[var(--cz-text-secondary)]"><CircleUserRound size={16} /> {profile.equippedFrame}</p>}
      <div className="border-t border-[var(--cz-hairline)] pt-3 sm:pt-4">
        {profile.displayedBadges.length > 0 ? (
          <div className="flex flex-wrap gap-2">{profile.displayedBadges.map((badge) => <span key={badge} className="cz-chip"><Award size={12} /> {badge}</span>)}</div>
        ) : <p className="text-xs text-[var(--cz-text-tertiary)]">No displayed badges yet</p>}
      </div>
    </div>
  );
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function profileErrorMessage(error: unknown) {
  if (!(error instanceof ApiClientError)) return "We couldn't load this player profile.";
  if (error.status === 401) return "Your session has expired. Sign in again to view player profiles.";
  if (error.status === 404) return "This player profile is no longer available.";
  return "We couldn't load this player profile.";
}
