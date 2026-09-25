"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Camera, Flame, Gem, Trophy } from "lucide-react";
import type { PlayerProfile } from "@/types";
import { progressionRanks } from "@/config/progression";
import { AvatarFrame, type Placement } from "@/components/player/AvatarFrame";
import { ProgressionBadge } from "@/components/progression/ProgressionBadge";
import { ProgressionCodex } from "@/components/progression/ProgressionCodex";
import { AvatarPicker } from "@/components/avatar/AvatarPicker";
import { apiClient, ApiClientError } from "@/lib/apiClient";
import { playSound } from "@/hooks/useSound";
import { formatNumber } from "@/lib/format";
import { usePlayerUiState } from "@/stores/playerUiState";
import { useAuth } from "@/components/auth/AuthProvider";

function rankFor(progressionLevel: number) {
  return progressionRanks.reduce((current, rank) => (rank.progressionLevel <= progressionLevel ? rank : current), progressionRanks[0]);
}

function MiniStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-[var(--cz-text-tertiary)]">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[0.62rem] uppercase tracking-wider text-[var(--cz-text-tertiary)]">{label}</p>
        <p className="cz-display cz-num truncate text-base font-bold">{value}</p>
      </div>
    </div>
  );
}

export function PlayerHero({ player, placement = null, profileMode = false, onOpenCodex, onEditAvatar, header, productionData = false }: {
  player: PlayerProfile; placement?: Placement; profileMode?: boolean; onOpenCodex: () => void; onEditAvatar?: () => void; header?: ReactNode; productionData?: boolean;
}) {
  const rank = rankFor(player.progressionLevel);
  const next = progressionRanks.find((r) => r.order === rank.order + 1);
  const pct = Math.min(100, Math.round((player.xp / Math.max(1, player.xpNeeded)) * 100));

  return (
    <section className="cz-surface cz-grain cz-fade-up relative w-full min-w-0 overflow-hidden p-5 sm:p-7" data-testid="player-hero">
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(61,234,212,0.12) 0%, transparent 70%)" }} />
      {header}
      <div className="relative flex min-w-0 flex-col gap-5 sm:flex-row sm:items-center sm:gap-7">
        <div className="shrink-0">
          <AvatarFrame avatar={player.avatar} displayName={player.displayName} frame={player.equippedFrame} size={profileMode ? 148 : 128} placement={placement} />
          {onEditAvatar && <button onClick={onEditAvatar} data-sound="silent" data-testid="edit-avatar-btn" className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[var(--cz-hairline)] bg-white/[0.03] px-3 py-2 text-xs text-[var(--cz-text-secondary)] hover:text-[var(--cz-text-primary)]">
            <Camera size={14} />Change Avatar
          </button>}
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="cz-display truncate text-2xl font-bold sm:text-3xl">{player.displayName}</h2>
          <p className="truncate text-sm text-[var(--cz-text-tertiary)]">{player.publicPlayerId}{player.country ? ` · ${player.state ? `${player.state}, ` : ""}${player.country}` : ""}</p>

          <button onClick={onOpenCodex} data-sound="silent" data-testid="rank-chip-btn" className="mt-3 inline-flex items-center gap-2 rounded-xl border border-[var(--cz-hairline)] bg-white/[0.03] px-3 py-2 text-left transition-colors hover:border-[rgba(61,234,212,0.5)]">
            <ProgressionBadge rankName={rank.rank} size="xs" animated decorative />
            <span>
              <span className="cz-display block text-sm font-semibold text-[var(--cz-aqua)]">{rank.rank}</span>
              <span className="block text-xs text-[var(--cz-text-tertiary)]">Progression Level {player.progressionLevel}</span>
            </span>
          </button>

          <div className="mt-4 max-w-md">
            <div className="cz-track"><div className="cz-track-fill" style={{ width: `${pct}%` }} /></div>
            <div className="mt-1.5 flex items-center justify-between text-xs text-[var(--cz-text-tertiary)]">
              <span className="cz-num">{formatNumber(player.xp)} / {formatNumber(player.xpNeeded)} XP</span>
              {next && <span>Next: {next.rank}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="relative mt-6 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--cz-hairline)] pt-4 sm:flex sm:flex-wrap sm:gap-x-8">
        <MiniStat icon={<Gem size={15} />} label="Synapse Points" value={formatNumber(player.synapsePoints)} />
        {!productionData && <><MiniStat icon={<Flame size={15} />} label="Streak" value={`${player.streak} days`} /><MiniStat icon={<Trophy size={15} />} label="Season Placement" value={`#${player.stats.seasonRank}`} /><MiniStat icon={<Trophy size={15} />} label="Podiums" value={String(player.stats.podiums)} /></>}
      </div>
    </section>
  );
}

/**
 * Owns codex + avatar-picker presentation. AuthProvider owns production profile hydration.
 */
export function PlayerIdentityPanel({ fallbackPlayer, mode = "mock", placement = null, profileMode = false }: {
  fallbackPlayer: PlayerProfile; mode?: "mock" | "api"; placement?: Placement; profileMode?: boolean;
}) {
  const { acceptAuthentication } = useAuth();
  const [previewAvatar, setPreviewAvatar] = useState<string>();
  const [codexOpen, setCodexOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authoritativeDisplayName = usePlayerUiState((state) => state.displayName);

  async function devLogin() {
    playSound("button");
    setError(null);
    try {
      const me = await apiClient.devLogin();
      acceptAuthentication(me);
      setPreviewAvatar(undefined);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Development login failed.");
    }
  }

  const shown = { ...fallbackPlayer, displayName: mode === "api" ? authoritativeDisplayName ?? fallbackPlayer.displayName : fallbackPlayer.displayName, avatar: previewAvatar ?? fallbackPlayer.avatar };
  const devControls = process.env.NODE_ENV === "development" && mode === "api" ? (
    <div className="mb-4 flex flex-col gap-2 rounded-xl border border-[var(--cz-hairline)] bg-[var(--cz-inset)] p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-semibold text-[var(--cz-aqua)]">Authenticated identity</p>
        <p className="text-xs text-[var(--cz-text-tertiary)]">Gameplay profile hydrated via GET /api/me - publicPlayerId {fallbackPlayer.publicPlayerId}</p>
        {error && <p className="mt-1 text-xs text-[var(--cz-danger)]">{error}</p>}
      </div>
      <button className="cz-btn cz-btn-primary cz-btn-sm shrink-0" onClick={devLogin} data-testid="dev-login-btn">Development Login</button>
    </div>
  ) : null;

  return (
    <>
      <PlayerHero player={shown} placement={placement} profileMode={profileMode} productionData={mode === "api"} onOpenCodex={() => { playSound("modalOpen"); setCodexOpen(true); }} onEditAvatar={mode === "mock" ? () => { playSound("modalOpen"); setPickerOpen(true); } : undefined} header={devControls} />
      <ProgressionCodex open={codexOpen} onClose={() => setCodexOpen(false)} player={shown} showRewardPreview={mode === "mock"} />
      <AvatarPicker open={pickerOpen} currentAvatar={shown.avatar} onPreview={setPreviewAvatar} onClose={() => setPickerOpen(false)} />
    </>
  );
}
