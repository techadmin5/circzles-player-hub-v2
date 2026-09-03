import { UserPlus } from "lucide-react";
import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader, EmptyState } from "@/components/ui/kit";
import { RequestCard } from "@/components/social/social";
import { friendService, playerService } from "@/services";

export default async function Page() {
  const [player, requests] = await Promise.all([playerService.getMockCurrentPlayer(), friendService.getRequests()]);
  return (
    <GameShell player={player}>
      <PageHeader kicker="Community" title="Friend Requests" subtitle="Incoming and outgoing connections" />
      {requests.length > 0
        ? <div className="grid gap-3 sm:grid-cols-2">{requests.map((r) => <RequestCard key={r.id} request={r} />)}</div>
        : <EmptyState icon={<UserPlus size={22} />} title="No pending requests" body="Friend requests you send or receive will show up here." />}
    </GameShell>
  );
}
