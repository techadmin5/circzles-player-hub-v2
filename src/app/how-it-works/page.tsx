import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PublicShell } from "@/components/public/PublicShell";

const STEPS = [
  { title: "Own a CircZles puzzle", body: "Every physical CircZles puzzle carries a unique physical code." },
  { title: "Add it to your Player Hub", body: "Enter the SKU to link the puzzle (puzzleId) and its difficulty (levelId) to your account." },
  { title: "Solve & record", body: "Solve the puzzle and capture a clear solve video." },
  { title: "Submit for verification", body: "Submit your attempt with your completion time; a reviewer verifies it." },
  { title: "Earn & climb", body: "Approved solves grant XP and Synapse Points, and place you on leaderboards." },
  { title: "Progress & collect", body: "Rank up from Peasant to Conqueror, complete missions and collect rewards." },
];

export default function Page() {
  return (
    <PublicShell>
      <section className="mx-auto max-w-4xl px-4 py-16">
        <span className="cz-chip">Getting started</span>
        <h1 className="cz-display mt-4 text-3xl font-bold sm:text-4xl">How CircZles Player Hub works</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--cz-text-secondary)]">A quick tour of the phygital loop from physical puzzle to competitive placement.</p>
        <ol className="mt-8 grid gap-3 sm:grid-cols-2">
          {STEPS.map((s, i) => (
            <li key={s.title} className="cz-surface p-5">
              <span className="cz-display cz-num text-sm text-[var(--cz-aqua)]">{String(i + 1).padStart(2, "0")}</span>
              <h2 className="cz-display mt-1 text-lg font-bold">{s.title}</h2>
              <p className="mt-1 text-sm text-[var(--cz-text-secondary)]">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8"><Link href="/hub" className="cz-btn cz-btn-primary">Enter Player Hub<ArrowRight size={16} /></Link></div>
      </section>
    </PublicShell>
  );
}
