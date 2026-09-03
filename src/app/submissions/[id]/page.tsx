import Link from "next/link";
import { Clock, Film, Gauge } from "lucide-react";
import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader, Stat } from "@/components/ui/kit";
import { SubmissionStatusPill } from "@/components/submissions/cards";
import { playerService, submissionService } from "@/services";
import { formatDate } from "@/lib/format";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [player, submission] = await Promise.all([playerService.getMockCurrentPlayer(), submissionService.getSubmission(id)]);
  return (
    <GameShell player={player}>
      <PageHeader kicker="Submission detail" title={submission.puzzleName} subtitle={`Submitted ${formatDate(submission.createdAt)}`} actions={<SubmissionStatusPill status={submission.status} />} />
      <div className="grid gap-5 lg:grid-cols-[1fr_0.7fr]">
        <div className="cz-surface grid place-items-center gap-2 p-5">
          <div className="grid aspect-video w-full place-items-center rounded-xl border border-[var(--cz-hairline)] bg-[var(--cz-inset)] text-[var(--cz-text-tertiary)]">
            <span className="grid gap-2 justify-items-center"><Film size={30} /><span className="text-sm">Solve video</span></span>
          </div>
          <p className="text-xs text-[var(--cz-text-tertiary)]">Media playback connects to backend storage in a later phase.</p>
        </div>
        <div className="grid content-start gap-3">
          <Stat label="Difficulty levelId" value={String(submission.levelId)} icon={<Gauge size={12} />} tone="aqua" />
          <Stat label="Completion time" value={submission.completionTime} icon={<Clock size={12} />} />
          {submission.reviewNote && <div className="cz-surface border-[rgba(232,180,80,0.28)] p-4"><p className="text-[0.62rem] uppercase tracking-wide text-[var(--cz-gold)]">Reviewer note</p><p className="mt-1 text-sm text-[var(--cz-text-secondary)]">{submission.reviewNote}</p></div>}
          <Link href="/submissions" className="cz-btn cz-btn-ghost">Back to Submissions</Link>
        </div>
      </div>
    </GameShell>
  );
}
