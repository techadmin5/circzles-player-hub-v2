import Link from "next/link";
import { Clock } from "lucide-react";
import type { Submission, SubmissionStatus } from "@/types";
import { Chip } from "@/components/ui/kit";
import { formatDate } from "@/lib/format";

const META: Record<SubmissionStatus, { label: string; tone: "default" | "aqua" | "gold" | "emerald" | "danger" | "violet" }> = {
  DRAFT: { label: "Draft", tone: "default" },
  UPLOADING: { label: "Uploading", tone: "aqua" },
  PENDING_REVIEW: { label: "Pending Review", tone: "gold" },
  APPROVED: { label: "Approved", tone: "emerald" },
  REJECTED: { label: "Rejected", tone: "danger" },
  RESUBMISSION_REQUIRED: { label: "Resubmission Required", tone: "violet" },
};

export function SubmissionStatusPill({ status }: { status: SubmissionStatus }) {
  const meta = META[status] ?? { label: status, tone: "default" as const };
  return <Chip tone={meta.tone}>{meta.label}</Chip>;
}

export function SubmissionCard({ submission }: { submission: Submission }) {
  return (
    <Link href={`/submissions/${submission.id}`} data-testid={`submission-card-${submission.id}`} className="cz-raised block p-4 transition-transform hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="cz-display text-base font-bold">{submission.puzzleName}</h3>
          <p className="text-xs text-[var(--cz-text-tertiary)]">puzzleId {submission.puzzleId} · difficulty levelId {submission.levelId}</p>
        </div>
        <SubmissionStatusPill status={submission.status} />
      </div>
      <div className="mt-3 flex items-center gap-4 text-sm text-[var(--cz-text-secondary)]">
        <span className="cz-num inline-flex items-center gap-1.5"><Clock size={14} />{submission.completionTime}</span>
        <span className="text-xs text-[var(--cz-text-tertiary)]">{formatDate(submission.createdAt)}</span>
      </div>
      {submission.reviewNote && <p className="mt-2 rounded-lg border border-[rgba(232,180,80,0.25)] bg-[var(--cz-gold-dim)] px-3 py-2 text-xs text-[var(--cz-gold)]">{submission.reviewNote}</p>}
    </Link>
  );
}
