"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight, Clock, Film, ListChecks, Send, Trophy, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { puzzleService, submissionService } from "@/services";
import { apiClient, uploadVideoDirectly } from "@/lib/apiClient";
import { dataMode } from "@/config/dataMode";
import { playSound } from "@/hooks/useSound";
import { cn } from "@/lib/utils";

interface PuzzleOption { id: string; playerPuzzleId?: string; name: string; levelId: number }
interface Step { key: string; title: string; icon: ReactNode; body: string }
const STEPS: Step[] = [
  { key: "puzzle", title: "Select CircZles", icon: <Trophy size={16} />, body: "Choose which owned CircZles this verified attempt is for." },
  { key: "time", title: "Enter Time", icon: <Clock size={16} />, body: "Record your completion time exactly as solved. Times are verified on review." },
  { key: "video", title: "Select Video", icon: <Film size={16} />, body: "Attach a clear solve video showing the final completed state." },
  { key: "upload", title: "Upload", icon: <Upload size={16} />, body: "Securely upload your video for backend verification." },
  { key: "review", title: "Review", icon: <ListChecks size={16} />, body: "Confirm the CircZles, time and video before submitting for verification." },
  { key: "submit", title: "Submit", icon: <Send size={16} />, body: "Submit your attempt. It enters Pending Review until a reviewer verifies it." },
];

export function parseCompletionTime(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (!/^\d{1,2}(\.\d{1,3})?$/.test(parts.at(-1)!)) return null;
  if (!/^\d+$/.test(parts.at(-2)!) || (parts.length === 3 && !/^\d+$/.test(parts[0]))) return null;
  const seconds = Number(parts.at(-1));
  const minutes = Number(parts.at(-2));
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (seconds >= 60 || (parts.length === 3 && minutes >= 60)) return null;
  const milliseconds = Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 && milliseconds <= 2_147_483_647 ? milliseconds : null;
}

export function SubmissionStepper({ puzzles: initialPuzzles }: { puzzles: PuzzleOption[] }) {
  const [puzzles, setPuzzles] = useState(initialPuzzles);
  const [step, setStep] = useState(0);
  const [selectedId, setSelectedId] = useState(initialPuzzles[0]?.playerPuzzleId ?? initialPuzzles[0]?.id ?? "");
  const [time, setTime] = useState("02:41");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [videoUploadId, setVideoUploadId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const idempotencyKey = useRef<string | null>(null);
  const active = STEPS[step];
  const selected = puzzles.find((p) => (p.playerPuzzleId ?? p.id) === selectedId);

  useEffect(() => {
    if (dataMode !== "api") return;
    puzzleService.getOwnedPuzzles().then((items) => {
      const options = items.map((p) => ({ id: p.id, playerPuzzleId: p.playerPuzzleId, name: p.name, levelId: p.levelId }));
      setPuzzles(options);
      setSelectedId(options[0]?.playerPuzzleId ?? "");
      idempotencyKey.current = null;
    }).catch(() => setError("Owned CircZles could not be loaded. Sign in and try again."));
  }, []);

  async function upload() {
    if (!file) { setError("Select a video before uploading."); return; }
    setBusy(true); setError(""); setProgress(0);
    try {
      if (dataMode === "api") {
        const signed = await apiClient.signVideoUpload({ filename: file.name, mimeType: file.type, sizeBytes: file.size });
        await uploadVideoDirectly(signed, file, setProgress);
        await apiClient.completeVideoUpload(signed.videoUploadId);
        setVideoUploadId(signed.videoUploadId);
      } else { setProgress(100); setVideoUploadId("mock-video-upload"); }
      idempotencyKey.current = null;
      setStep(4); playSound("success");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Video upload failed. Try again."); playSound("error"); }
    finally { setBusy(false); }
  }

  async function submit() {
    const completionTimeMs = parseCompletionTime(time);
    if (!selectedId || !completionTimeMs || !videoUploadId) { setError("Select a CircZles, enter a valid time, and upload a video."); return; }
    setBusy(true); setError("");
    idempotencyKey.current ??= crypto.randomUUID();
    try { await submissionService.createSubmission({ playerPuzzleId: selectedId, completionTimeMs, videoUploadId }, idempotencyKey.current); setSubmitted(true); playSound("success"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Submission failed. Try again."); playSound("error"); }
    finally { setBusy(false); }
  }

  function next() {
    setError("");
    if (step === 0 && !selectedId) return setError("Select an owned CircZles.");
    if (step === 1 && !parseCompletionTime(time)) return setError("Use MM:SS, MM:SS.mmm, HH:MM:SS, or HH:MM:SS.mmm.");
    if (step === 2 && !file) return setError("Select a video file.");
    if (step === 3) return void upload();
    setStep((current) => Math.min(STEPS.length - 1, current + 1));
  }

  if (submitted) return <div className="cz-surface grid place-items-center gap-3 p-10 text-center" data-testid="submission-success"><span className="grid h-16 w-16 place-items-center rounded-full border border-[rgba(52,211,153,0.4)] bg-[rgba(52,211,153,0.12)] text-[var(--cz-emerald)]"><CheckCircle2 size={30} /></span><h2 className="cz-display text-2xl font-bold">Attempt Submitted</h2><p className="max-w-sm text-sm text-[var(--cz-text-secondary)]">Your solve is now Pending Review.</p><Link href="/submissions" className="cz-btn cz-btn-primary">View Submissions</Link></div>;

  return <div className="grid gap-5 lg:grid-cols-[280px_1fr]" data-testid="submission-stepper">
    <ol className="cz-surface grid gap-1 p-2">{STEPS.map((item, index) => <li key={item.key}><button disabled={busy} onClick={() => setStep(index)} data-testid={`step-${item.key}`} className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm", index === step ? "bg-[var(--cz-aqua-dim)]" : "text-[var(--cz-text-secondary)]")}><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[var(--cz-hairline-strong)]">{index < step ? <CheckCircle2 size={15} /> : index + 1}</span><span className="cz-display font-medium">{item.title}</span></button></li>)}</ol>
    <div className="cz-surface flex flex-col gap-4 p-5"><div className="flex items-center gap-2 text-[var(--cz-aqua)]">{active.icon}<span className="text-xs font-semibold uppercase tracking-wide">Step {step + 1} of {STEPS.length}</span></div><h2 className="cz-display text-2xl font-bold">{active.title}</h2><p className="text-sm text-[var(--cz-text-secondary)]">{active.body}</p>
      <div className="cz-inset grid gap-3 p-4">
        {active.key === "puzzle" && <div className="grid gap-2 sm:grid-cols-2">{puzzles.map((p) => <button key={p.playerPuzzleId ?? p.id} onClick={() => { setSelectedId(p.playerPuzzleId ?? p.id); idempotencyKey.current = null; }} className={cn("rounded-xl border px-3 py-2.5 text-left text-sm", selectedId === (p.playerPuzzleId ?? p.id) ? "border-[rgba(61,234,212,0.4)] bg-[var(--cz-aqua-dim)]" : "border-[var(--cz-hairline)]")}><span className="cz-display block font-semibold">{p.name}</span><span className="text-xs text-[var(--cz-text-tertiary)]">levelId {p.levelId}</span></button>)}</div>}
        {active.key === "time" && <input aria-label="Completion time" value={time} onChange={(event) => { setTime(event.target.value); idempotencyKey.current = null; }} className="min-h-11 rounded-xl border border-[var(--cz-hairline-strong)] bg-black/20 px-3 text-lg outline-none" placeholder="MM:SS.mmm" />}
        {active.key === "video" && <label className="inline-flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--cz-hairline-strong)] text-sm text-[var(--cz-text-secondary)]"><Film size={22} />{file?.name ?? "Select solve video"}<input className="sr-only" type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setVideoUploadId(""); idempotencyKey.current = null; }} /></label>}
        {active.key === "upload" && <div><div className="cz-track"><div className="cz-track-fill" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-xs text-[var(--cz-text-tertiary)]">{busy ? `Uploading ${progress}%` : videoUploadId ? "Upload verified." : "Ready to upload and verify."}</p></div>}
        {active.key === "review" && <ul className="grid gap-1.5 text-sm text-[var(--cz-text-secondary)]"><li>CircZles: <span className="text-[var(--cz-text-primary)]">{selected?.name}</span></li><li>Completion time: <span className="cz-num text-[var(--cz-text-primary)]">{time}</span></li><li>Video: <span className="text-[var(--cz-text-primary)]">{file?.name}</span></li></ul>}
        {active.key === "submit" && <p className="text-sm text-[var(--cz-text-secondary)]">Ready to submit for verification.</p>}
      </div>{error && <p role="alert" className="text-sm text-[var(--cz-danger)]">{error}</p>}
      <div className="mt-auto flex justify-between gap-3"><button className="cz-btn cz-btn-ghost" disabled={step === 0 || busy} onClick={() => setStep(Math.max(0, step - 1))}>Back</button>{step < STEPS.length - 1 ? <button className="cz-btn cz-btn-primary" disabled={busy} data-testid="step-next" onClick={next}>{busy ? "Uploading..." : "Continue"}<ChevronRight size={16} /></button> : <button className="cz-btn cz-btn-gold" disabled={busy} data-testid="submit-attempt-final" onClick={submit}><Send size={16} />{busy ? "Submitting..." : "Submit Attempt"}</button>}</div>
    </div>
  </div>;
}
