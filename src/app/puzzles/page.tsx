import { AddPuzzleForm, InstantTabs } from "@/components/Interactive";
import { PremiumPuzzleCard } from "@/components/puzzles/PremiumPuzzleCard";
import { AppShell, PageFrame } from "@/components/ui";
import { puzzleService } from "@/services";

export default async function Page() {
  const puzzles = await puzzleService.getOwnedPuzzles();
  return <AppShell><PageFrame title="Puzzles" action={<InstantTabs tabs={["All", "Ready", "Pending", "Completed"]} />}>
    <div className="grid gap-5">
      <AddPuzzleForm />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{puzzles.map((puzzle) => <PremiumPuzzleCard key={puzzle.id} puzzle={puzzle} />)}</div>
    </div>
  </PageFrame></AppShell>;
}
