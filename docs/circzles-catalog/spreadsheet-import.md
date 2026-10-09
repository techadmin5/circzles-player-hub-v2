# Guided spreadsheet catalog import

Branch: `feature/admin-spreadsheet-catalog-import`, based on current production `origin/main`.

The Catalog admin now accepts a normal spreadsheet and guides the operator through upload, worksheet/column mapping, row selection, explicit canonical decisions, summary, dry-run and confirmation. Existing catalog editing and manufacturing controls remain available. Only the two existing import endpoints write through the unchanged transactional CatalogService. No migrations, source-catalog replacements, auth/session changes or gameplay changes are included.

## Operator workflow

1. Sign in with the existing provisioned SUPER_ADMIN account and open `/admin/puzzles`. The existing boundary and every authenticated backend endpoint still enforce CATALOG_MANAGE, session, production proxy and mutation-origin checks.
2. Upload `.xlsx`, `.xls`, `.csv` or an existing `.json` manifest. The browser parses the file; the raw business workbook is not sent to a new endpoint. Upload alone never previews or applies an import.
3. For Excel, inspect the named worksheet selector. All worksheet names are read from metadata first. Up to eight worksheets are sampled at 25 rows each, prioritizing names containing catalog/manufacturing/SKU/final-run; the strongest recognized headers in this bounded sample determine the default. Only the selected sheet is then fully parsed. Other sheets are never merged. Inspect detected headers (first 25 worksheet rows) and override column choices as necessary. Required fields must be mapped. Unused commercial columns are explicitly listed as ignored. Website SKU cannot be used as the manufacturing SKU column.
4. Review normalized rows, exact full SKUs, derived prefixes, product types, ranges, errors and warnings. Select All, Deselect All or individual checkboxes control the manifest. Review pages contain at most 50 rows. Excluded rows and their mappings are absent from the manifest.
5. Choose a canonical decision for each selected row. Create a separate new catalog product, search/select an existing product, or explicitly reuse another selected row's new group. The bulk action explicitly creates separate identities for every unmapped selected row; it never merges names. Keys are stable for the same row layout, unique even against loaded JSON keys, and preserved by manifest download. Existing selections show display names, size, level and status with the UUID as secondary detail.
6. Review counts and use a stable dataset ID. The default is the file stem plus worksheet name; operators can override it. Keep this ID, source rows and mapping keys unchanged when rerunning. Download the prepared JSON manifest to retain the exact reviewed decisions. Changing the worksheet or column mapping deliberately clears row selections and decisions.
7. Run **Dry-run validation**. The original preview endpoint remains authoritative. Row errors link back to canonical/row review. Name-similarity candidates are hints only. Client problems, missing decisions, `report.ready !== true`, server errors or a stale manifest snapshot prevent apply.
8. **Apply validated import** opens a confirmation dialog showing planned batches, manufactured units and new catalog identities (including accessories/drafts). Cancel performs no writes. Apply uses the existing atomic endpoint, with request guards against duplicate clicks. On success, show created/skipped counts and refresh the catalog. Any input change invalidates preview approval. Apply failure also clears approval; preview again before retrying. A response loss is resolved by rerunning the exact saved manifest, not by inventing a new identity.

Advanced JSON is a collapsed secondary area. Existing manifests retain their dataset IDs, rows and explicit mappings. Edited JSON must be loaded into the wizard before validation/apply. Downloaded JSON contains only selected rows and their decisions. Raw parsing and HTML-like cell contents never execute as code; React renders source text as text.

## Exact column aliases

Matching is case-insensitive with whitespace, underscores and hyphens normalized. It uses exact aliases, never substring/name similarity matching. Every detected mapping can be overridden. Duplicate matching headers require deliberate selection rather than arbitrary column identity.

| Logical field | Accepted header aliases |
| --- | --- |
| CircZles Name | Puzzle Name; CircZles Name; Product Name; Name |
| Size | Size; Puzzle Size |
| Brand | Brand; Brand Name |
| Number Identifier | Number Identifier; Number ID; Identifier |
| Manufacturing Run | Manufacturing Code; Manufacturing Run; Run; Batch Run |
| Level | Level; Levels |
| Units Manufactured | Units; Quantity; Manufactured Units; Units Manufactured |
| First Full SKU | SKU Number; SKU; First Full SKU; Final SKU; Manufacturing SKU |
| Piece Count (optional) | Piece Count; Pieces |

The manufacturing-specific aliases take precedence over generic SKU. Website SKU, Website Product ID, Price and Notes are never auto-mapped. Piece Count may be ignored; it is never invented. Product Type defaults from CC/CZ and is editable per row; a family disagreement remains an error for server validation.

## Manufacturing identity and safety

CSV supports comma-separated UTF-8, optional BOM, quoted commas/quotes/newlines and CRLF/LF. All CSV cell values remain strings, so `01`, `06` and `0001` are not coerced. Excel parsing reads formatted text and typed numeric values. For typed numeric Number Identifier/Level cells only, the exact SKU segment restores lost zero padding when numeric values agree. Every normalization is shown as a warning. Disagreeing values, unsafe Excel integers and malformed identities require source review rather than guesses. Numeric Units/Pieces require integers; digit formatting such as `03` is retained. Commercial-column formulas are ignored; mapped formula/error/date cells require verified static values. Excel formulas/macros are not evaluated.

The source ID is exactly `numberIdentifier-manufacturingCode`. Duplicate IDs or prefixes are errors on both rows; no row is silently removed. Serial start comes from the final SKU segment and quantity produces the inclusive range using bigint arithmetic. The existing backend remains responsible for actual ranges, reserved prefixes, prior claims and canonical consistency.

NA stays NA. The backend still imports NA-level CircZles as incomplete DRAFT records with no playable/claim prefix identity; accessories remain catalog-only. No positive gameplay-level rule is weakened. Import does not grant ownership or configure leaderboards, submissions, competitions or rewards. Import keys, source/mapping fingerprints, explicit corrections, advisory locks, atomic rollback and idempotent skips remain unchanged.

The finalized fixture is unchanged: 82 source rows / 12,001 units, including 44 R3 rows / 4,200 units. Lion uses 29-R2 and 61-R3; the authoritative source and mapping example were not edited. All existing security, claimed-identity and real database import tests remain in the full regression run.

## Parser and limits

The only new dependency is **SheetJS CE `xlsx` 0.20.3**, Apache-2.0, pinned to its official tarball with lockfile SHA-512 integrity. This release supports XLSX and binary Excel 97–2003 XLS; the old npm registry release is not used. [Official installation instructions](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/) and [parse options](https://docs.sheetjs.com/docs/api/parse-options/) explain release sourcing and formatted-text behavior. The library is dynamically imported only for Excel upload; CSV and JSON do not load it. It is bundled locally, not fetched from a runtime CDN.

The final production build places the Excel library in a separate separate JavaScript chunk. It is loaded when an administrator uploads Excel, rather than on ordinary Player Hub routes or CSV/JSON parsing.

Limits are explicit: 10 MB file size, 5,000 non-empty data rows, 100 worksheet columns and no fixed worksheet-count cap (51- and 201-sheet XLSX/XLS workbooks are covered by regressions). Oversized input is rejected, not truncated. Only the selected sheet's full row/column bounds are inspected before normalization. Oversized unselected sheets do not prevent workbook opening. Original bytes remain in browser memory for on-demand worksheet switching; switching resets row choices, canonical decisions and preview approval. Empty sheets remain selectable and display "No usable rows found". Preview/mapping tables show 50 rows per page; searches and reusable-group choices show at most 50 results. Client tests exercise a 5,000-row upload and page navigation.

The only backend change raises the existing preview/apply route body limit from Fastify's default 1 MiB to 16 MiB so ordinary 5,000-row manifests reach the existing validator. All other route limits remain unchanged. Schema validation still caps 5,000 rows and bounded source fields. Transport tests verify both endpoints, permission invocation, no-store and oversized-body rejection. This is transport configuration, not a second import engine.

## Validation

| Command | Final result |
| --- | --- |
| Backend `npm test -- --maxWorkers=2` | 863 passed / 45 files; zero failures/skips |
| Backend `npm run lint` | Passed |
| Backend `npm run typecheck` | Passed |
| Backend `npm run build` | Passed |
| Frontend `npm test` | 173 passed; zero failures/skips |
| Frontend `npx tsc --noEmit` (local `tsc.cmd`) | Passed |
| Frontend `npm run lint` | Passed (multi-worksheet correction regression run) |
| Frontend `npm run build` | Passed in API production mode; 45 static pages, two workers |
| `git diff --check` | Passed |

The frontend build uses process-only `.next/multisheet-import-validation-20261009` output and the existing Google Fonts. Next-generated configuration/declarations are restored byte-for-byte. No production environment setting is changed. The suites add 54 frontend cases (parser/normalization/manifests plus guided UI) and three backend transport cases; existing transactional/idempotency, authorization, physical claims and player-state cases remain included.

## Changed files

- `backend/src/http/catalogRoutes.ts`
- `backend/tests/catalogImportTransport.test.ts`
- `package.json`
- `package-lock.json`
- `src/components/admin/CatalogAdmin.tsx`
- `src/components/admin/catalogAdmin.test.mjs`
- `src/components/admin/catalog-import/CatalogImportWizard.tsx`
- `src/components/admin/catalog-import/types.ts`
- `src/components/admin/catalog-import/spreadsheetParser.ts`
- `src/components/admin/catalog-import/manifestBuilder.ts`
- `src/components/admin/catalog-import/catalogImport.test.mjs`
- `docs/circzles-catalog/spreadsheet-import.md`

## Review considerations

No production migration, import, data write, merge or deployment was performed. Tests use synthetic inputs and isolated test databases. The unrelated untracked backend script is excluded from this commit.

Before release, review a representative business workbook in staging and prepare explicit canonical mappings against the real catalog. Password-protected workbooks require an unprotected export. Files whose headers start beyond the first 25 rows require a clean export. Normalization cannot restore information already lost by Excel rounding; such values must be corrected to verified text.

Hosting/proxy request limits and execution timeouts still apply even when the backend body limit is larger; unusually wide manifests may need explicit smaller imports. Nothing silently splits a transaction. Excel parsing is client-side and synchronous after the lazy library load, with bounded input and paginated output; complex workbooks near the limit should be assessed on the administrator's browser.

Dependency audit reports nine existing advisories (eight high, one critical) in unchanged Next/tooling dependencies, and none for the added xlsx release. No existing locked dependency version was changed. Dependency upgrades are a separate production review; this change does not run an automatic audit fix.

## Multi-worksheet production smoke-test correction

The previous 50-worksheet rejection is removed. Regression workbooks with 51 and 201 sheets pass for both XLSX and XLS. Instrumented reads verify metadata-only discovery, bounded header sampling and full reads filtered to the requested worksheet. A synthetic 51-sheet workbook named/shaped like the reported business workbook preserves the exact 82-row / 12,001-unit authoritative catalog. UI coverage proves one file read, all 51 names available, worksheet switching, stale selection/mapping/preview invalidation and empty-sheet recovery. Selected-sheet overflow tests still reject 5,001 rows and 101 columns without silently truncating; valid sheets in the same workbook remain usable.

The original production workbook bytes were not provided in this task, so verification uses synthetic workbooks and the unchanged authoritative fixtures. No workbook was sent to a backend endpoint during these checks.


This follow-up changes six files: `spreadsheetParser.ts`, `types.ts`, `CatalogImportWizard.tsx` and `catalogImport.test.mjs` under `src/components/admin/catalog-import/`, `src/components/admin/catalogAdmin.test.mjs`, and this guide. The pre-existing `next-env.d.ts` edit remains outside the commit. No backend implementation or dependency is changed by this correction.
