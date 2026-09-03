import { AchievementBadge } from "./AchievementBadge";

export function BadgeShowcase({ badges }: { badges: string[] }) {
  return <section className="game-card p-5">
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <p className="text-sm font-semibold text-[var(--cyan)]">Achievement badges</p>
        <h2 className="font-display text-3xl font-bold">Showcase</h2>
      </div>
      <p className="text-xs text-[var(--text-muted)]">Mocked until achievement engine exists</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      {badges.map((badge) => <AchievementBadge key={badge} label={badge} />)}
      <AchievementBadge label="Future Badge" locked />
    </div>
  </section>;
}
