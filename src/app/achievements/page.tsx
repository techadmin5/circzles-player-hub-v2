import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { AchievementBadge } from "@/components/achievements/BadgeShowcase";
import { ACHIEVEMENT_CATALOG } from "@/config/assets";
import { playerService } from "@/services";

export default async function Page() {
  const player = await playerService.getMockCurrentPlayer();
  const owned = new Set(player.badgeShowcase);
  const unlocked = ACHIEVEMENT_CATALOG.filter((a) => owned.has(a.name));
  const locked = ACHIEVEMENT_CATALOG.filter((a) => !owned.has(a.name));

  return (
    <GameShell player={player}>
      <PageHeader kicker="Collectible" title="Achievements" subtitle={`${unlocked.length} of ${ACHIEVEMENT_CATALOG.length} unlocked`} />
      <div className="grid gap-5">
        <section className="cz-surface p-5">
          <h2 className="cz-display mb-4 text-base font-bold">Unlocked</h2>
          <div className="flex flex-wrap gap-6">
            {unlocked.length > 0 ? unlocked.map((a) => <AchievementBadge key={a.name} name={a.name} rarity={a.rarity} description={a.description} />) : <p className="text-sm text-[var(--cz-text-tertiary)]">No achievements unlocked yet.</p>}
          </div>
        </section>
        <section className="cz-surface p-5">
          <h2 className="cz-display mb-4 text-base font-bold">Locked</h2>
          <div className="flex flex-wrap gap-6">
            {locked.map((a) => <AchievementBadge key={a.name} name={a.name} rarity={a.rarity} locked />)}
          </div>
        </section>
      </div>
    </GameShell>
  );
}
