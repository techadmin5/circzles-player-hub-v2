import Image from "next/image";
import { Lock, Sparkles } from "lucide-react";
import { getProgressionRank, type ProgressionRankConfig } from "@/config/progression";
import { cn } from "@/lib/utils";

export function ProgressionRankEmblem({ rank, state = "unlocked", size = "md" }: { rank: ProgressionRankConfig; state?: "locked" | "unlocked" | "current"; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "lg" ? "h-24 w-24" : size === "sm" ? "h-12 w-12" : "h-16 w-16";
  return <div className={cn("relative grid shrink-0 place-items-center rounded-lg border bg-black/30", sizeClass, state === "current" && "glow-border", state === "locked" && "grayscale opacity-45")} style={{ borderColor: rank.theme.primary }}>
    <Image src={rank.emblemPath} alt="" width={72} height={72} className="h-4/5 w-4/5 object-contain" />
    {state === "locked" && <Lock className="absolute bottom-1 right-1 h-4 w-4 text-[var(--text-muted)]" />}
    {state === "current" && <Sparkles className="absolute -right-2 -top-2 h-5 w-5" style={{ color: rank.theme.primary }} />}
  </div>;
}

export function CurrentProgressionEmblem({ progressionLevel }: { progressionLevel: number }) {
  return <ProgressionRankEmblem rank={getProgressionRank(progressionLevel)} state="current" size="lg" />;
}
