import Link from "next/link";
import { Camera } from "lucide-react";
import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { SubmissionListClient } from "@/components/submissions/SubmissionListClient";
import { playerService, submissionService } from "@/services";

export default async function Page() {
  const [player, submissions] = await Promise.all([playerService.getMockCurrentPlayer(), submissionService.getSubmissions()]);
  return (
    <GameShell player={player}>
      <PageHeader kicker="Verification" title="Submissions" subtitle="Track every solve through review" actions={<Link href="/submissions/new" className="cz-btn cz-btn-primary"><Camera size={16} />New Submission</Link>} />
      <SubmissionListClient initial={submissions} />
    </GameShell>
  );
}
