"use client";

import { AlertTriangle, Coins, Layers3, Sparkles, Trophy, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { useGameFeedback, type RewardFeedback } from "@/components/feedback/GameFeedbackProvider";
import { useSound } from "@/hooks/useSound";
import { snapshotFromProfile } from "@/stores/playerUiState";
import type { PlayerProfile } from "@/types";

export function GameFeelLab({ player }: { player: PlayerProfile }) {
  const { celebrateReward, showErrorFeedback } = useGameFeedback();
  const reducedMotion = useSound((state) => state.reducedMotion);
  const setSound = useSound((state) => state.setSound);
  const base = snapshotFromProfile(player);

  const preview = (sp: number, xp: number, rankUp = false, label?: string) => {
    const feedback: RewardFeedback = {
      source: "PREVIEW",
      synapsePoints: sp,
      xp,
      previousPlayerState: base,
      newPlayerState: {
        ...base,
        synapsePoints: base.synapsePoints + sp,
        xp: base.xp + xp,
        progressionLevel: base.progressionLevel + (rankUp ? 1 : 0),
        rankName: rankUp ? "Farmer" : base.rankName,
      },
      label,
    };
    celebrateReward(feedback);
  };

  return <div className="grid gap-6">
    <header><span className="cz-chip border-cyan-300/30 text-[var(--cz-aqua)]">Development Preview</span><h1 className="cz-display mt-3 text-2xl font-bold sm:text-3xl">Game Feel Lab</h1><p className="mt-2 max-w-2xl text-sm text-[var(--cz-text-secondary)]">Local presentation scenarios. No claims, rewards, or backend writes occur here.</p></header>
    <section className="cz-surface min-w-0 grid gap-4 p-5">
      <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between"><h2 className="cz-display font-bold">Reward scenarios</h2><label className="flex items-center gap-2 whitespace-nowrap text-sm text-[var(--cz-text-secondary)]"><input type="checkbox" checked={reducedMotion} onChange={(event) => setSound({ reducedMotion: event.target.checked })} /> Reduced motion</label></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <LabButton icon={<Coins />} label="+250 SP" onClick={() => preview(250, 0)} />
        <LabButton icon={<Zap />} label="+500 XP" onClick={() => preview(0, 500)} />
        <LabButton icon={<Sparkles />} label="+250 SP +500 XP" onClick={() => preview(250, 500)} />
        <LabButton icon={<Trophy />} label="Mission Complete" onClick={() => preview(250, 500, false, "Mission Complete")} />
        <LabButton icon={<Trophy />} label="Rank Up" onClick={() => preview(0, 500, true, "Major Progress")} />
        <LabButton icon={<Sparkles />} label="Reward Reveal" onClick={() => preview(250, 0, false, "Reward Unlocked")} />
        <LabButton icon={<AlertTriangle />} label="Error Feedback" onClick={() => showErrorFeedback("Preview action could not be completed.")} />
        <LabButton icon={<Layers3 />} label="Queue 3 Rewards" onClick={() => { preview(250, 0); preview(0, 500); preview(100, 100, true); }} />
      </div>
    </section>
  </div>;
}

function LabButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" className="cz-btn cz-btn-ghost justify-start" onClick={onClick}>{icon}{label}</button>;
}
