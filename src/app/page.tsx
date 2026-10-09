import Link from "next/link";
import { ArrowRight, Award, Gem, Puzzle, ScanLine, Trophy, Upload } from "lucide-react";
import { PublicShell } from "@/components/public/PublicShell";

const FLOW = [
  { icon: <Puzzle size={16} />, label: "Own a physical CircZles" },
  { icon: <ScanLine size={16} />, label: "Add it with its physical code" },
  { icon: <Upload size={16} />, label: "Solve, record & submit your attempt" },
  { icon: <Award size={16} />, label: "Get verified · earn XP & Synapse Points" },
  { icon: <Trophy size={16} />, label: "Climb leaderboards & progression ranks" },
];

const PILLARS = [
  { title: "Verified Solving", body: "Every ranked time is a reviewed, verified solve — no shortcuts." },
  { title: "RPG Progression", body: "Rise from Peasant to Conqueror across nine competitive ranks." },
  { title: "Rewards Economy", body: "Earn Synapse Points, spin the reward wheel, collect frames & badges." },
];

export default function Home() {
  return (
    <PublicShell>
      <section className="mx-auto grid max-w-6xl content-center gap-10 px-4 py-16 md:grid-cols-[1.15fr_0.85fr] md:py-24">
        <div>
          <span className="cz-chip">Phygital CircZles ecosystem</span>
          <h1 className="cz-display mt-4 text-4xl font-bold leading-[1.05] sm:text-5xl md:text-6xl">Turn every CircZles into a competitive challenge.</h1>
          <p className="mt-5 max-w-xl text-base text-[var(--cz-text-secondary)]">A premium hub for verified solves, RPG progression, Synapse Points, missions, seasons and community rivalries — the gamification layer of CircZles.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/hub" className="cz-btn cz-btn-primary">Enter Player Hub<ArrowRight size={16} /></Link>
            <Link href="/signup" className="cz-btn cz-btn-ghost">Create Profile</Link>
          </div>
          <div className="mt-8 flex flex-wrap gap-6 text-sm text-[var(--cz-text-tertiary)]">
            <span className="flex items-center gap-2"><Trophy size={15} className="text-[var(--cz-gold)]" />9 progression ranks</span>
            <span className="flex items-center gap-2"><Gem size={15} className="text-[var(--cz-aqua)]" />Synapse economy</span>
          </div>
        </div>
        <div className="cz-surface cz-grain p-6">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--cz-aqua)]">How it works</p>
          <ol className="mt-3 grid gap-1">
            {FLOW.map((f, i) => (
              <li key={f.label} className="flex items-center gap-3 border-b border-[var(--cz-hairline)] py-3 last:border-0">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] text-[var(--cz-aqua)]">{f.icon}</span>
                <span className="text-sm text-[var(--cz-text-secondary)]"><span className="cz-num mr-2 text-[var(--cz-text-tertiary)]">{String(i + 1).padStart(2, "0")}</span>{f.label}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-20 md:grid-cols-3">
        {PILLARS.map((p) => (
          <div key={p.title} className="cz-surface p-5">
            <h2 className="cz-display text-lg font-bold">{p.title}</h2>
            <p className="mt-1.5 text-sm text-[var(--cz-text-secondary)]">{p.body}</p>
          </div>
        ))}
      </section>
    </PublicShell>
  );
}
