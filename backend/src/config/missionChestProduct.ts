// User-approved initial-release product schedule, 2026-10-24.
// A template is not a persisted chest, an approval record, or an activation.
// Never apply this to historical earned snapshots, receipts or balances.
export const missionChestProductPolicy = {
  version: "initial-release-2026-10-24",
  approvedOn: "2026-10-24",
  scope: "PRODUCT_TEMPLATE_ONLY",
  requiresRecordedProductApproval: true,
  requiresRecordedRewardBudgetApproval: true,
  manualClaims: true,
  claimGraceHours: 24,
  timezone: "UTC",
  periods: {
    DAILY: { selectable: 5, required: 3, xp: 50, synapsePoints: 100, reset: "00:00 UTC" },
    WEEKLY: { selectable: 6, required: 4, xp: 200, synapsePoints: 250, reset: "Monday 00:00 UTC (ISO week)" },
  },
} as const;
