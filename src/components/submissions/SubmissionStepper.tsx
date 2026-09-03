"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Camera, CheckCircle2, ChevronRight, Clock, Film, ListChecks, Send, Trophy, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { submissionService } from "@/services";
import { playSound } from "@/hooks/useSound";
import { cn } from "@/lib/utils";

interface Step { key: string; title: string; icon: ReactNode; body: string }

const STEPS: Step[] = [
  { key: "puzzle", title: "Select Puzzle", icon: <Trophy size={16} />, body: "Choose which owned CircZles puzzle this verified attempt is for." },
  { key: "time", title: "Enter Time", icon: <Clock size={16} />, body: "Record your completion time exactly as solved. Times are verified on review." },
  { key: "video", title: "Record / Select Video", icon: <Film size={16} />, body: "Attach a clear solve video showing the final completed state." },
  { key: "upload", title: "Upload", icon: <Upload size={16} />, body: "Upload stage. Real media upload connects to backend storage in a later phase." },
  { key: "review", title: "Review", icon: <ListChecks size={16} />, body: "Confirm the puzzle, time and video before submitting for verification." },
  { key: "submit", title: "Submit", icon: <Send size={16} />, body: "Submit your attempt. It enters Pending Review until a reviewer verifies it." },
];

export function SubmissionStepper({ puzzles }: { puzzles: { id: string; name: string; levelId: number }[] }) {
  const [step, setStep] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const active = STEPS[step];

  async function submit() {
    playSound("button");
    await submissionService.createSubmission({ puzzleId: puzzles[0]?.id ?? "puzzle-1", completionTime: "02:41" });
    setSubmitted(true);
    playSound("success");
  }

  if (submitted) {
    return (
      <div className="cz-surface grid place-items-center gap-3 p-10 text-center" data-testid="submission-success">
        <span className="grid h-16 w-16 place-items-center rounded-full border border-[rgba(52,211,153,0.4)] bg-[rgba(52,211,153,0.12)] text-[var(--cz-emerald)]"><CheckCircle2 size={30} /></span>
        <h2 className="cz-display text-2xl font-bold">Attempt Submitted</h2>
        <p className="max-w-sm text-sm text-[var(--cz-text-secondary)]">Your solve is now Pending Review. You will be notified once a reviewer verifies it.</p>
        <Link href="/submissions" className="cz-btn cz-btn-primary mt-1">View Submissions</Link>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_1fr]" data-testid="submission-stepper">
      <ol className="cz-surface grid gap-1 p-2">
        {STEPS.map((s, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <li key={s.key}>
              <button onClick={() => { playSound("tab"); setStep(i); }} data-testid={`step-${s.key}`}
                className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors", current ? "bg-[var(--cz-aqua-dim)] text-[var(--cz-text-primary)]" : "text-[var(--cz-text-secondary)] hover:bg-white/[0.03]")}>
                <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-bold", done ? "border-[var(--cz-emerald)] text-[var(--cz-emerald)]" : current ? "border-[var(--cz-aqua)] text-[var(--cz-aqua)]" : "border-[var(--cz-hairline-strong)] text-[var(--cz-text-tertiary)]")}>
                  {done ? <CheckCircle2 size={15} /> : i + 1}
                </span>
                <span className="cz-display font-medium">{s.title}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <motion.div key={active.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="cz-surface flex flex-col gap-4 p-5">
        <div className="flex items-center gap-2 text-[var(--cz-aqua)]">{active.icon}<span className="text-xs font-semibold uppercase tracking-wide">Step {step + 1} of {STEPS.length}</span></div>
        <h2 className="cz-display text-2xl font-bold">{active.title}</h2>
        <p className="text-sm text-[var(--cz-text-secondary)]">{active.body}</p>

        <div className="cz-inset grid gap-3 p-4">
          {active.key === "puzzle" && (
            <div className="grid gap-2 sm:grid-cols-2">
              {puzzles.slice(0, 4).map((p, i) => (
                <button key={p.id} className={cn("rounded-xl border px-3 py-2.5 text-left text-sm", i === 0 ? "border-[rgba(61,234,212,0.4)] bg-[var(--cz-aqua-dim)]" : "border-[var(--cz-hairline)] bg-white/[0.02]")}>
                  <span className="cz-display block font-semibold">{p.name}</span>
                  <span className="text-xs text-[var(--cz-text-tertiary)]">levelId {p.levelId}</span>
                </button>
              ))}
            </div>
          )}
          {active.key === "time" && <input aria-label="Completion time" defaultValue="02:41" className="min-h-11 rounded-xl border border-[var(--cz-hairline-strong)] bg-black/20 px-3 text-lg outline-none focus:border-[var(--cz-aqua)]" placeholder="MM:SS" />}
          {active.key === "video" && <button className="inline-flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--cz-hairline-strong)] bg-black/20 text-sm text-[var(--cz-text-secondary)]"><Camera size={22} />Record or select solve video</button>}
          {active.key === "upload" && <div><div className="cz-track"><div className="cz-track-fill" style={{ width: "62%" }} /></div><p className="mt-2 text-xs text-[var(--cz-text-tertiary)]">Mock upload preview. Real upload pipeline connects later — this UI stays unchanged.</p></div>}
          {active.key === "review" && <ul className="grid gap-1.5 text-sm text-[var(--cz-text-secondary)]"><li>Puzzle: <span className="text-[var(--cz-text-primary)]">{puzzles[0]?.name ?? "—"}</span></li><li>Completion time: <span className="cz-num text-[var(--cz-text-primary)]">02:41</span></li><li>Video: <span className="text-[var(--cz-text-primary)]">Attached</span></li></ul>}
          {active.key === "submit" && <p className="text-sm text-[var(--cz-text-secondary)]">Ready to submit for verification.</p>}
        </div>

        <div className="mt-auto flex items-center justify-between gap-3">
          <button className="cz-btn cz-btn-ghost" disabled={step === 0} onClick={() => { playSound("button"); setStep(Math.max(0, step - 1)); }}>Back</button>
          {step < STEPS.length - 1
            ? <button className="cz-btn cz-btn-primary" data-testid="step-next" onClick={() => { playSound("button"); setStep(step + 1); }}>Continue<ChevronRight size={16} /></button>
            : <button className="cz-btn cz-btn-gold" data-testid="submit-attempt-final" onClick={submit}><Send size={16} />Submit Attempt</button>}
        </div>
      </motion.div>
    </div>
  );
}
