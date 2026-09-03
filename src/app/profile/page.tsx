import { BadgeShowcase } from "@/components/achievements/BadgeShowcase";
import { PlayerLobbyHeader } from "@/components/player/PlayerLobbyHeader";
import { AppShell, PageFrame, StatCard } from "@/components/ui";
import { playerService } from "@/services";

export default async function Page() {
  const player = await playerService.getMockCurrentPlayer();
  return <AppShell><PageFrame title="Profile"><div className="grid gap-5">
    <PlayerLobbyHeader player={player} />
    <div className="grid gap-3 md:grid-cols-4">{Object.entries(player.stats).map(([key, value]) => <StatCard key={key} label={key} value={String(value)} />)}</div>
    <BadgeShowcase badges={player.badgeShowcase} />
  </div></PageFrame></AppShell>;
}
