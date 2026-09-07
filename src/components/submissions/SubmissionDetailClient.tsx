"use client";
import { useEffect, useState } from "react";
import { Clock, Film, Gauge } from "lucide-react";
import type { Submission } from "@/types";
import { submissionService } from "@/services";
import { dataMode } from "@/config/dataMode";
import { Stat } from "@/components/ui/kit";
import { SubmissionStatusPill } from "./cards";

export function SubmissionDetailClient({ id, initial }: { id: string; initial: Submission }) {
  const [submission, setSubmission] = useState(initial);
  const [error, setError] = useState("");
  useEffect(() => { if (dataMode === "api") submissionService.getSubmission(id).then(setSubmission).catch(() => setError("Submission could not be loaded.")); }, [id]);
  if (error) return <p role="alert" className="cz-surface p-4 text-sm text-[var(--cz-danger)]">{error}</p>;
  return <div className="grid gap-5 lg:grid-cols-[1fr_0.7fr]"><div className="cz-surface grid place-items-center gap-2 p-5"><div className="grid aspect-video w-full place-items-center rounded-xl border border-[var(--cz-hairline)] bg-[var(--cz-inset)] text-[var(--cz-text-tertiary)]"><span className="grid justify-items-center gap-2"><Film size={30} /><span className="text-sm">Solve video secured for review</span></span></div></div><div className="grid content-start gap-3"><SubmissionStatusPill status={submission.status} /><Stat label="Difficulty levelId" value={String(submission.levelId)} icon={<Gauge size={12} />} tone="aqua" /><Stat label="Completion time" value={submission.completionTime} icon={<Clock size={12} />} /></div></div>;
}
