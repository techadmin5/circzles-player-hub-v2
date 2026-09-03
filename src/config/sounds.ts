export type SoundEvent =
  | "navigation"
  | "button"
  | "tab"
  | "modalOpen"
  | "modalClose"
  | "success"
  | "error"
  | "coin"
  | "xp"
  | "missionComplete"
  | "missionClaim"
  | "wheelStart"
  | "wheelTick"
  | "rewardReveal"
  | "purchase"
  | "badgeUnlock"
  | "itemUnlock"
  | "rankUp"
  | "friendRequest"
  | "notification";

/**
 * Replaceable audio file mappings. Files may not exist yet; playback no-ops
 * gracefully when a file is missing. Drop production audio at these paths later.
 */
export const soundAssets: Record<SoundEvent, string> = {
  navigation: "/sounds/ui/navigation.mp3",
  button: "/sounds/ui/button.mp3",
  tab: "/sounds/ui/tab.mp3",
  modalOpen: "/sounds/ui/modal-open.mp3",
  modalClose: "/sounds/ui/modal-close.mp3",
  success: "/sounds/ui/success.mp3",
  error: "/sounds/ui/error.mp3",
  coin: "/sounds/rewards/coin.mp3",
  purchase: "/sounds/rewards/purchase.mp3",
  wheelStart: "/sounds/rewards/wheel-start.mp3",
  wheelTick: "/sounds/rewards/wheel-tick.mp3",
  rewardReveal: "/sounds/rewards/reward-reveal.mp3",
  missionComplete: "/sounds/rewards/mission-complete.mp3",
  missionClaim: "/sounds/rewards/mission-claim.mp3",
  itemUnlock: "/sounds/rewards/item-unlock.mp3",
  xp: "/sounds/progression/xp.mp3",
  rankUp: "/sounds/progression/rank-up.mp3",
  badgeUnlock: "/sounds/progression/badge-unlock.mp3",
  friendRequest: "/sounds/social/friend-request.mp3",
  notification: "/sounds/social/notification.mp3",
};
