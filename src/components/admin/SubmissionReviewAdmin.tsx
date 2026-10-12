"use client";
import { useEffect, useRef, useState } from "react";
import { request } from "@/lib/apiClient";
import { formatVideoDuration } from "@/lib/submissionVideo";
import { formatCatalogTime } from "@/lib/catalogTiming";
import type { AdminSubmissionDto } from "@/types/adminSubmissions";
export function SubmissionReviewAdmin() {
  const [status, setStatus] = useState("PENDING_REVIEW"), [rows, setRows] = useState<AdminSubmissionDto[]>([]);
  const [detail, setDetail] = useState<AdminSubmissionDto | null>(null), [video, setVideo] = useState(""), [note, setNote] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  const operation = useRef(false), retry = useRef<{ payload: string; key: string } | null>(null);
  useEffect(() => { const controller = new AbortController(); request<AdminSubmissionDto[]>(`/api/admin/submissions?status=${status}&limit=100`, { signal: controller.signal }).then(setRows).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [status, revision]);
  async function run(action: () => Promise<void>) { if (operation.current) return; operation.current = true; setBusy(true); setError(""); setNotice(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Review request failed. Retry safely."); } finally { operation.current = false; setBusy(false); } }
  async function review(decision: string) {
    await run(async () => {
      const payload = JSON.stringify({ decision, reviewNote: note });
      if (retry.current?.payload !== payload) retry.current = { payload, key: crypto.randomUUID() };
      await request(`/api/admin/submissions/${detail!.submissionId}/review`, { method: "POST", headers: { "Idempotency-Key": retry.current.key }, body: payload });
      setDetail(await request<AdminSubmissionDto>(`/api/admin/submissions/${detail!.submissionId}`)); setRevision(r => r + 1); setNotice("Review recorded successfully.");
    });
  }
  return <main className="mx-auto max-w-7xl space-y-4 p-6"><h1 className="cz-display text-3xl">Submission Review</h1><label>Status<select disabled={busy} value={status} onChange={e => { setStatus(e.target.value); setLoading(true); setError(""); }} className="cz-inset ml-3 p-2">{["PENDING_REVIEW", "APPROVED", "REJECTED", "RESUBMISSION_REQUIRED"].map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select></label><button className="cz-btn" disabled={busy} onClick={() => { setError(""); setLoading(true); setRevision(r => r + 1); }}>Refresh</button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{loading ? <p role="status">Loading submissions...</p> : !rows.length ? <p>No submissions match this status.</p> : rows.map(row => <article className="cz-surface p-4" key={row.submissionId}><h2>{row.puzzleName} | {row.player.displayName} ({row.player.publicPlayerId})</h2><p>{new Date(row.submittedAt).toLocaleString()} | Completion {formatCatalogTime(row.completionTimeMs)}</p><button className="cz-btn" disabled={busy} onClick={() => void run(async () => { setVideo(""); setNote(""); retry.current = null; setDetail(await request<AdminSubmissionDto>(`/api/admin/submissions/${row.submissionId}`)); })}>Review attempt</button></article>)}
    {detail && <section className="cz-surface space-y-3 p-5"><h2 className="cz-display text-xl">{detail.puzzleName} | {detail.player.displayName}</h2><p>Player {detail.player.publicPlayerId} | Level {detail.levelId} | {detail.status.replaceAll("_", " ")}</p><p>Submitted {new Date(detail.submittedAt).toLocaleString()} | Completion {formatVideoDuration(detail.completionTimeMs)} | Verified recording {formatVideoDuration(detail.video.durationMs)} | Maximum {formatCatalogTime(detail.maxLeaderboardTimeMs)} | File {detail.video.verifiedSizeBytes == null ? "Unverified" : (detail.video.verifiedSizeBytes / 1048576).toFixed(2) + " MiB"}</p>
      <button className="cz-btn" disabled={busy} onClick={() => void run(async () => { const result = await request<{ url: string }>(`/api/admin/submissions/${detail.submissionId}/video`); setVideo(result.url); })}>Open protected video (5 minutes)</button>{video && <><video className="w-full" src={video} controls preload="metadata" onError={() => setError("Video access expired or playback failed. Open protected video again.")} /><a href={video} target="_blank" rel="noreferrer" className="underline">Open recording in a new tab</a></>}
      <p>Check continuous recording from unboxing, correct solution, evidence quality and time discrepancies. Request resubmission or reject invalid evidence.</p><label>Review note<textarea className="cz-inset block w-full p-3" maxLength={2000} disabled={busy || detail.status !== "PENDING_REVIEW"} value={note} onChange={e => setNote(e.target.value)} /></label><div className="flex gap-3">{[["APPROVED", "Approve"], ["REJECTED", "Reject"], ["RESUBMISSION_REQUIRED", "Request Resubmission"]].map(([decision, label]) => <button className="cz-btn" key={decision} disabled={busy || detail.status !== "PENDING_REVIEW"} onClick={() => void review(decision)}>{label}</button>)}</div>
      <h3>Review history</h3>{detail.reviewHistory?.length ? detail.reviewHistory.map((r, i) => <p key={i}>{r.decision} | Reviewer {r.reviewerName ?? r.reviewerAdminUserId} | {new Date(r.createdAt).toLocaleString()} | {r.reviewNote || "No note"}</p>) : <p>No review recorded yet.</p>}
    </section>}
  </main>;
}
