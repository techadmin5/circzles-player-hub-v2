import Link from "next/link";
import { Search, UserPlus } from "lucide-react";
import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader, EmptyState } from "@/components/ui/kit";
import { FriendCard } from "@/components/social/social";
import { friendService, playerService } from "@/services";
import { dataMode } from "@/config/dataMode";
import { FeatureUnavailable } from "@/components/production/FeatureUnavailable";

export default async function Page() {
  if (dataMode === "api") return <GameShell><FeatureUnavailable title="Friends" description="Persistent friendships are not available yet." /></GameShell>;
  const [player, friends] = await Promise.all([playerService.getMockCurrentPlayer(), friendService.getFriends()]);
  return (
    <GameShell player={player}>
      <PageHeader kicker="Community" title="Friends" subtitle={`${friends.length} in your circle`} actions={
        <div className="flex gap-2">
          <Link href="/friends/search" className="cz-btn cz-btn-primary cz-btn-sm"><Search size={15} />Find Players</Link>
          <Link href="/friends/requests" className="cz-btn cz-btn-ghost cz-btn-sm"><UserPlus size={15} />Requests</Link>
        </div>} />
      {friends.length > 0
        ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{friends.map((f) => <FriendCard key={f.player.publicPlayerId} player={f.player} since={f.since} />)}</div>
        : <EmptyState icon={<UserPlus size={22} />} title="No friends yet" body="Search for players by public ID or display name to build your circle." action={<Link href="/friends/search" className="cz-btn cz-btn-primary">Find Players</Link>} />}
    </GameShell>
  );
}
