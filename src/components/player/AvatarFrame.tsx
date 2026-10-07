import Image from "next/image";
import { Crown, Medal, Shield } from "lucide-react";
import type { RankName } from "@/types";
import { DEFAULT_AVATAR, frameAsset, rankEmblem } from "@/config/assets";
import { cn } from "@/lib/utils";

export type Placement = number | null | undefined;

/** Avatar image + cosmetic frame + optional leaderboard placement badge. */
export function AvatarFrame({ avatar, displayName, frame, size = 96, placement = null }: { avatar?: string; displayName?: string; frame?: string; size?: number; placement?: Placement }) {
  const frameSrc = frameAsset(frame);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="absolute inset-[8%] overflow-hidden rounded-full border border-[var(--cz-hairline-strong)] bg-[var(--cz-surface-raised)]">
        <Image unoptimized={avatar?.startsWith("https://")} src={avatar || DEFAULT_AVATAR} alt={displayName ?? ""} fill sizes={`${size}px`} className="object-cover" />
      </div>
      {frameSrc && <Image unoptimized={frameSrc.startsWith("https://")} src={frameSrc} alt="" fill sizes={`${size}px`} className="pointer-events-none select-none" />}
      <PlacementBadge placement={placement} size={size} />
    </div>
  );
}

export function PlacementBadge({ placement, size = 96 }: { placement: Placement; size?: number }) {
  if (!placement || placement < 1 || placement > 3) return null;
  const tone = placement === 1 ? "var(--cz-gold)" : placement === 2 ? "var(--cz-silver)" : "var(--cz-bronze)";
  const Icon = placement === 1 ? Crown : placement === 2 ? Medal : Shield;
  const badge = Math.max(26, Math.round(size * 0.32));
  return (
    <span
      className="absolute -bottom-1 -right-1 grid place-items-center rounded-full border-2 bg-[var(--cz-void)] shadow-lg"
      style={{ width: badge, height: badge, borderColor: tone, color: tone }}
      title={`Leaderboard placement #${placement}`}
    >
      <Icon size={badge * 0.44} />
    </span>
  );
}

export function PlacementMedal({ placement, size = "md" }: { placement: number; size?: "sm" | "md" | "lg" }) {
  const px = size === "lg" ? 52 : size === "sm" ? 30 : 40;
  const tone = placement === 1 ? "var(--cz-gold)" : placement === 2 ? "var(--cz-silver)" : placement === 3 ? "var(--cz-bronze)" : "var(--cz-text-tertiary)";
  const Icon = placement === 1 ? Crown : placement === 2 ? Medal : placement === 3 ? Shield : undefined;
  return (
    <span className="inline-grid shrink-0 place-items-center rounded-full border bg-black/25" style={{ width: px, height: px, borderColor: tone, color: tone }}>
      {Icon ? <Icon size={px * 0.46} /> : <span className="cz-display cz-num text-xs font-bold">#{placement}</span>}
    </span>
  );
}

/** Read-only progression rank chip (used on friend/list cards). Not placed over the avatar. */
export function RankChip({ rank, level, className }: { rank: RankName | string; level?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-lg border border-[var(--cz-hairline)] bg-white/[0.03] px-2 py-1", className)}>
      <Image src={rankEmblem(rank)} width={16} height={16} alt="" className="h-4 w-4 object-contain" />
      <span className="cz-display text-xs font-semibold text-[var(--cz-aqua)]">{rank}</span>
      {level != null && <span className="text-[10px] text-[var(--cz-text-tertiary)]">Lv {level}</span>}
    </span>
  );
}
