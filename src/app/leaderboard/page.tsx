import { InstantTabs } from "@/components/Interactive";
import { PremiumLeaderboard } from "@/components/leaderboard/PremiumLeaderboard";
import { AppShell, PageFrame } from "@/components/ui";
import { leaderboardService } from "@/services";

export default async function Page() {
  const lb = await leaderboardService.getLeaderboard({ mode: "GLOBAL", period: "ALL_TIME" });
  return <AppShell><PageFrame title="Leaderboard" action={<InstantTabs tabs={["GLOBAL", "COUNTRY", "STATE", "FRIENDS"]} />}>
    <div className="mb-4 grid gap-2 sm:grid-cols-4">
      <select className="rounded-md border border-white/15 bg-black/30 p-3"><option>Puzzle</option></select>
      <select className="rounded-md border border-white/15 bg-black/30 p-3"><option>levelId</option></select>
      <select className="rounded-md border border-white/15 bg-black/30 p-3"><option>Season</option></select>
      <select className="rounded-md border border-white/15 bg-black/30 p-3"><option>All Time</option></select>
    </div>
    <PremiumLeaderboard entries={lb.entries} />
    <div className="game-card mt-4 p-4"><strong>YOUR PLACEMENT</strong><p className="stat-number text-4xl">#{lb.yourRank}</p></div>
  </PageFrame></AppShell>;
}
