import Link from "next/link";
import { CalendarClock, Crown, Gift } from "lucide-react";
import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader, Chip, SectionHeader } from "@/components/ui/kit";
import { MissionCard } from "@/components/missions/missions";
import { playerService, seasonService } from "@/services";
import { formatDate } from "@/lib/format";

function daysLeft(endAt: string) {
  const d = Math.ceil((new Date(endAt).getTime() - Date.now()) / 86_400_000);
  return d > 0 ? `${d} days remaining` : "Season ended";
}

export default async function Page() {
  const [player, season] = await Promise.all([playerService.getMockCurrentPlayer(), seasonService.getCurrentSeason()]);
  return (
    <GameShell player={player}>
      <PageHeader kicker="Live" title="Seasons" subtitle="Compete across timed CircZles seasons" />
      <div className="grid gap-5">
        <Link href={`/seasons/${season.seasonId}`} className="cz-surface cz-grain relative block overflow-hidden p-6 transition-transform hover:-translate-y-0.5">
          <div className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(232,180,80,0.14), transparent 70%)" }} />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div>
              <Chip tone="gold">{season.status}</Chip>
              <h2 className="cz-display mt-2 text-2xl font-bold">{season.name}</h2>
              <p className="mt-1 flex items-center gap-2 text-sm text-[var(--cz-text-secondary)]"><CalendarClock size={14} />{formatDate(season.startAt)} — {formatDate(season.endAt)} · {daysLeft(season.endAt)}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">{season.rewards.map((r) => <Chip key={r.label} tone="gold"><Gift size={11} />{r.label}</Chip>)}</div>
            </div>
            <div className="text-center">
              <p className="flex items-center justify-center gap-1 text-[0.62rem] uppercase tracking-wide text-[var(--cz-text-tertiary)]"><Crown size={12} />Your placement</p>
              <p className="cz-display cz-num text-5xl font-bold text-[var(--cz-gold)]">#{season.playerRank}</p>
            </div>
          </div>
        </Link>
        <div>
          <SectionHeader title="Season Missions" />
          <div className="grid gap-3 md:grid-cols-2">{season.missions.map((m) => <MissionCard key={m.missionId} mission={m} />)}</div>
        </div>
      </div>
    </GameShell>
  );
}
