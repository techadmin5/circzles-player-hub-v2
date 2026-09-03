import Link from "next/link";
import { AppShell, PageFrame } from "@/components/ui";
import { seasonService } from "@/services";

export default async function Page() {
  const season = await seasonService.getCurrentSeason();
  return <AppShell><PageFrame title="Seasons">
    <Link href={`/seasons/${season.seasonId}`} className="game-card block p-5 transition-transform hover:-translate-y-0.5">
      <p className="text-sm font-semibold text-[var(--cyan)]">{season.status}</p>
      <h2 className="font-display text-4xl font-bold">{season.name}</h2>
      <p className="text-[var(--text-secondary)]">Placement #{season.playerRank} | season missions active</p>
    </Link>
  </PageFrame></AppShell>;
}
