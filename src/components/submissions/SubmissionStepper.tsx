"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight, Clock, Film, ListChecks, Send, Trophy, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { puzzleService, submissionService } from "@/services";
import { apiClient, uploadVideoDirectly } from "@/lib/apiClient";
import { dataMode } from "@/config/dataMode";
import { readVideoDuration, formatVideoDuration } from "@/lib/submissionVideo";
import { formatCatalogTime } from "@/lib/catalogTiming";
import type { SignedVideoUpload } from "@/types";
import { playSound } from "@/hooks/useSound";
import { cn } from "@/lib/utils";

interface PuzzleOption { id: string; playerPuzzleId?: string; name: string; levelId: number; maxLeaderboardTimeMs?: number | null }
interface Step { key: string; title: string; icon: ReactNode; body: string }
const STEPS: Step[] = [
  { key: "puzzle", title: "Select CircZles", icon: <Trophy size={16} />, body: "Choose which owned CircZles this verified attempt is for." },
  { key: "time", title: "Enter Time", icon: <Clock size={16} />, body: "Record your completion time exactly as solved. Times are verified on review." },
  { key: "video", title: "Select Video", icon: <Film size={16} />, body: "Record a continuous solving attempt, starting with unboxing and ending with the completed solution. Upload your own recording; no webcam recording is started." },
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
  const [selectedId, setSelectedId] = useState(() => {
    const requested = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("puzzleId");
    const initial = initialPuzzles.find(p => p.id === requested) ?? initialPuzzles[0];
    return initial?.playerPuzzleId ?? initial?.id ?? "";
  });
  const [time, setTime] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const uploadRef = useRef<{ signed: SignedVideoUpload; transferred: boolean } | null>(null);
  const operation = useRef(false);
  const fileSequence = useRef(0);
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
    if (initialPuzzles.length) return;
    puzzleService.getOwnedPuzzles().then((items) => {
      const options = items.map((p) => ({ id: p.id, playerPuzzleId: p.playerPuzzleId, name: p.name, levelId: p.levelId, maxLeaderboardTimeMs: p.maxLeaderboardTimeMs }));
      setPuzzles(options);
      const requested = new URLSearchParams(window.location.search).get("puzzleId");
      const initial = options.find(p => p.id === requested) ?? options[0];
      setSelectedId(initial?.playerPuzzleId ?? "");
      idempotencyKey.current = null;
    }).catch(() => setError("Owned CircZles could not be loaded. Sign in and try again."));
  }, [initialPuzzles]);

  function preflight() {
    if (dataMode === "api" && !selected?.maxLeaderboardTimeMs) throw new Error("Competition timing has not been configured for this CircZles. Please try again later.");
    const limit = selected?.maxLeaderboardTimeMs;
    const completion = parseCompletionTime(time);
    if (!completion) throw new Error("Enter a valid completion time.");
    if (limit && (completion > limit || (duration != null && duration > limit))) throw new Error(`This recording or completion time exceeds the ${formatCatalogTime(limit)} maximum for ${selected?.name}.`);
  }
  async function selectFile(nextFile: File | null) {
    const ticket = ++fileSequence.current;
    const previous = uploadRef.current;
    uploadRef.current = null; setVideoUploadId(""); setDuration(null); setFile(null); setError(""); idempotencyKey.current = null;
    if (previous) void apiClient.abandonVideoUpload(previous.signed.videoUploadId).catch(() => {});
    if (!nextFile) return;
    setBusy(true);
    try { const actual = await readVideoDuration(nextFile); if (ticket === fileSequence.current) { setDuration(actual); setFile(nextFile); } }
    catch (cause) { if (ticket === fileSequence.current) setError(cause instanceof Error ? cause.message : "Video could not be read."); }
    finally { if (ticket === fileSequence.current) setBusy(false); }
  }
  async function upload() {
    if (operation.current) return;
    if (!file) { setError("Select a video before uploading."); return; }
    operation.current = true; setBusy(true); setError(""); setProgress(0);
    try {
      preflight();
      if (!duration) throw new Error("Select a video with a verified local duration.");
      if (dataMode === "api") {
        if (!uploadRef.current) uploadRef.current = { signed: await apiClient.signVideoUpload({ filename: file.name, mimeType: file.type, sizeBytes: file.size }), transferred: false };
        const { signed } = uploadRef.current;
        if (!uploadRef.current.transferred) { await uploadVideoDirectly(signed, file, setProgress); uploadRef.current.transferred = true; }
        const verified = await apiClient.completeVideoUpload(signed.videoUploadId);
        if (verified.durationMs != null) setDuration(verified.durationMs);
        setVideoUploadId(signed.videoUploadId);
      } else { setProgress(100); setVideoUploadId("mock-video-upload"); }
      idempotencyKey.current = null;
      setStep(4); playSound("success");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Video upload failed. Try again."); playSound("error"); }
    finally { operation.current = false; setBusy(false); }
  }

  async function submit() {
    if (operation.current) return;
    const completionTimeMs = parseCompletionTime(time);
    if (!selectedId || !completionTimeMs || !videoUploadId) { setError("Select a CircZles, enter a valid time, and upload a video."); return; }
    operation.current = true; setBusy(true); setError("");
    idempotencyKey.current ??= crypto.randomUUID();
    try { preflight(); const created = await submissionService.createSubmission({ playerPuzzleId: selectedId, completionTimeMs, videoUploadId }, idempotencyKey.current); if (!created.id) throw new Error("Submission confirmation is unavailable. Retry safely or check Submissions."); setSubmitted(true); playSound("success"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Submission failed. Try again."); playSound("error"); }
    finally { operation.current = false; setBusy(false); }
  }

  function next() {
    setError("");
    if (dataMode === "api" && !selected?.maxLeaderboardTimeMs) return setError("Competition timing has not been configured for this CircZles. Please try again later.");
    if (step === 0 && !selectedId) return setError("Select an owned CircZles.");
    if (step === 1 && !parseCompletionTime(time)) return setError("Use MM:SS, MM:SS.mmm, HH:MM:SS, or HH:MM:SS.mmm.");
    if (step === 2 && !file) return setError("Select a video file.");
    if (step === 3) return void upload();
    setStep((current) => Math.min(STEPS.length - 1, current + 1));
  }

  if (submitted) return <div role="dialog" aria-modal="true" aria-labelledby="submission-received" className="cz-surface grid place-items-center gap-3 p-10 text-center" data-testid="submission-success"><span className="grid h-16 w-16 place-items-center rounded-full border border-[rgba(52,211,153,0.4)] bg-[rgba(52,211,153,0.12)] text-[var(--cz-emerald)]"><CheckCircle2 size={30} /></span><h2 id="submission-received" className="cz-display text-2xl font-bold">Submission Received!</h2><p className="max-w-sm text-sm text-[var(--cz-text-secondary)]">Your CircZles attempt has been submitted successfully. Our team aims to review it within 24 hours. You can track its status in Submissions.</p><Link href="/submissions" className="cz-btn cz-btn-primary" ref={node => node?.focus()}>View Submissions</Link><Link href="/puzzles" className="cz-btn">Back to My CircZles</Link></div>;

  return <div className="grid gap-5 lg:grid-cols-[280px_1fr]" data-testid="submission-stepper">
    <ol className="cz-surface grid gap-1 p-2">{STEPS.map((item, index) => <li key={item.key}><button disabled={busy} onClick={() => setStep(index)} data-testid={`step-${item.key}`} className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm", index === step ? "bg-[var(--cz-aqua-dim)]" : "text-[var(--cz-text-secondary)]")}><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[var(--cz-hairline-strong)]">{index < step ? <CheckCircle2 size={15} /> : index + 1}</span><span className="cz-display font-medium">{item.title}</span></button></li>)}</ol>
    <div className="cz-surface flex flex-col gap-4 p-5"><div className="flex items-center gap-2 text-[var(--cz-aqua)]">{active.icon}<span className="text-xs font-semibold uppercase tracking-wide">Step {step + 1} of {STEPS.length}</span></div><h2 className="cz-display text-2xl font-bold">{active.title}</h2><p className="text-sm text-[var(--cz-text-secondary)]">{active.body}</p>
      <p>{selected?.name} | Level {selected?.levelId} | Maximum eligible duration: {formatCatalogTime(selected?.maxLeaderboardTimeMs)}</p><p className="text-sm">MP4, MOV, WebM or M4V | Maximum 100 MB. {duration != null && `Actual recording duration: ${formatVideoDuration(duration)}`}</p>
      <div className="cz-inset grid gap-3 p-4">
        {active.key === "puzzle" && <div className="grid gap-2 sm:grid-cols-2">{puzzles.map((p) => <button key={p.playerPuzzleId ?? p.id} disabled={busy} onClick={() => { setSelectedId(p.playerPuzzleId ?? p.id); idempotencyKey.current = null; }} className={cn("rounded-xl border px-3 py-2.5 text-left text-sm", selectedId === (p.playerPuzzleId ?? p.id) ? "border-[rgba(61,234,212,0.4)] bg-[var(--cz-aqua-dim)]" : "border-[var(--cz-hairline)]")}><span className="cz-display block font-semibold">{p.name}</span><span className="text-xs text-[var(--cz-text-tertiary)]">Level {p.levelId}</span></button>)}</div>}
        {active.key === "time" && <input disabled={busy} aria-label="Completion time" value={time} onChange={(event) => { setTime(event.target.value); idempotencyKey.current = null; }} className="min-h-11 rounded-xl border border-[var(--cz-hairline-strong)] bg-black/20 px-3 text-lg outline-none" placeholder="MM:SS.mmm" />}
        {active.key === "video" && <label className="inline-flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--cz-hairline-strong)] text-sm text-[var(--cz-text-secondary)]"><Film size={22} />{file?.name ?? "Select solve video"}<input className="sr-only" disabled={busy} type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v" onChange={event => void selectFile(event.target.files?.[0] ?? null)} /></label>}
        {active.key === "upload" && <div><div className="cz-track"><div className="cz-track-fill" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-xs text-[var(--cz-text-tertiary)]">{busy ? `Uploading ${progress}%` : videoUploadId ? "Upload verified." : "Ready to upload and verify."}</p></div>}
        {active.key === "review" && <ul className="grid gap-1.5 text-sm text-[var(--cz-text-secondary)]"><li>CircZles: <span className="text-[var(--cz-text-primary)]">{selected?.name}</span></li><li>Completion time: <span className="cz-num text-[var(--cz-text-primary)]">{time}</span></li><li>Video: <span className="text-[var(--cz-text-primary)]">{file?.name}</span></li></ul>}
        {active.key === "submit" && <p className="text-sm text-[var(--cz-text-secondary)]">Ready to submit for verification.</p>}
      </div>{error && <p role="alert" className="text-sm text-[var(--cz-danger)]">{error}</p>}
      <div className="mt-auto flex justify-between gap-3"><button className="cz-btn cz-btn-ghost" disabled={step === 0 || busy} onClick={() => setStep(Math.max(0, step - 1))}>Back</button>{step < STEPS.length - 1 ? <button className="cz-btn cz-btn-primary" disabled={busy} data-testid="step-next" onClick={next}>{busy ? "Uploading..." : "Continue"}<ChevronRight size={16} /></button> : <button className="cz-btn cz-btn-gold" disabled={busy} data-testid="submit-attempt-final" onClick={submit}><Send size={16} />{busy ? "Submitting..." : "Submit Attempt"}</button>}</div>
    </div>
  </div>;
}
