import Image from "next/image";
import { Award, Lock } from "lucide-react";
import type { Rarity } from "@/types";
import { badgeIcon, RARITY_META } from "@/config/assets";
import { cn } from "@/lib/utils";

export function AchievementBadge({ name, rarity = "common", locked = false, description }: { name: string; rarity?: Rarity; locked?: boolean; description?: string }) {
  const meta = RARITY_META[rarity];
  const icon = badgeIcon(name);
  const glow = rarity === "legendary" && !locked;
  return (
    <div className="group grid justify-items-center gap-2 text-center" data-testid={`badge-${name.replace(/\s+/g, "-").toLowerCase()}`}>
      <div className="relative h-[76px] w-[76px]">
        {glow && <span className="absolute inset-[-22%] animate-pulse rounded-full bg-[var(--cz-gold-dim)] blur-md" />}
        <div className={cn("relative grid h-full w-full place-items-center overflow-hidden rounded-full bg-[var(--cz-surface-raised)]", locked && "opacity-40 grayscale")}
          style={{ boxShadow: `0 0 0 2px ${locked ? "var(--cz-hairline-strong)" : meta.ring}` }}>
          {locked ? <Lock size={22} className="text-[var(--cz-text-tertiary)]" /> : icon ? <Image src={icon} alt={name} fill sizes="76px" className="object-contain p-2.5" /> : <Award size={26} style={{ color: meta.color }} />}
        </div>
      </div>
      <div>
        <p className="cz-display max-w-[100px] truncate text-xs font-semibold">{locked ? "Locked" : name}</p>
        {!locked && <p className="text-[0.6rem] uppercase tracking-wide" style={{ color: meta.color }}>{meta.label}</p>}
      </div>
      {description && !locked && <p className="max-w-[110px] text-[0.62rem] leading-tight text-[var(--cz-text-tertiary)]">{description}</p>}
    </div>
  );
}

/** Compact showcase used on the Player Hub and Profile. */
export function BadgeShowcase({ badges }: { badges: string[] }) {
  return (
    <div className="cz-surface p-5">
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2 className="cz-display text-base font-bold">Badge Showcase</h2>
        <a href="/achievements" className="text-xs text-[var(--cz-aqua)]">View all</a>
      </div>
      <div className="flex flex-wrap gap-5">
        {badges.map((b) => <AchievementBadge key={b} name={b} rarity="rare" />)}
        <AchievementBadge name="Locked" locked />
      </div>
    </div>
  );
}
