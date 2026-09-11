"use client";

import { AlertTriangle, Coins, Layers3, Sparkles, Trophy, Zap } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useGameFeedback, type RewardFeedback } from "@/components/feedback/GameFeedbackProvider";
import { useSound } from "@/hooks/useSound";
import { snapshotFromProfile } from "@/stores/playerUiState";
import type { PlayerProfile } from "@/types";
import { ProgressionBadge } from "@/components/progression/ProgressionBadge";
import { progressionRankNames } from "@/config/progressionVisuals";
import type { ProgressionRewardPreview } from "@/components/progression/LevelUpOverlay";

const transitions = progressionRankNames.slice(1).map((rank, index) => ({ previous: progressionRankNames[index], next: rank }));
const previewRewards: ProgressionRewardPreview[] = [
  { type: "SYNAPSE_POINTS", label: "+500 SP", amount: 500 }, { type: "FRAME", label: "Rare Frame" },
  { type: "RENAME_CARD", label: "Rename Card" }, { type: "COUPON", label: "10% Coupon" },
];

export function GameFeelLab({ player }: { player: PlayerProfile }) {
  const { celebrateReward, showErrorFeedback } = useGameFeedback();
  const reducedMotion = useSound((state) => state.reducedMotion);
  const setSound = useSound((state) => state.setSound);
  const base = snapshotFromProfile(player);
  const [scenario, setScenario] = useState(2);
  const [collectionMessage, setCollectionMessage] = useState("");

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

  const previewProgression = () => {
    const selected = transitions[scenario];
    setCollectionMessage("");
    celebrateReward({ source: "PREVIEW", synapsePoints: 0, xp: 1, previousPlayerState: { ...base, rankName: selected.previous, progressionLevel: scenario + 1 }, newPlayerState: { ...base, rankName: selected.next, progressionLevel: scenario + 2 }, label: "Progression Preview", progressionRewards: previewRewards, onCollectProgressionRewards: () => setCollectionMessage("Rewards Collected - local preview only") });
  };

  const previewGenericRankUp = () => {
    setCollectionMessage("");
    celebrateReward({ source: "PREVIEW", synapsePoints: 0, xp: 500, previousPlayerState: { ...base, rankName: "Squire" }, newPlayerState: { ...base, xp: base.xp + 500, rankName: "Knight", progressionLevel: base.progressionLevel + 1 }, label: "Major Progress", progressionRewards: previewRewards, onCollectProgressionRewards: () => setCollectionMessage("Rewards Collected - local preview only") });
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
        <LabButton icon={<Trophy />} label="Rank Up" onClick={previewGenericRankUp} />
        <LabButton icon={<Sparkles />} label="Reward Reveal" onClick={() => preview(250, 0, false, "Reward Unlocked")} />
        <LabButton icon={<AlertTriangle />} label="Error Feedback" onClick={() => showErrorFeedback("Preview action could not be completed.")} />
        <LabButton icon={<Layers3 />} label="Queue 3 Rewards" onClick={() => { preview(250, 0); preview(0, 500); preview(100, 100, true); }} />
      </div>
    </section>
    <section className="cz-surface min-w-0 grid gap-5 p-5">
      <div><p className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-[var(--cz-gold)]">Development Preview - No Rewards Are Actually Granted</p><h2 className="cz-display mt-1 font-bold">Progression / Level Up</h2></div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]"><label className="grid gap-1 text-sm text-[var(--cz-text-secondary)]">Transition<select className="rounded-lg border border-[var(--cz-hairline)] bg-[#090e18] px-3 py-2 text-white" value={scenario} onChange={(event) => setScenario(Number(event.target.value))}>{transitions.map((item, index) => <option value={index} key={item.next}>{item.previous} to {item.next}</option>)}</select></label><button type="button" className="cz-btn cz-btn-primary self-end" onClick={previewProgression}><Trophy size={17} />Preview Level Up</button></div>
      {collectionMessage && <p role="status" className="text-sm text-[var(--cz-aqua)]">{collectionMessage}</p>}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">{progressionRankNames.map((rank) => <div key={rank} className="grid min-w-0 place-items-center gap-1 rounded-lg border border-[var(--cz-hairline)] bg-black/15 p-2"><ProgressionBadge rankName={rank} size="sm" animated decorative /><span className="w-full truncate text-center text-[0.65rem] text-[var(--cz-text-secondary)]">{rank}</span></div>)}</div>
    </section>
  </div>;
}

function LabButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" className="cz-btn cz-btn-ghost justify-start" onClick={onClick}>{icon}{label}</button>;
}
