# Validation and change inventory

Branch: `feature/circzles-catalog-admin-claims`.
Base: `fe62dcf790cc0fef99f70259c52a29c6febb67af` (current main when the branch was created).

| Check | Result |
| --- | --- |
| Backend `npm test -- --maxWorkers=2` | 860 passed, 44 files; no failures or skips |
| Backend `npm run lint` | Passed, zero warnings/errors |
| Backend `npm run typecheck` | Passed |
| Backend `npm run build` | Passed |
| Frontend `npm test` | 119 passed; no failures or skips |
| Frontend `npm run lint` | Passed, zero warnings/errors |
| Frontend local `tsc --noEmit` | Passed; no npm typecheck script exists |
| Frontend `npm run build` | Passed in API production mode; 45 static pages using 2 workers |
| Drizzle generation consistency | No additional schema changes after the 0023 snapshot |
| `git diff --check` | Passed |

The final backend regression run passed all 860 tests across 44 files. The source corrections add eight cases for TSV/JSON parity, the four real accessory/NA records and their claim guards, idempotent reruns, full-source rollback on an injected final-row failure, and exact finalized R3 rows with no obsolete prefixes or mapping aliases. Existing native-auth test timeouts and assertions were not changed.

Frontend build output was isolated at `.next/catalog-final-r3-validation-20261009` using a process-only Next config override. Next-generated TypeScript config/declarations were restored byte-for-byte; the repository configuration and production environment were not changed. The build used network access for the existing Google Fonts, with the fonts unchanged.

59 new backend cases cover real persistent manufacturing/range enforcement, claims, concurrent physical/canonical ownership attempts, claim-event rollback, populated legacy migration preservation, safe metadata edits, source preview/apply/reruns/rollback, archived legacy-prefix reconciliation, accessories/drafts and server authorization. The complete source is applied only in a fresh isolated test database: 82 batches, 12,001 units, no unit rows/claims, 81 catalog variants and 77 playable variants under the test's explicitly chosen shared Lion key. This is test mapping, not an approved production mapping.

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

## Source correction files

The source corrections restore the four omitted records and replace all R3 rows with the finalized pre-launch table. The complete fixture has **82 rows / 12,001 units**. R1 and R2 remain unchanged. Finalized R3 totals 4,200 units across 44 rows. The example explicitly maps Lion 29-R2 / 61-R3; superseded prefixes are removed without aliases. The positive playable level rule and runtime implementation are unchanged. The actual accessory/NA rows remain DRAFT without playable or claim-prefix IDs; claims and incomplete CircZles activation are rejected without gameplay writes.

- `backend/tests/catalog.test.ts`
- `docs/circzles-catalog/README.md`
- `docs/circzles-catalog/mapping.example.json`
- `docs/circzles-catalog/r1-r2-r3.source.json`
- `docs/circzles-catalog/reconciliation.md`
- `docs/circzles-catalog/source.tsv`
- `docs/circzles-catalog/validation.md`

## Exact branch changed files

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
