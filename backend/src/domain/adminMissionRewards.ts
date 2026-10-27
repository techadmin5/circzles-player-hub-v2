import { z } from "zod";
import { validationFailed } from "./errors.js";
import { freezeRewards } from "./missionLifecycle.js";

const amount = z.number().int().min(1).max(2147483647).nullable();
const rewardInput = z.object({
  xp: amount,
  synapsePoints: amount,
  expectedUpdatedAt: z.string().datetime({ offset: true }),
}).strict();

export function parseAdminMissionRewards(input: unknown) {
  const parsed = rewardInput.safeParse(input);
  if (!parsed.success) throw validationFailed("Explicitly provide XP and Synapse Points as positive whole amounts up to 2147483647, or null to omit a currency, plus the loaded revision. At least one currency is required.");
  const rewards = [
    ...(parsed.data.xp === null ? [] : [{ rewardType: "XP", amount: parsed.data.xp }]),
    ...(parsed.data.synapsePoints === null ? [] : [{ rewardType: "SYNAPSE_POINTS", amount: parsed.data.synapsePoints }]),
  ];
  freezeRewards(rewards); // M1 requires at least one positive supported reward.
  return parsed.data;
}
