import Image from "next/image";
import type { AdminMissionDto } from "@/types/adminMissions";
import { totals, type MissionCollectible, type MissionTrackingDto } from "./missionManagerModel";
export function MissionRewardPreview({ mission, tracking, catalog }: { mission: AdminMissionDto; tracking?: MissionTrackingDto | null; catalog: MissionCollectible[] }) {
  const reward = totals(mission), collectible = catalog.find(c => c.rewardDefinitionId === tracking?.collectibleId);
  return <div className="mm-rewards"><span className="mm-xp">{reward.configured ? reward.xp + " XP" : "XP not configured"}</span><span className="mm-sp">{reward.configured ? reward.sp + " Synapse Points" : "SP not configured"}</span>
    {collectible ? <span className="mm-collectible">{collectible.imageUrl && /^\/(?!\/)/.test(collectible.imageUrl) && <Image unoptimized src={collectible.imageUrl} alt="" width={38} height={38} />}{collectible.name} - {collectible.rewardType === "FRAME" ? "Profile frame" : "Badge"}{!collectible.active && " (unavailable)"}</span> : tracking?.collectibleId ? <span>Collectible linked - catalog details unavailable</span> : <span className="mm-muted">No collectible reward</span>}
  </div>;
}
