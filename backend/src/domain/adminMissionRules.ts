import { z } from "zod";
import { validationFailed } from "./errors.js";
import { validateMissionRule } from "./missions.js";

// Builder options are backed by persisted, authenticated domain actions.
export const adminMissionRuleOptions = [
  { eventType: "player.checked_in", label: "Explicit daily check-in", sourceType: "PLAYER_CHECK_IN" },
  { eventType: "reward_wheel.spun", label: "Successful wheel spin", sourceType: "REWARD_WHEEL_SPIN" },
  { eventType: "mission.completed", label: "Unique eligible mission completed", sourceType: "MISSION" },
  { eventType: "puzzle.added", label: "CircZles added", sourceType: "PUZZLE_CLAIM" },
  { eventType: "submission.created", label: "Submission created", sourceType: "SUBMISSION" },
  { eventType: "submission.approved", label: "Submission approved", sourceType: "SUBMISSION_REVIEW" },
  { eventType: "submission.rejected", label: "Submission rejected", sourceType: "SUBMISSION_REVIEW" },
  { eventType: "submission.resubmission_required", label: "Resubmission requested", sourceType: "SUBMISSION_REVIEW" },
  { eventType: "personal_best.improved", label: "Personal best improved", sourceType: "SUBMISSION" },
];

const ruleInput = z.object({
  eventType: z.string(),
  targetCount: z.number().int().min(1).max(2147483647),
  sourceType: z.string().nullable(),
  puzzleId: z.string().uuid().nullable(),
  levelId: z.number().positive().max(999.9).nullable(),
  conditions: z.record(z.string(), z.never()),
  active: z.boolean(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
}).strict();

export function parseAdminMissionRule(input: unknown) {
  const parsed = ruleInput.safeParse(input);
  if (!parsed.success) throw validationFailed("Provide a supported event, positive whole event count, optional CircZles ID and level, rule enabled flag and loaded revision. Advanced conditions are not supported by this builder.");
  const option = adminMissionRuleOptions.find(option => option.eventType === parsed.data.eventType);
  if (!option || (parsed.data.sourceType !== null && parsed.data.sourceType !== option.sourceType)) throw validationFailed("Unsupported mission event or source filter.");
  if (["player.checked_in", "reward_wheel.spun", "mission.completed"].includes(parsed.data.eventType) && (parsed.data.puzzleId || parsed.data.levelId !== null)) throw validationFailed("This event does not support puzzle/level filters.");
  validateMissionRule(parsed.data, parsed.data.eventType === "mission.completed");
  return parsed.data;
}
