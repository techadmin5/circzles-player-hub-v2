"use client";

import { RewardReveal } from "./RewardReveal";

export function MissionClaimFeedback({ reward }: { reward: string }) {
  return <RewardReveal label={reward} />;
}
