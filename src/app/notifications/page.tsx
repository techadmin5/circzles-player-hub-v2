import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { NotificationList } from "@/components/social/social";
import { notificationService, playerService } from "@/services";

export default async function Page() {
  const [player, notifications] = await Promise.all([playerService.getMockCurrentPlayer(), notificationService.getNotifications()]);
  return (
    <GameShell player={player}>
      <PageHeader kicker="Inbox" title="Notifications" subtitle="Alerts across your CircZles hub" />
      <NotificationList items={notifications} />
    </GameShell>
  );
}
