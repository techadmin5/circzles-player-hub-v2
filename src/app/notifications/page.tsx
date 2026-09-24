import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { NotificationList } from "@/components/social/social";
import { notificationService, playerService } from "@/services";
import { dataMode } from "@/config/dataMode";
import { FeatureUnavailable } from "@/components/production/FeatureUnavailable";

export default async function Page() {
  if (dataMode === "api") return <GameShell><FeatureUnavailable title="Notifications" description="Persistent notifications are not available yet." /></GameShell>;
  const [player, notifications] = await Promise.all([playerService.getMockCurrentPlayer(), notificationService.getNotifications()]);
  return (
    <GameShell player={player}>
      <PageHeader kicker="Inbox" title="Notifications" subtitle="Alerts across your CircZles hub" />
      <NotificationList items={notifications} />
    </GameShell>
  );
}
