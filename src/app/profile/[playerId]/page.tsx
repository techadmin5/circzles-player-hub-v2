import { Flame, Gem, Trophy, UserPlus } from "lucide-react";
import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader, Stat, Surface } from "@/components/ui/kit";
import { AvatarFrame, RankChip } from "@/components/player/AvatarFrame";
import { BadgeShowcase } from "@/components/achievements/BadgeShowcase";
import { playerService } from "@/services";
import { formatNumber } from "@/lib/format";

export default async function Page({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const [me, profile] = await Promise.all([playerService.getMockCurrentPlayer(), playerService.getProfile(playerId)]);
  return (
    <GameShell player={me}>
      <PageHeader kicker="Public Profile" title={profile.displayName} actions={<button className="cz-btn cz-btn-primary"><UserPlus size={16} />Add Friend</button>} />
      <div className="grid gap-5">
        <Surface grain className="p-5 sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7">
            <AvatarFrame avatar={profile.avatar} displayName={profile.displayName} frame={profile.equippedFrame} size={128} placement={null} />
            <div>
              <h2 className="cz-display text-2xl font-bold">{profile.displayName}</h2>
              <p className="text-sm text-[var(--cz-text-tertiary)]">{profile.publicPlayerId}{profile.country ? ` · ${profile.country}` : ""}</p>
              <div className="mt-3"><RankChip rank={profile.rank} level={profile.progressionLevel} /></div>
              <div className="mt-4 flex flex-wrap gap-6">
                <span className="flex items-center gap-2 text-sm"><Gem size={15} className="text-[var(--cz-gold)]" /><span className="cz-num font-semibold">{formatNumber(profile.synapsePoints)}</span> SP</span>
                <span className="flex items-center gap-2 text-sm"><Flame size={15} className="text-[var(--cz-aqua)]" /><span className="cz-num font-semibold">{profile.streak}</span> day streak</span>
              </div>
            </div>
          </div>
        </Surface>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Progression Level" value={String(profile.progressionLevel)} tone="aqua" />
          <Stat label="Rank" value={profile.rank} icon={<Trophy size={12} />} tone="gold" />
          <Stat label="Synapse Points" value={formatNumber(profile.synapsePoints)} icon={<Gem size={12} />} tone="gold" />
          <Stat label="Streak" value={`${profile.streak}d`} icon={<Flame size={12} />} />
        </div>
        <BadgeShowcase badges={profile.badgeShowcase} />
      </div>
    </GameShell>
  );
}
