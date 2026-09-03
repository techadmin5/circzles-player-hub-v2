export type SoundEvent =
  | "button"
  | "navigation"
  | "tab"
  | "coin"
  | "xp"
  | "missionClaim"
  | "missionComplete"
  | "wheelTick"
  | "rewardReveal"
  | "purchase"
  | "badgeUnlock"
  | "rankUp"
  | "error"
  | "success";

export const soundAssets: Record<SoundEvent, string> = {
  button: "/sounds/ui/button.mp3",
  navigation: "/sounds/ui/navigation.mp3",
  tab: "/sounds/ui/tab.mp3",
  coin: "/sounds/rewards/coin.mp3",
  xp: "/sounds/rewards/xp.mp3",
  missionClaim: "/sounds/rewards/mission-claim.mp3",
  missionComplete: "/sounds/rewards/mission-complete.mp3",
  wheelTick: "/sounds/rewards/wheel-tick.mp3",
  rewardReveal: "/sounds/rewards/reward-reveal.mp3",
  purchase: "/sounds/rewards/purchase.mp3",
  badgeUnlock: "/sounds/progression/badge-unlock.mp3",
  rankUp: "/sounds/progression/rank-up.mp3",
  error: "/sounds/ui/error.mp3",
  success: "/sounds/ui/success.mp3",
};
