import { MessagesSquare } from "lucide-react";
import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader, EmptyState } from "@/components/ui/kit";
import { playerService } from "@/services";

export default async function Page() {
  const player = await playerService.getMockCurrentPlayer();
  return (
    <GameShell player={player}>
      <PageHeader kicker="Community" title="Chat" subtitle="Player messaging" />
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="cz-surface p-4 opacity-60"><p className="cz-display text-sm font-bold">Conversations</p><p className="mt-1 text-xs text-[var(--cz-text-tertiary)]">Unread badges · online state</p></div>
        <EmptyState icon={<MessagesSquare size={22} />} title="Chat is coming soon" body="Realtime messaging is feature-flagged off until the realtime backend is built." />
      </div>
    </GameShell>
  );
}
