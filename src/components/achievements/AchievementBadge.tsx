import { Award, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export function AchievementBadge({ label, locked = false }: { label: string; locked?: boolean }) {
  return <div className={cn("grid min-h-32 place-items-center rounded-lg border border-white/10 bg-white/[.04] p-4 text-center", locked && "opacity-45")}>
    <div className="grid h-14 w-14 place-items-center rounded-lg border border-[var(--gold)]/60 bg-black/30 text-[var(--gold)]">
      {locked ? <Lock className="h-6 w-6" /> : <Award className="h-6 w-6" />}
    </div>
    <p className="mt-3 font-display text-xl font-bold">{label}</p>
  </div>;
}
