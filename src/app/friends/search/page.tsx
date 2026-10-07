import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { SearchResultCard } from "@/components/social/social";
import { friendService, playerService } from "@/services";
import { dataMode } from "@/config/dataMode";
import { FeatureUnavailable } from "@/components/production/FeatureUnavailable";

export default async function Page() {
  if (dataMode === "api") return <GameShell><FeatureUnavailable title="Player Search" description="Production friend search is not available yet." /></GameShell>;
  const [player, results] = await Promise.all([playerService.getMockCurrentPlayer(), friendService.searchPlayers("cz")]);
  const others = results.filter((p) => p.publicPlayerId !== player.publicPlayerId);
  return (
    <GameShell player={player}>
      <PageHeader kicker="Community" title="Find Players" subtitle="Search by public player ID or display name" />
      <div className="grid gap-4">
        <div className="cz-surface p-4">
          <input aria-label="Search players" placeholder="Player ID or display name" data-testid="friend-search-input"
            className="min-h-11 w-full rounded-xl border border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] px-3.5 text-sm outline-none placeholder:text-[var(--cz-text-tertiary)] focus:border-[var(--cz-aqua)]" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">{others.map((p) => <SearchResultCard key={p.publicPlayerId} player={p} />)}</div>
      </div>
    </GameShell>
  );
}
