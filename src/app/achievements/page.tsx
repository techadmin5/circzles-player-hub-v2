import { BadgeShowcase } from "@/components/achievements/BadgeShowcase";
import { AppShell, PageFrame } from "@/components/ui";
import { playerService } from "@/services";

export default async function Page() {
  const player = await playerService.getMockCurrentPlayer();
  return <AppShell><PageFrame title="Achievements">
    <BadgeShowcase badges={player.badgeShowcase} />
  </PageFrame></AppShell>;
}
