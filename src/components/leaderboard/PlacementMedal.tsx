import { Crown, Medal, Trophy } from "lucide-react";

export function PlacementMedal({ rank }: { rank: number }) {
  const isPodium = rank <= 3;
  const Icon = rank === 1 ? Crown : rank === 2 ? Trophy : Medal;
  const tone = rank === 1 ? "#f8c84e" : rank === 2 ? "#e5eefb" : rank === 3 ? "#c4874a" : "#74839a";
  return <span className="inline-flex items-center gap-2">
    <span className="grid h-10 w-10 place-items-center rounded-lg border bg-black/30" style={{ borderColor: tone, color: tone }}>
      {isPodium ? <Icon className="h-5 w-5" /> : <span className="stat-number text-lg">#{rank}</span>}
    </span>
    <span className="stat-number text-2xl" style={{ color: tone }}>#{rank}</span>
  </span>;
}
