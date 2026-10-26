// Individual mission policy only; enabled chest links remain independently blocked.
export const missionActivationPolicyBlocker = {
  code: "MISSION_CAPACITY_RECOVERY_AVAILABLE",
  status: "PASS" as "PASS" | "BLOCKED",
  category: "PRODUCT" as const,
  field: "rewards,claimDeadline",
  message: "An eligible on-time individual mission claim that exceeds clean XP/SP capacity is durably recorded for explicit SUPER_ADMIN recovery of the original frozen amounts. Deadlines remain unchanged; permanently blocked exceptions remain pending. Chest recovery is independently available through chest administration; enabled chest links still require lifecycle alignment review before changing a mission.",
};
