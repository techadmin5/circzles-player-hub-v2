import Link from "next/link";
import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { SubmissionDetailClient } from "@/components/submissions/SubmissionDetailClient";
import { playerService, submissionService } from "@/services";
import { dataMode } from "@/config/dataMode";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = dataMode === "mock" ? await playerService.getMockCurrentPlayer() : undefined;
  const submission = dataMode === "mock" ? await submissionService.getSubmission(id) : undefined;
  return (
    <GameShell player={player}>
      <PageHeader kicker="Submission detail" title="Solve Submission" subtitle="Verified attempt record" />
      <SubmissionDetailClient id={id} initial={submission} />
      <Link href="/submissions" className="cz-btn cz-btn-ghost mt-4">Back to Submissions</Link>
    </GameShell>
  );
}
