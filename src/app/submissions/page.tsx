import Link from "next/link";
import { Camera } from "lucide-react";
import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader, EmptyState } from "@/components/ui/kit";
import { SubmissionCard } from "@/components/submissions/cards";
import { playerService, submissionService } from "@/services";

export default async function Page() {
  const [player, submissions] = await Promise.all([playerService.getMockCurrentPlayer(), submissionService.getSubmissions()]);
  return (
    <GameShell player={player}>
      <PageHeader kicker="Verification" title="Submissions" subtitle="Track every solve through review" actions={<Link href="/submissions/new" className="cz-btn cz-btn-primary"><Camera size={16} />New Submission</Link>} />
      {submissions.length > 0
        ? <div className="grid gap-3 md:grid-cols-2">{submissions.map((s) => <SubmissionCard key={s.id} submission={s} />)}</div>
        : <EmptyState icon={<Camera size={22} />} title="No submissions yet" body="Solve a puzzle and submit your attempt to start climbing the leaderboards." action={<Link href="/submissions/new" className="cz-btn cz-btn-primary">Submit Attempt</Link>} />}
    </GameShell>
  );
}
