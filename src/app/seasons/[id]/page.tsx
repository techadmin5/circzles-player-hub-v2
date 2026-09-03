import { PremiumMissionCard } from "@/components/missions/PremiumMissionCard";
import { AppShell, PageFrame } from "@/components/ui";
import { seasonService } from "@/services";

export default async function Page() {
  const season = await seasonService.getCurrentSeason();
  return <AppShell><PageFrame title={season.name} eyebrow="Season">
    <div className="game-card p-5">
      <p className="text-sm font-semibold text-[var(--cyan)]">Current placement</p>
      <p className="stat-number text-4xl">#{season.playerRank}</p>
      <p className="text-[var(--text-secondary)]">{season.status} season window</p>
    </div>
    <div className="mt-5 grid gap-3 md:grid-cols-2">{season.missions.map((mission) => <PremiumMissionCard key={mission.missionId} mission={mission} />)}</div>
  </PageFrame></AppShell>;
}
