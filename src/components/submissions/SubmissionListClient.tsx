"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Camera } from "lucide-react";
import type { Submission } from "@/types";
import { submissionService } from "@/services";
import { dataMode } from "@/config/dataMode";
import { EmptyState } from "@/components/ui/kit";
import { SubmissionCard } from "./cards";

export function SubmissionListClient({ initial }: { initial: Submission[] }) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState("");
  useEffect(() => { if (dataMode === "api") submissionService.getSubmissions().then(setItems).catch(() => setError("Submissions could not be loaded.")); }, []);
  if (error) return <p role="alert" className="cz-surface p-4 text-sm text-[var(--cz-danger)]">{error}</p>;
  return items.length ? <div className="grid gap-3 md:grid-cols-2">{items.map((item) => <SubmissionCard key={item.id} submission={item} />)}</div> : <EmptyState icon={<Camera size={22} />} title="No submissions yet" body="Solve a puzzle and submit your attempt to start climbing the leaderboards." action={<Link href="/submissions/new" className="cz-btn cz-btn-primary">Submit Attempt</Link>} />;
}
