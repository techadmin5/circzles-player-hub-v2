"use client";

import Image from "next/image";
import { Award, Puzzle, Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { DEFAULT_AVATAR } from "@/config/assets";
import type { DataMode } from "@/config/dataMode";
import { apiClient } from "@/lib/apiClient";
import type { PublicPlayerProfile } from "@/types";
import { EmptyState, LoadingState, Stat } from "@/components/ui/kit";

export function PublicProfileView({ publicPlayerId, mode = "api", initialProfile }: { publicPlayerId: string; mode?: DataMode; initialProfile?: PublicPlayerProfile }) {
  const [profile, setProfile] = useState<PublicPlayerProfile | undefined>(initialProfile);
  const [error, setError] = useState("");
  useEffect(() => {
    if (mode !== "api") return;
    const controller = new AbortController();
    apiClient.getPublicPlayerProfile(publicPlayerId, controller.signal).then(setProfile).catch((cause) => {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setError("This public profile could not be loaded.");
    });
    return () => controller.abort();
  }, [mode, publicPlayerId]);
  if (error) return <EmptyState title="Profile unavailable" body={error} />;
  if (!profile) return <LoadingState rows={4} />;
  return <div className="grid min-w-0 gap-5">
    <section className="cz-surface flex min-w-0 flex-col items-center gap-4 p-5 text-center min-[430px]:flex-row min-[430px]:text-left sm:p-7">
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full border border-[var(--cz-hairline-strong)] bg-[var(--cz-surface-raised)]"><Image src={profile.avatarUrl || DEFAULT_AVATAR} alt="" fill sizes="96px" className="object-cover" /></div>
      <div className="min-w-0"><h1 className="cz-display truncate text-2xl font-bold">{profile.displayName}</h1><p className="cz-num truncate text-xs text-[var(--cz-text-tertiary)]">{profile.publicPlayerId}</p><p className="mt-2 inline-flex items-center gap-2 text-sm text-[var(--cz-aqua)]"><Shield size={15} />{profile.progressionRank}</p></div>
    </section>
    <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2"><Stat label="Progression Rank" value={profile.progressionRank} icon={<Shield size={12} />} tone="aqua" /><Stat label="Approved Puzzles" value={String(profile.approvedPuzzlesSolved)} icon={<Puzzle size={12} />} tone="gold" /></div>
    <section className="cz-surface p-5"><h2 className="cz-display flex items-center gap-2 font-bold"><Award size={16} className="text-[var(--cz-aqua)]" />Displayed badges</h2>{profile.displayedBadges.length ? <div className="mt-3 flex flex-wrap gap-2">{profile.displayedBadges.map((badge) => <span key={badge} className="cz-chip">{badge}</span>)}</div> : <p className="mt-3 text-sm text-[var(--cz-text-tertiary)]">No displayed badges yet.</p>}</section>
  </div>;
}
