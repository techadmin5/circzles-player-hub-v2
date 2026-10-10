# Canonical design identity and dataset repair

Branch: `feature/admin-spreadsheet-catalog-import`.

A design family is the existing `puzzle_designs` record. A playable configuration is a `catalog_variants` record with a playable puzzle. A manufacturing batch is a separate physical identity even when it shares that configuration. Number identifier, run, SKU, quantity and ranges never split gameplay identity. Stage is not included in this identity rule.

## Import identity algorithm

1. Use optional `Canonical Design`, `Design Family`, `Design Key` or `Canonical Name` first. Otherwise use the display name as an exact hint. Trim, lowercase and collapse whitespace. No fuzzy matching changes identity.
2. Resolve that hint through persistent confirmed design aliases. The alias resolves to a stable design UUID. A previously unknown exact name can propose a new family; a matching historical design without a confirmed alias requires review. The known Colorstrom/Colorstom and Peacock/Peocock differences produce review hints if encountered together without a confirmed alias or explicit family column. They are never silently registered as equivalent.
3. For playable rows, require verified size, positive level and positive integer piece count. Normalize numeric size and level for comparison, leaving raw manufacturing source fields and SKUs unchanged. Build `JSON.stringify([family, normalizedSize, numericLevel, pieceCount])`.
4. Identical complete signatures share a proposed new key, or link to one active existing variant in the confirmed family. Server preview rejects separate new keys for the same complete signature or a new identity when that configuration already exists; a fingerprint-matching resumed shared key remains valid. Different size, level or pieces use different variants under the same family. Missing pieces on either side, ambiguous historical family links, duplicate/inactive existing targets or unverified existing pieces yield `NEEDS-REVIEW`. No level-to-piece table is used in production.
5. Accessories and NA-level drafts get separate catalog identities. They are not automatically grouped as playable products. The positive playable-level rule and claim protections remain intact.

The wizard displays AUTO-SHARED, AUTO-SEPARATE, EXISTING-CANONICAL or NEEDS-REVIEW with reasons. Product identity controls allow an explicit reviewed override: new playable CircZles, same CircZles as another manufacturing run, or link to an existing CircZles. Technical IDs appear under details. An unresolved review blocks dry-run/apply; explicit decisions remain in the downloaded manifest. Worksheet/column changes clear decisions and prior approval. The authenticated proposal endpoint checks existing families without importing data; raw Excel bytes remain in browser memory.

The summary separates source rows, manufacturing batches, unique playable identities, shared manufacturing groups, accessories, incomplete drafts, needs-review rows, errors and manufactured units. The finalized source TSV/JSON are unchanged at 82 rows / 12,001 units. Their missing piece counts are not invented. Verified pieces can be mapped from `Piece Count`, `Pieces`, `No of pieces`, `No. of Pieces` or `Number of Pieces`.

## Persistent aliases and manual entry

Additive migration `0024_catalog_design_aliases.sql` creates `puzzle_design_aliases`, a unique normalized alias to existing design UUID table with a foreign key, nonempty-name check and design index. It does not backfill guessed aliases or edit migration 0023. New families register their exact names. A verified explicit family column registers its display-name association when applying that family/configuration, including a link to an existing variant. In catalog details, **Confirm design alias** explicitly registers a spelling or rename against that design family. Conflicting registrations are refused rather than reassigned.

Historical variants are not adopted solely from their names. Confirm their family and verify gameplay and prefix compatibility before linking. Existing legacy Metamorphosis records remain separate until such a review occurs.

Manual **+ Add CircZles** uses the full design-family registry, then size, level and pieces. Under the catalog transaction lock, an identical complete nonarchived configuration returns the existing variant with `existingCanonical: true`. The UI opens its details/manufacturing form with “This playable CircZles already exists. Add a Manufacturing Batch instead.” Different complete configurations create separate variants; nullable drafts remain separate. Updates/activation reject another complete nonarchived configuration in that family.

All catalog create, update, import, alias and repair mutations use the existing PostgreSQL transaction advisory lock `circzles.catalog.management`. This database lock serializes concurrent admin/import creation and duplicate checks across server processes. A unique canonical index is not installed over historical duplicates or nullable drafts; the operator repair must not be disguised as a migration. The alias key itself has database uniqueness. Existing authorization, proxy, mutation-origin and no-store protections cover the new design/proposal/alias endpoints.

## Operator-only repair

`backend/src/cli/reconcileCatalogDataset.ts` is not an HTTP endpoint, startup hook, migration or automatic import. It does not load `.env` and deliberately ignores normal `DATABASE_URL`. The operator must supply `REPAIR_DATABASE_URL` explicitly. Do not execute against production without a separately authorized operational review.

Prepare a verified evidence file with this structure (the abbreviated example is not a runnable complete repair):

```json
{
  "datasetId": "circzles-r1-r2-r3-v1",
  "verifiedRows": [
    { "sourceId": "29-R2", "designFamily": "Lion", "pieceCount": 37 },
    { "sourceId": "61-R3", "designFamily": "Lion", "pieceCount": 37 },
    { "sourceId": "07-R1", "designFamily": "Metamorphosis", "pieceCount": 127 },
    { "sourceId": "22-R2", "designFamily": "Metamorphosis", "pieceCount": 37 },
    { "sourceId": "48-R3", "designFamily": "Metamorphosis", "pieceCount": 37 }
  ]
}
```

The operator must verify family and piece count for every playable dataset row. Three NA-level drafts and the accessory remain separate and need no invented gameplay evidence. Synthetic test evidence uses supplied piece-count tiers; this is explicitly test-only and is not a production fixture or rule.

From the backend directory, with an explicitly chosen operator connection:

```text
npx tsx src/cli/reconcileCatalogDataset.ts --plan verified.json
npx tsx src/cli/reconcileCatalogDataset.ts --plan verified.json --apply --expected-preview <reviewed-sha256>
```

Preview is the default. It requires exactly the named dataset's 82 batches / 12,001 units and rejects outside/duplicate evidence IDs. It reports each candidate's current/proposed variant, reason, claim and ownership counts, all direct puzzle/variant FK dependency counts, including submissions and leaderboards, and event history. Accessories/incomplete/unverified rows appear as unchanged batches. Positive-level rows without verified evidence block repair.

The planner uses the same family/size/level/piece signature. It picks a stable target from that dataset's batches in SKU order and a consistent family across its different configurations. It never chooses an unrelated historical variant by name. It refuses conflicting existing configurations, gameplay mismatches between source/catalog/playable records, claimed identities, ownership (including deleted rows), submissions, leaderboard/competition/history dependencies, unrelated batches/prefixes or conflicting aliases. Existing dependencies on a target also require review; safety is deliberately conservative.

Apply requires the exact preview SHA-256. It reacquires the catalog advisory lock and bounded-time maintenance table locks, preventing concurrent claims and history writes during the checks. It regenerates the plan and hash including verified evidence, source fingerprints, variant/puzzle metadata, prefixes, ranges, aliases and dependency counts. Any change invalidates the approval. Lock acquisition failure aborts rather than proceeding unlocked. This is an operator maintenance operation; locks may temporarily block catalog/claim traffic.

For safe unclaimed rows only, it sets the batch/prefix's target playable identity, completes verified target piece metadata and family links, and remembers operator-confirmed aliases. It preserves SKU, number, run, units, ranges, importKey, sourceFingerprint and sourceData. Source evidence is not rewritten to impersonate a new import; the original manifest remains idempotent. Duplicates are archived only after rechecking that no batches, prefixes or any history dependencies remain. Nothing is hard-deleted. All changes, alias writes and archives are one transaction; an injected mid-repair failure proves full rollback.

## Validation and operational boundary

Regression coverage includes Lion/Metamorphosis/L.S.Tree, changed size/level/pieces, spelling/case/whitespace, optional columns, missing pieces, persistent aliases, R4/R5 reuse, separate physical batches, canonical ownership uniqueness, manual duplicate handling, concurrent creation, repair preview/staleness/claims/deleted ownership, history dependency discovery, immutable source metadata, archive checks and transaction rollback. Existing multi-sheet lazy loading and mapped-column note filtering remain covered.

No production migration, repair, import, reset, merge or deployment is part of this change. Only isolated in-memory test databases execute the additive migration and repair. Existing players, claims, auth, SSE, XP/SP and production data are not changed.

Final validation:

| Command | Result |
| --- | --- |
| Backend `npm test -- --maxWorkers=2` | 884 passed, 46 files, no failures/skips |
| Backend `npm run lint` | Passed |
| Backend `npm run typecheck` | Passed |
| Backend `npm run build` | Passed |
| Frontend `npm test` | 193 passed, no failures/skips |
| Frontend `npm run lint` | Passed |
| Frontend local `tsc --noEmit` | Passed |
| Frontend `npm run build` | Passed, API mode, 45 static pages |
| `git diff --check` | Passed |

Frontend build output was isolated to `.next/canonical-identity-validation-20261010` with two workers. Generated `tsconfig.json` and `next-env.d.ts` were restored byte-for-byte. No persisted environment variable changed. The user's pre-existing `next-env.d.ts` edit is excluded from the commit.

Files changed (22):

- `backend/drizzle/0024_catalog_design_aliases.sql`
- `backend/drizzle/meta/0024_snapshot.json`
- `backend/drizzle/meta/_journal.json`
- `backend/src/db/schema.ts`
- `backend/src/domain/catalog.ts`
- `backend/src/domain/catalogIdentity.ts`
- `backend/src/domain/catalogDatasetRepair.ts`
- `backend/src/cli/reconcileCatalogDataset.ts`
- `backend/src/http/catalogRoutes.ts`
- `backend/tests/catalog.test.ts`
- `backend/tests/catalogIdentity.test.ts`
- `backend/tests/catalogImportTransport.test.ts`
- `src/lib/catalogAdmin.ts`
- `src/components/admin/CatalogAdmin.tsx`
- `src/components/admin/catalogAdmin.test.mjs`
- `src/components/admin/catalog-import/types.ts`
- `src/components/admin/catalog-import/spreadsheetParser.ts`
- `src/components/admin/catalog-import/manifestBuilder.ts`
- `src/components/admin/catalog-import/CatalogImportWizard.tsx`
- `src/components/admin/catalog-import/catalogImport.test.mjs`
- `docs/circzles-catalog/spreadsheet-import.md`
- `docs/circzles-catalog/canonical-identity-repair.md`
