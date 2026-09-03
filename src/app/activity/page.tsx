import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader, EmptyState } from "@/components/ui/kit";
import { ActivityTimeline } from "@/components/activity/ActivityTimeline";
import { Activity } from "lucide-react";
import { activityService, playerService } from "@/services";

export default async function Page() {
  const [player, events] = await Promise.all([playerService.getMockCurrentPlayer(), activityService.getActivity()]);
  return (
    <GameShell player={player}>
      <PageHeader kicker="Timeline" title="Activity" subtitle="Every solve, reward and social event" />
      {events.length > 0 ? <ActivityTimeline events={events} /> : <EmptyState icon={<Activity size={22} />} title="No activity yet" body="Your competitive and reward events will appear here." />}
    </GameShell>
  );
}
