import { cn } from "@/lib/utils";

export function LeaderboardPlayerIdentity({
  publicPlayerId,
  displayName,
  isCurrentPlayer = false,
  compact = false,
}: {
  publicPlayerId: string;
  displayName: string;
  isCurrentPlayer?: boolean;
  compact?: boolean;
}) {
  const initials = displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "CZ";

  return (
    <span className="flex min-w-0 items-center gap-2" data-public-player-id={publicPlayerId}>
      <span
        aria-hidden="true"
        className={cn(
          "grid shrink-0 place-items-center rounded-full border border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] font-bold text-[var(--cz-text-secondary)]",
          compact ? "h-8 w-8 text-[0.62rem]" : "h-9 w-9 text-[0.68rem]",
        )}
      >
        {initials}
      </span>
      <span className="min-w-0 truncate text-sm font-semibold">
        {displayName}
        {isCurrentPlayer && <span className="ml-1.5 text-[0.68rem] font-semibold text-[var(--cz-aqua)]">You</span>}
      </span>
    </span>
  );
}
