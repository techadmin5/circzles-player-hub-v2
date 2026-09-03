import { AppShell, PageFrame, PuzzleStatusBadge } from "@/components/ui";
import { submissionService } from "@/services";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const submission = await submissionService.getSubmission(id);
  return <AppShell><PageFrame title={submission.puzzleName} eyebrow="Submission detail">
    <div className="game-card p-5">
      <PuzzleStatusBadge status={submission.status} />
      <p className="mt-4 text-[var(--text-secondary)]">levelId {submission.levelId} · completion time {submission.completionTime} · submitted recently</p>
      <div className="mt-5 grid aspect-video place-items-center rounded-md border border-white/10 bg-black/30 text-[var(--text-muted)]">Video Placeholder</div>
      {submission.reviewNote && <p className="mt-4 text-amber-100">{submission.reviewNote}</p>}
    </div>
  </PageFrame></AppShell>;
}
