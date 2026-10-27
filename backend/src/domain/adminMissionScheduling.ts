import { z } from "zod";
import { validationFailed } from "./errors.js";
import { validateMissionDefinition } from "./missions.js";

// Explicit UTC, seconds and at most millisecond precision: never infer browser/server time zones.
const utcTimestamp = z.string().datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/)
  .refine(value => !value.startsWith("0000-"), "Use a year from 0001 through 9999.");
export const adminMissionScheduleInput = z.object({
  startsAt: utcTimestamp.nullable(),
  endsAt: utcTimestamp.nullable(),
  claimDeadline: utcTimestamp.nullable(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
}).strict();

export function parseAdminMissionSchedule(input: unknown) {
  const parsed = adminMissionScheduleInput.safeParse(input);
  if (!parsed.success) throw validationFailed("Provide start, end and claim deadline as null or ISO UTC timestamps ending in Z (seconds required, at most three fractional digits), plus the loaded revision. Activation and recurrence settings cannot be edited.");
  return parsed.data;
}

export function validateAdminMissionSchedule(row: Parameters<typeof validateMissionDefinition>[0], values: { startsAt: Date | null; endsAt: Date | null; claimDeadline: Date | null }) {
  validateMissionDefinition({ ...row, ...values });
  // M1 eligibility starts at max(window start, activation cutoff). Reject an empty interval.
  if (values.endsAt && row.activationEffectiveAt && values.endsAt <= row.activationEffectiveAt) throw validationFailed("Availability must end after the existing event cutoff. Scheduling cannot change that cutoff.");
  const earliest = Math.max(row.activationEffectiveAt?.getTime() ?? -Infinity, values.startsAt?.getTime() ?? -Infinity);
  if (values.claimDeadline && values.claimDeadline.getTime() <= earliest) throw validationFailed("The claim deadline must be after the earliest eligible event time.");
}
