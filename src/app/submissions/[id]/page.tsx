import Link from "next/link";
import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { SubmissionDetailClient } from "@/components/submissions/SubmissionDetailClient";
import { playerService, submissionService } from "@/services";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [player, submission] = await Promise.all([playerService.getMockCurrentPlayer(), submissionService.getSubmission(id)]);
  return (
    <GameShell player={player}>
      <PageHeader kicker="Submission detail" title="Solve Submission" subtitle="Verified attempt record" />
      <SubmissionDetailClient id={id} initial={submission} />
      <Link href="/submissions" className="cz-btn cz-btn-ghost mt-4">Back to Submissions</Link>
    </GameShell>
  );
}
