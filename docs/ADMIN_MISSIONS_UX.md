# Admin Missions UX redesign

Local review candidate, 2026-11-25. Implementation and validation made no production API/database connection, mission mutation, approval, activation or deployment. The final review authorizes one local commit only; no push is authorized.

## Review location and scope

Branch: feature/admin-missions-ux, based on main 96a83f5cfaa62d0631fc53aad73b330addd03925. Work is isolated from the original dirty checkout. The work was prepared unstaged and uncommitted; the final review below authorizes a focused local commit after validation.

The real /admin/missions route now renders Mission Manager. The existing authentication layout and SUPER_ADMIN API permission checks remain in place. No new identity mechanism or product policy is introduced.

## Administrator experience

- Six summary cards use the complete backend-paginated mission library. Active/inactive totals are definition states, not player completion counts. Approval/configuration/readiness totals appear only after all current reports load; failures and stale reports remain unknown instead of becoming zero or approved.
- Search, every supported category, status filters, deterministic sorting and nine-card pagination. Confirmed deactivation uses persisted administrator lifecycle history rather than guessing from inactivity.
- Cards describe the player objective, actual currency amounts, linked catalog collectible, lifecycle, separate approvals and the next action.
- Seven detail tabs: Overview, Objective & Tracking, Rewards, Schedule, Approvals, Activation Readiness, History & Advanced. The overview includes a player-card appearance preview.
- Supported event and counting labels are translated; API values remain unchanged. Eligible mission references and collectibles are selected by real names. Missing existing references are preserved and block unsafe replacement.
- UTC calendar controls serialize explicitly to UTC. Daily midnight, Monday weekly reset, existing mission claim deadlines and chest grace remain backend-controlled.
- Reward editing keeps explicit entry and existing positive-integer constraints. No currency amounts are invented or prefilled for achievements. Currency omission and incomplete drafts retain their existing semantics.
- Product and reward-budget approval actions remain independent, individually confirmed and revision/digest-bound. The review queue supports navigation, not blanket approvals.
- The activation center filters ready, approval-required, incomplete, active, inactive and confirmed-deactivated definitions. Activation opens a fresh server-readiness review with objective, category, exact rewards, collectible, schedule, warnings, consequences and revision. A checkbox is mandatory. Both distinct approval categories and matching revisions are required, and the backend remains authoritative.
- Native mission/chest dialogs focus Cancel, contain keyboard focus, handle Escape and restore focus. Mutations have duplicate-submit protection. Lost-response messaging never guarantees that a write was not committed; mutations are never automatically replayed.
- Active definitions remain inspectable with editors locked. Their inactive-only activation preview is not presented as proof that the active definition is broken.
- Chest cards and tabs preserve manual claims, 3 of 5 Daily / 4 of 6 Weekly unique completion requirements, UTC reset rules, 24-hour grace, existing budget template and separate chest approvals. Configuration, review/publish and history/recovery are organized separately.
- IDs, raw events, JSON, configuration digests and audit actor identifiers are retained in expandable advanced sections. No administrator history is removed.

## API and contract changes

One read-only endpoint is added because tracking alone exposes a collectible UUID, not its actual name or artwork:

GET /api/admin/missions/collectibles?limit=100&offset=0

Uses the existing MISSIONS_MANAGE SUPER_ADMIN pre-handler, production first-party proxy check, strict pagination validation and private/no-store response. Returns only rewardDefinitionId, code, name, rewardType (BADGE or FRAME), imageUrl and active, plus pagination. No metadata, inventory ownership, grants or player information is returned. Inactive catalog entries remain visible for historical associations and are disabled as new choices.

Frontend DTOs remain in src/types/adminMissions.ts. Backend validation checks exact type equality for the catalog response. No frontend implementation imports backend code. No new write endpoint, schema or migration is added.

All existing metadata/rule/tracking/scheduling/reward/approval/lifecycle/history/capacity APIs retain their input contracts. Configuration changes continue to invalidate approvals through server revision/digest behavior. Readiness is never saved as activation state.

## Remaining backend/product limitations

- Collectible names/previews need the new read endpoint deployed with the existing backend. If unavailable, the UI reports missing catalog details and preserves linked identifiers; it does not guess a reward.
- Library summaries require per-definition reports, loaded with three concurrent mission inspections. This is appropriate for the current collection; a separately reviewed aggregate read endpoint would improve very large catalogs.
- There is no player-progress analytics endpoint in this scope. Monitor means current definition/lifecycle/readiness/history, not fabricated player engagement.
- Existing advanced conditions and unsupported reward types remain read-only. No reward economy or tracking semantics are expanded.
- Achievement currency amounts, individual product/budget approvals, live wheel availability and any remaining source-reference/product decisions remain real prerequisites. UI development does not approve them.
- The browser rehearsal is a real Chrome rendering of the actual components with loopback-only synthetic fixtures. It does not establish live authentication or production-data correctness.

## Validation

Final command outcomes are recorded in the local validation artifacts beside the isolated worktree. Initial implementation validation: full frontend regression had 293 passing tests; focused backend administration had 29 passing tests. The final guard changes were validated separately below. Typecheck, lint and production builds on both sides pass. Focused tests cover real component rendering, role denial, exact approval payloads, stale reports, explicit currency values and boundaries, UTC scheduling, active read-only compatibility, catalog associations, pagination drift and duplicate submits. Existing player chest/history/claim regression tests remain included.

Chrome desktop 1440x1100, tablet 820x1180 and mobile 390x844 rehearsal: 22 checks passed, no runtime exceptions and no mutation requests. Desktop/mobile/chest/activation-review screenshots were captured and inspected. Checks include mobile overflow, card columns, exact confirmation rewards, Cancel focus, Escape, return focus, no implicit payouts and unapproved chest activation blocking.

No dependency versions, package manifests, lockfiles, migration SQL/snapshots/journals or production configuration were changed. The original next-env.d.ts, all original pending files, six catalog audits and rollout documentation are preserved.

## Exact review paths

Backend (3):
- backend/src/domain/adminMissions.ts
- backend/src/http/adminMissionRoutes.ts
- backend/tests/adminMissions.test.ts

Frontend (19):
- src/app/admin/missions/page.tsx
- src/app/admin/missions/mission-manager.css
- src/components/admin/AdminConfirmationDialog.tsx
- src/components/admin/ChestAdmin.tsx
- src/components/admin/MissionAdmin.tsx
- src/components/admin/MissionApprovalContract.tsx
- src/components/admin/MissionDetailPanel.tsx
- src/components/admin/MissionHistory.tsx
- src/components/admin/MissionLifecycleControls.tsx
- src/components/admin/MissionManagerTabs.tsx
- src/components/admin/MissionRewardPreview.tsx
- src/components/admin/MissionRuleEditor.tsx
- src/components/admin/MissionScheduleEditor.tsx
- src/components/admin/MissionTrackingEditor.tsx
- src/components/admin/missionManagerModel.ts
- src/components/admin/missionAdmin.test.mjs
- src/components/missions/missionChests.test.mjs
- src/components/missions/starterMissions.test.mjs
- src/types/adminMissions.ts

Documentation (1):
- docs/ADMIN_MISSIONS_UX.md

No publication or production operation is authorized by this document. Next release step: separately authorize publication of this reviewed feature branch. No push or deployment is authorized by this document.

## Final pre-commit review

The desktop preview's ready Daily Check-In uses explicitly synthetic approved records and passing readiness in the private loopback fixture, outside this repository. It is not evidence of production approvals and is not a default in the real implementation.

The focused review tightened two client guard gaps: readiness now matches both mission ID and configuration revision, and both independent approval records must match the current mission ID, revision, deterministic digest, approval category and exact XP/SP amounts, with no revocation. A strict boolean ready flag, passing configuration, non-blocked overall status and an actual non-blocked checklist are required. Missing, failed, contradictory or stale reports never classify a mission as ready. The lifecycle dialog reads fresh no-store reports and requires an explicit confirmation checkbox; unchanged backend transaction guards remain authoritative.

Final focused validation: 62 UI tests passed, frontend typecheck passed, targeted lint passed, and the 22-check Chrome rehearsal passed again with complete synthetic approval records. No browser runtime errors or mutation requests occurred. The unchanged read-only backend retains its prior 29-test evidence. No production state was queried or changed.
