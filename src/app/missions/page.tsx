import { ClaimMissionButton, InstantTabs } from "@/components/Interactive";
import { PremiumMissionCard } from "@/components/missions/PremiumMissionCard";
import { AppShell, PageFrame } from "@/components/ui";
import { missionService } from "@/services";

export default async function Page() {
  const missions = await missionService.getMissions();
  return <AppShell><PageFrame title="Missions" action={<InstantTabs tabs={["All", "Daily", "Weekly", "Sprint", "Season"]} />}>
    <div className="grid gap-4 md:grid-cols-2">
      {missions.map((mission) => <PremiumMissionCard key={mission.missionId} mission={mission} action={mission.claimable && <ClaimMissionButton missionId={mission.missionId} />} />)}
    </div>
  </PageFrame></AppShell>;
}
