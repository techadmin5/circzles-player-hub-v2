import Link from "next/link";
import { CalendarClock, Crown } from "lucide-react";
import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader, Chip, SectionHeader, Stat } from "@/components/ui/kit";
import { MissionCard } from "@/components/missions/missions";
import { playerService, seasonService } from "@/services";
import { formatDate } from "@/lib/format";
import { dataMode } from "@/config/dataMode";
import { FeatureUnavailable } from "@/components/production/FeatureUnavailable";

export default async function Page() {
  if (dataMode === "api") return <GameShell><FeatureUnavailable title="Season" description="Season details are deferred until the production season API is available." /></GameShell>;
  const [player, season] = await Promise.all([playerService.getMockCurrentPlayer(), seasonService.getCurrentSeason()]);
  return (
    <GameShell player={player}>
      <PageHeader kicker="Season" title={season.name} subtitle={`${formatDate(season.startAt)} — ${formatDate(season.endAt)}`} actions={<Link href="/seasons" className="cz-btn cz-btn-ghost cz-btn-sm">All Seasons</Link>} />
      <div className="grid gap-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Status" value={season.status} icon={<CalendarClock size={12} />} />
          <Stat label="Your Placement" value={`#${season.playerRank}`} icon={<Crown size={12} />} tone="gold" />
          <Stat label="Active Missions" value={String(season.missions.length)} tone="aqua" />
        </div>
        <div className="flex flex-wrap gap-1.5">{season.rewards.map((r) => <Chip key={r.label} tone="gold">{r.label}</Chip>)}</div>
        <div>
          <SectionHeader title="Season Missions" />
          <div className="grid gap-3 md:grid-cols-2">{season.missions.map((m) => <MissionCard key={m.missionId} mission={m} />)}</div>
        </div>
      </div>
    </GameShell>
  );
}
