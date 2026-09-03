import { Award, Coins, Flame, Frame as FrameIcon, Sparkles, TrendingUp, Trophy, UserPlus } from "lucide-react";
import type { ActivityEvent } from "@/types";
import { relativeDate } from "@/lib/format";

const CATEGORY_ICON: Record<ActivityEvent["category"], React.ReactNode> = {
  Puzzles: <Sparkles size={15} />, Competitive: <Trophy size={15} />, Rewards: <FrameIcon size={15} />, Economy: <Coins size={15} />, Social: <UserPlus size={15} />,
};

function iconFor(event: ActivityEvent): React.ReactNode {
  const t = event.type.toLowerCase();
  if (t.includes("personal best")) return <TrendingUp size={15} />;
  if (t.includes("streak")) return <Flame size={15} />;
  if (t.includes("badge") || t.includes("level")) return <Award size={15} />;
  return CATEGORY_ICON[event.category] ?? <Sparkles size={15} />;
}

const CATEGORY_TONE: Record<ActivityEvent["category"], string> = {
  Puzzles: "var(--cz-aqua)", Competitive: "var(--cz-gold)", Rewards: "var(--cz-violet)", Economy: "var(--cz-emerald)", Social: "var(--cz-blue)",
};

export function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="cz-surface p-2" data-testid="activity-timeline">
      <ol className="relative ml-3 border-l border-[var(--cz-hairline)]">
        {events.map((event) => (
          <li key={event.id} className="relative py-3 pl-6 pr-3">
            <span className="absolute -left-[13px] top-4 grid h-6 w-6 place-items-center rounded-full border border-[var(--cz-hairline-strong)] bg-[var(--cz-surface-raised)]" style={{ color: CATEGORY_TONE[event.category] }}>
              {iconFor(event)}
            </span>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[0.62rem] uppercase tracking-wide" style={{ color: CATEGORY_TONE[event.category] }}>{event.type}</p>
                <p className="cz-display text-sm font-semibold">{event.title}</p>
                <p className="text-xs text-[var(--cz-text-secondary)]">{event.detail}</p>
              </div>
              <span className="shrink-0 text-xs text-[var(--cz-text-tertiary)]">{relativeDate(event.createdAt)}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
