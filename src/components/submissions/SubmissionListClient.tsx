"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Camera } from "lucide-react";
import type { Submission } from "@/types";
import { submissionService } from "@/services";
import { dataMode } from "@/config/dataMode";
import { EmptyState, LoadingState } from "@/components/ui/kit";
import { SubmissionCard } from "./cards";

export function SubmissionListClient({ initial }: { initial: Submission[] }) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(dataMode === "api"), [revision, setRevision] = useState(0);
  useEffect(() => { let live = true; if (dataMode !== "api") return; submissionService.getSubmissions().then(result => { if (live) { setItems(result); setError(""); } }).catch(() => { if (live) setError("Submissions could not be loaded."); }).finally(() => { if (live) setLoading(false); }); return () => { live = false; }; }, [revision]);
  const refresh = <button className="cz-btn mb-4" onClick={() => { setLoading(true); setRevision(r => r + 1); }}>Refresh Submissions</button>;
  if (loading) return <LoadingState rows={4} />;
  if (error) return <div>{refresh}<p role="alert" className="cz-surface p-4 text-sm text-[var(--cz-danger)]">{error}</p></div>;
  return <div>{refresh}{items.length ? <div className="grid gap-3 md:grid-cols-2">{items.map((item) => <SubmissionCard key={item.id} submission={item} />)}</div> : <EmptyState icon={<Camera size={22} />} title="No submissions yet" body="Solve a CircZles and submit your attempt to start climbing the leaderboards." action={<Link href="/submissions/new" className="cz-btn cz-btn-primary">Submit Attempt</Link>} />}</div>;
}
