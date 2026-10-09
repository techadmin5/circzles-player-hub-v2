# Validation and change inventory

Branch: `feature/circzles-catalog-admin-claims`.
Base: `fe62dcf790cc0fef99f70259c52a29c6febb67af` (current main when the branch was created).

| Check | Result |
| --- | --- |
| Backend `npm test -- --maxWorkers=2` | 852 passed, 44 files; no failures or skips |
| Backend `npm run lint` | Passed, zero warnings/errors |
| Backend `npm run typecheck` | Passed |
| Backend `npm run build` | Passed |
| Frontend `npm test` | 119 passed; no failures or skips |
| Frontend `npm run lint` | Passed, zero warnings/errors |
| Frontend local `tsc --noEmit` | Passed; no npm typecheck script exists |
| Frontend `npm run build` | Passed in API production mode; 45 static pages using 2 workers |
| Drizzle generation consistency | No additional schema changes after the 0023 snapshot |
| `git diff --check` | Passed |

One intermediate backend run hit a timeout in the unchanged native-auth setup hook during a prolonged environment delay; the final regression run was executed on its own. Existing native-auth test timeouts and assertions were not changed.

Frontend build output was isolated at `.next/catalog-validation-20261009` using a process-only Next config override. Next-generated TypeScript config/declarations were restored byte-for-byte; the repository configuration and production environment were not changed. The first sandbox build could not fetch the existing Google Fonts; the network-enabled retry passed with the existing fonts unchanged.

51 new backend cases cover real persistent manufacturing/range enforcement, claims, concurrent physical/canonical ownership attempts, claim-event rollback, populated legacy migration preservation, safe metadata edits, source preview/apply/reruns/rollback, archived legacy-prefix reconciliation, accessories/drafts and server authorization. The complete source is applied only in a fresh isolated test database: 78 batches, 11,373 units, no unit rows/claims, and 77 variants under the test's explicitly chosen shared Lion key. This is test mapping, not an approved production mapping.

15 new frontend cases exercise server-denied access, session-generation reauthorization, catalog creation/batch attachment, protected claimed identity, claim errors, immediate owned collection/canonical stats, stale-read protection after failed hydration, preview-before-apply and metadata invalidation without stat changes. Existing 801 backend and 104 frontend tests remain included.

The implementation, security model, source reconciliation, backward compatibility and manual rollout order are in [README.md](README.md). No merge, deployment, live migration, production import or admin provisioning was performed.

## Requested capability answers

1. Yes: Lion R2 and R3 can explicitly share one canonical playable ID with separate prefixes and ranges.
2. Yes: names/images/descriptions can change without changing SKUs, claims, ownership, submissions or leaderboard IDs.
3. Yes: an existing design can have another size/configuration as a separate playable variant.
4. Yes: the exact CC-number-run-level-serial convention and original imported full SKU are retained.
5. Yes: the server rejects serials outside actual manufactured intervals, including gaps.
6. Yes: repeated names, case and spelling never determine canonical identity; mappings are explicit.
7. Yes: an ACTIVE verified batch on an ACTIVE valid CircZles is immediately claimable, subject to physical/ownership rules.
8. Yes: authorized admins can add future R4/R5 batches and disjoint ranges without a code deployment.

## Exact changed files

53 files, relative to the repository root:

- `backend/drizzle/0023_circzles_catalog_manufacturing.sql`
- `backend/drizzle/meta/0023_snapshot.json`
- `backend/drizzle/meta/_journal.json`
- `backend/src/cli/provisionCatalogAdmin.ts`
- `backend/src/db/schema.ts`
- `backend/src/domain/adminAuth.ts`
- `backend/src/domain/catalog.ts`
- `backend/src/domain/competitionSettings.ts`
- `backend/src/domain/puzzles.ts`
- `backend/src/domain/submissions.ts`
- `backend/src/http/app.ts`
- `backend/src/http/catalogRoutes.ts`
- `backend/src/server.ts`
- `backend/tests/catalog.test.ts`
- `docs/circzles-catalog/README.md`
- `docs/circzles-catalog/mapping.example.json`
- `docs/circzles-catalog/r1-r2-r3.source.json`
- `docs/circzles-catalog/reconciliation.md`
- `docs/circzles-catalog/source.tsv`
- `docs/circzles-catalog/validation.md`
- `package.json`
- `src/app/admin/layout.tsx`
- `src/app/admin/page.tsx`
- `src/app/admin/puzzles/page.tsx`
- `src/app/how-it-works/page.tsx`
- `src/app/login/page.tsx`
- `src/app/page.tsx`
- `src/app/puzzles/[id]/loading.tsx`
- `src/app/puzzles/[id]/page.tsx`
- `src/app/puzzles/page.tsx`
- `src/app/ui-lab/UiLabClient.tsx`
- `src/components/Interactive.tsx`
- `src/components/admin/CatalogAdmin.tsx`
- `src/components/admin/CatalogAdminBoundary.tsx`
- `src/components/admin/catalogAdmin.test.mjs`
- `src/components/auth/PlayerHubLoadingSkeleton.tsx`
- `src/components/auth/authLoadingSlides.ts`
- `src/components/game-shell/navConfig.ts`
- `src/components/hub/HubMetricStrip.tsx`
- `src/components/hub/ProductionHub.tsx`
- `src/components/leaderboard/PublicPlayerProfileModal.tsx`
- `src/components/player/PlayerProfileView.tsx`
- `src/components/player/PublicProfileView.tsx`
- `src/components/puzzles/AddPuzzlePanel.tsx`
- `src/components/puzzles/PuzzleCollectionExplorer.tsx`
- `src/components/puzzles/PuzzleDetailExplorer.tsx`
- `src/components/puzzles/cards.tsx`
- `src/components/submissions/SubmissionComposer.tsx`
- `src/components/submissions/SubmissionListClient.tsx`
- `src/components/submissions/SubmissionStepper.tsx`
- `src/lib/apiClient.ts`
- `src/lib/catalogAdmin.ts`
- `src/mocks/data.ts`
