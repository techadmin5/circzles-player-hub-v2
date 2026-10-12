"use client";
import { useEffect, useState } from "react";
import { Clock, Film, Gauge } from "lucide-react";
import type { Submission } from "@/types";
import { submissionService } from "@/services";
import { dataMode } from "@/config/dataMode";
import { Stat } from "@/components/ui/kit";
import { SubmissionStatusPill } from "./cards";

export function SubmissionDetailClient({ id, initial }: { id: string; initial?: Submission }) {
  const [submission, setSubmission] = useState<Submission | undefined>(initial);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => { let live = true; if (dataMode === "api") submissionService.getSubmission(id).then(result => { if (live) { setSubmission(result); setError(""); } }).catch(() => { if (live) setError("Submission could not be loaded."); }); return () => { live = false; }; }, [id, revision]);
  const refresh = <button className="cz-btn" onClick={() => setRevision(r => r + 1)}>Refresh status</button>;
  if (error) return <div>{refresh}<p role="alert" className="cz-surface p-4 text-sm text-[var(--cz-danger)]">{error}</p></div>;
  if (!submission) return <div className="cz-raised h-52 animate-pulse" aria-busy="true" aria-label="Loading submission" />;
  return <div>{refresh}<h2 className="cz-display text-xl">{submission.puzzleName}</h2><p>Submitted {new Date(submission.createdAt).toLocaleString()}</p>{submission.reviewNote && <p>Review note: {submission.reviewNote}</p>}<div className="grid gap-5 lg:grid-cols-[1fr_0.7fr]"><div className="cz-surface grid place-items-center gap-2 p-5"><div className="grid aspect-video w-full place-items-center rounded-xl border border-[var(--cz-hairline)] bg-[var(--cz-inset)] text-[var(--cz-text-tertiary)]"><span className="grid justify-items-center gap-2"><Film size={30} /><span className="text-sm">Solve video secured for review</span></span></div></div><div className="grid content-start gap-3"><SubmissionStatusPill status={submission.status} /><Stat label="Level" value={String(submission.levelId)} icon={<Gauge size={12} />} tone="aqua" /><Stat label="Completion time" value={submission.completionTime} icon={<Clock size={12} />} /></div></div></div>;
}
