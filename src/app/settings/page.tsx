import { GameShell } from "@/components/game-shell/GameShell";
import { PageHeader } from "@/components/ui/kit";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { playerService } from "@/services";

export default async function Page() {
  const player = await playerService.getMockCurrentPlayer();
  return (
    <GameShell player={player}>
      <PageHeader kicker="Preferences" title="Settings" subtitle="Profile, game and sound preferences" />
      <SettingsPanel />
    </GameShell>
  );
}
