"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { useState } from "react";
import { Badge, Shield, Sparkles } from "lucide-react";
import type { PlayerProfile } from "@/types";
import { getProgressionRank } from "@/config/progression";
import { ProgressionModal } from "@/components/progression/ProgressionModal";
import { ProgressionRankEmblem } from "@/components/progression/ProgressionRankEmblem";

export function PlayerLobbyHeader({ player, showDebug = false }: { player: PlayerProfile; showDebug?: boolean }) {
  const [open, setOpen] = useState(false);
  const pct = Math.min(100, Math.round((player.xp / Math.max(1, player.xpNeeded)) * 100));
  const currentRank = getProgressionRank(player.progressionLevel);
  return <section className="game-card glow-border overflow-hidden">
    <div className="grid gap-5 p-5 md:grid-cols-[auto_1fr_auto] md:items-center">
      <div className="relative">
        <Image src={player.avatar} alt="" width={96} height={96} className="rounded-lg border border-white/15 bg-black/30" />
        <div className="absolute -bottom-2 -right-2"><ProgressionRankEmblem rank={currentRank} state="current" size="sm" /></div>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-[.18em] text-[var(--cyan)]">V2 Player Identity</p>
        <h2 className="font-display text-4xl font-bold md:text-5xl">{player.displayName}</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">{player.publicPlayerId} | {player.rank} | Progression Level {player.progressionLevel}</p>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-[var(--cyan)] via-[var(--aqua)] to-[var(--gold)]" style={{ width: `${pct}%` }} /></div>
        <p className="mt-2 text-xs text-[var(--text-muted)]">{player.xp.toLocaleString()} XP toward {player.xpNeeded.toLocaleString()} XP</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-1">
        <Metric icon={<Sparkles className="h-4 w-4" />} label="Synapse" value={player.synapsePoints.toLocaleString()} />
        <Metric icon={<Shield className="h-4 w-4" />} label="Streak" value={`${player.streak}d`} />
        <button className="btn btn-primary" onClick={() => setOpen(true)}><Badge className="h-4 w-4" />Ranks</button>
      </div>
    </div>
    {showDebug && <div className="border-t border-white/10 bg-black/20 px-5 py-3 text-xs text-[var(--text-muted)]">Dev identity: displayName {player.displayName} | publicPlayerId {player.publicPlayerId} | internalId {player.internalId}</div>}
    <ProgressionModal open={open} onClose={() => setOpen(false)} progressionLevel={player.progressionLevel} />
  </section>;
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="rounded-lg border border-white/10 bg-white/[.04] p-3">
    <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]">{icon}{label}</p>
    <p className="stat-number text-2xl">{value}</p>
  </div>;
}
