export type SoundEvent =
  | "navigation" | "button" | "tab" | "modalOpen" | "modalClose"
  | "success" | "error" | "coin" | "xp" | "missionComplete"
  | "missionClaim" | "wheelStart" | "wheelTick" | "rewardReveal"
  | "purchase" | "badgeUnlock" | "itemUnlock" | "rankUp" | "rankBuild" | "rankImpact" | "rankReveal" | "rewardCollect"
  | "friendRequest" | "notification";

export type SoundCategory = "effect" | "notification";

export interface SoundAsset {
  path?: string;
  category: SoundCategory;
}

/** Add a path only after its file exists in public; undefined entries make no request. */
export const soundAssets: Record<SoundEvent, SoundAsset> = {
  navigation: { category: "effect" }, button: { category: "effect" }, tab: { category: "effect" },
  modalOpen: { category: "effect" }, modalClose: { category: "effect" }, success: { category: "effect" },
  error: { category: "effect" }, coin: { category: "effect" }, xp: { category: "effect" },
  missionComplete: { category: "effect" }, missionClaim: { category: "effect" },
  wheelStart: { category: "effect" }, wheelTick: { category: "effect" }, rewardReveal: { category: "effect" },
  purchase: { category: "effect" }, badgeUnlock: { category: "effect" }, itemUnlock: { category: "effect" },
  rankUp: { category: "effect" }, rankBuild: { category: "effect" }, rankImpact: { category: "effect" }, rankReveal: { category: "effect" }, rewardCollect: { category: "effect" },
  friendRequest: { category: "notification" }, notification: { category: "notification" },
};

/** Final licensed/owned hub music belongs at public/sounds/music/hub-theme.mp3. */
export const backgroundMusicAsset: string | undefined = undefined;
