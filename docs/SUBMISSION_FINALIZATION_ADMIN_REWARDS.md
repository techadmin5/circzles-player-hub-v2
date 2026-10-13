# Submission finalization and admin competition/rewards

## Reported time and recording evidence

The completion input accepts numeric digits and inserts MM:SS separators: 0315 becomes 03:15, 0459 becomes 04:59. Nonnumeric paste content is removed. Seconds must be complete and 00–59; partial input and 00:00 cannot continue. Numeric digits after MMSS become optional milliseconds (0315123 = 03:15.123). Caret position follows digits through inserted separators during editing. Mobile uses a numeric keyboard. Review displays the normalized time.

Only the reported completion time is constrained by the current positive canonical CircZles maximum. For a 05:00 maximum, 03:15/03:30, 04:29/00:20, 04:29/05:05 and 04:59/05:10 (reported/recording) enter Pending Review. 05:01 and 00:00 are invalid reported times. This explicitly replaces the previous automated completion <= recording and recording <= maximum rules, at both creation and approval.

Recordings still need positive server-verified Cloudinary duration, valid protected video metadata and size <= exactly 100,000,000 bytes. Player ownership, active playable CircZles, single-use video, verified COMPLETE status, idempotency, authentication and protected reviewer URLs are unchanged. Transfer 100% still does not unlock Review until backend verification succeeds. No recording mismatch is automatically approved.

Players receive a non-blocking shorter-recording warning. Reviewers see an attention warning for every shorter recording or an absolute duration difference of at least one second. They must watch the evidence and judge continuity, unboxing, solve correctness and reported time. The approval confirmation includes current configured XP/SP and whether first completion was already processed, and requires a manual verification acknowledgement. Backend approval remains authoritative: it rechecks ownership, media, provider metadata and current reported-time maximum inside the existing serialized transaction. Review history/note remains immutable; approval game events additionally record the duration warning, verified duration, maximum and MANUAL_REVIEW policy. A confirmation is not proof of a valid solve.

## Admin settings

Open **Admin → CircZles Catalog → Edit → Competition & Completion Rewards**. The dedicated form loads the canonical playable puzzle's saved active flag, leaderboard flag, Main Level/Side Quest category, display order, maximum minutes/seconds, reward flag and XP/SP amounts. Save Competition & Rewards saves and reloads the editor/list and shows success or an error. Basic catalog metadata and batch operations remain separate.

Only active playable CircZles can edit these settings. Accessories, archived variants and incomplete drafts are excluded by the UI and backend. Lion CC-29-R2-01 and CC-61-R3-01 share settings when explicitly mapped to the same puzzle_id; manufacturing changes do not change settings. Inactive competition hides the leaderboard and disables first-completion rewards through existing active checks. Active leaderboards/rewards require a positive maximum. Zero rewards are valid; negative, fractional or PostgreSQL integer-overflow amounts/order are rejected.

GET/PATCH /api/admin/catalog/:variantId/competition reuses CATALOG_MANAGE session authorization, production proxy requirement, private/no-store responses, same-origin mutation checks and strict input validation. The API resolves puzzle_id from the catalog entry; clients cannot supply player/reward grant identities. It reuses CompetitionSettingsService and puzzle_competition_settings. Patches merge inside the shared catalog/review transaction lock; absent fields preserve existing settings. Unchanged maximum fields are omitted by the form so reward editing preserves existing millisecond precision. Legacy timing-only catalog updates continue to preserve rewards. No duplicate table or migration is needed.

## Rewards and rollout

Uploads and pending/rejected/resubmission-required attempts grant no completion reward. Existing submissionRewardGrants uniqueness by player/puzzle, idempotent review keys, atomic XP/SP transactions and approval-only personal best updates remain unchanged. First approved completion records the configured active/enabled reward snapshot once, including a zero snapshot when disabled; later approvals cannot repeat it. Settings changes do not rewrite old grants. The review panel shows historical awarded amounts separately from current configuration.

No production database/player/Cloudinary mutation, import, migration, account configuration or deployment is part of this change. No specific player or trial time/reward is hardcoded. Before production sign-off, deploy through an authorized process and run a live browser test of mobile time editing, canonical settings reload, mismatched evidence warnings, protected viewing and a legitimate owned-CircZles manual review. This implementation does not create or approve a live test submission.

## Validation

Regression coverage includes numeric/paste/caret/partial entry, maximum boundaries, short/long verified recording acceptance into Pending Review, approval warning audit, existing review notes, first-grant snapshots, non-playable exclusion, strict authorized APIs, canonical Lion R2/R3 sharing, patch omission, zero amounts and unchanged maximum precision. Existing size/security/idempotency/reward/claim/profile/leaderboard suites remain required. Final full validation results are recorded in the delivery report.

Final checks: backend 940/940 tests across 48 files passed; frontend 214/214 tests passed. Both lint checks, backend typecheck/build and frontend standalone typecheck/standard Next.js production build passed; 45/45 pages generated. Frontend build used isolated output/two workers and system certificate trust for Google Fonts, with certificate verification enabled. An initial password-reset test timeout under concurrent validation load passed on the complete rerun without changing auth tests/code. Final catalog follow-up: 107/107 tests passed after the last configuration guard. git diff --check passed. The existing next-env.d.ts modification remains excluded.

## Exact changed files

- `backend/src/domain/adminSubmissions.ts`
- `backend/src/domain/catalog.ts`
- `backend/src/domain/competitionSettings.ts`
- `backend/src/domain/submissionEligibility.ts`
- `backend/src/domain/submissionReviews.ts`
- `backend/src/http/catalogRoutes.ts`
- `backend/tests/catalog.test.ts`
- `backend/tests/competitionSettings.test.ts`
- `backend/tests/completeSubmissionFlow.test.ts`
- `docs/API_CONTRACTS.md`
- `docs/COMPLETE_SUBMISSION_FLOW.md`
- `docs/FRONTEND_BUILD_BOUNDARY.md`
- `docs/SUBMISSION_FINALIZATION_ADMIN_REWARDS.md`
- `docs/SUBMISSION_VERIFICATION_WIZARD_FIX.md`
- `src/components/admin/CatalogAdmin.tsx`
- `src/components/admin/CompetitionRewardsEditor.tsx`
- `src/components/admin/SubmissionReviewAdmin.tsx`
- `src/components/admin/catalogAdmin.test.mjs`
- `src/components/submissions/SubmissionStepper.tsx`
- `src/components/submissions/submissionFlow.test.mjs`
- `src/lib/catalogAdmin.ts`
- `src/lib/catalogTiming.ts`
- `src/types/adminSubmissions.ts`
