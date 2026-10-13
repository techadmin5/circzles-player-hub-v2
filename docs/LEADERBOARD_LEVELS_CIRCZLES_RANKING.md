# Levels, canonical CircZles leaderboards and owned rankings

## Hierarchy and selection

Category → Level → canonical playable CircZles → individual leaderboard. Main Levels always offers Levels 1–10, including empty levels. Any other explicitly configured Main Levels remain independently selectable without a Level 1–10 shop link. Side Quests remains a separate category; category changes do not reclassify puzzles. Each design has its own selector, labelled by design rather than manufacturing run or internal ID. Multiple designs can share Level 1 or Level 6 without sharing results. R2/R3 batches explicitly mapped to one puzzle_id share one board.

The existing leaderboard catalog API remains a flat list of eligible canonical puzzles, grouped by category. The frontend groups those records by numeric level and loads only the selected puzzle's board. Newly enabled records appear on the next catalog refresh; no hardcoded design registry or automatic setting activation is introduced. Eligibility requires positive playable level, active/nondeleted puzzle, active competition, enabled leaderboard, explicit category and positive maximum completion time. Missing settings are configuration gaps, not fabricated competitions.

The top-three podium effects, top-ten standings, current-player row beyond the top ten, public player profile modal and deterministic approved-time ordering remain. Selectors use responsive grids rather than nested horizontal scrolling. Category tabs support arrows/Home/End, labelled panels and focus; level/design buttons expose pressed state. Errors offer retry, cancelled old requests cannot replace a newer selection, and empty categories remain usable.

## Best and Rank

Board and ownership ranks use one shared SQL window query: ROW_NUMBER partitioned by puzzle_id, ordered by fastest approved best time, best approval timestamp, best submission timestamp, then best submission UUID. Current-player filtering happens outside the window, so rank includes the entire competition rather than only the top ten. Entries join their approved submission and matching player/puzzle; pending, rejected or invalid stale entry references cannot produce approved Best/Rank.

The ownership endpoint uses two bounded queries regardless of the number of owned CircZles: ownership/setting/own approved-best/latest-status metadata, followed by one batched ranking query for eligible owned puzzle IDs. Ineligible boards retain historical approved Best but return leaderboardEligible=false with no active rank. Cards and detail show Inactive instead of a stale placement. Latest submission status is separate from stored ownership status; no ownership/claim records are modified. Best uses the same MM:SS.mmm format as the board, so 195000 ms displays 03:15.000.

Cards no longer expose puzzleId or difficulty levelId in customer labels. Detail consumes owned-puzzle enrichment instead of treating the public catalog DTO as an owned record. Collection/detail refresh on mount/navigation, player snapshot changes (including approval-driven SSE hydration), focus and visibility. Catalog/selected-board data likewise refreshes without a hard browser reload. The relevant requests/responses are private/no-store. There is no new high-frequency polling.

## Empty-board discovery

An enabled empty board says **Be the First to Set a Record!** and **Take on the challenge, submit your solve, and earn your place on the leaderboard.** A level without an enabled design shows discovery without inventing results. External anchors open in a new tab with rel="noopener noreferrer" and exact unchanged destinations:

- Levels 1–5: https://www.circzles.com/buy-circular-wooden-puzzles?By+Levels=Level%25201-5
- Levels 6–10: https://www.circzles.com/buy-circular-wooden-puzzles?By+Levels=Level%25206-10

No second encoding is applied. These are level discovery links, not assertions that a particular leaderboard design is in stock. Side Quests and other levels do not receive these links.

## Read-only configured-data coverage

Snapshot captured 2026-10-13 07:27:09 UTC (12:57:09 Asia/Calcutta), from the configured database using REPEATABLE READ READ ONLY and ROLLBACK. Only aggregate puzzle/settings counts were read; no account, claim, submission, reward or Cloudinary mutation was performed.

| Level | Active playable CircZles | Enabled Main Level boards | Incomplete configuration |
|---|---:|---:|---:|
| 1 | 6 | 1 | 5 |
| 2 | 2 | 0 | 2 |
| 3 | 2 | 0 | 2 |
| 4 | 6 | 0 | 6 |
| 5 | 3 | 0 | 3 |
| 6 | 4 | 0 | 4 |
| 7 | 2 | 0 | 2 |
| 8 | 3 | 0 | 3 |
| 9 | 2 | 0 | 2 |
| 10 | 1 | 0 | 1 |
| Total | 31 | 1 | 30 |

All ten levels have zero explicitly configured Side Quests in this snapshot. Incomplete means no settings row, no explicit category, or no maximum. These 30 gaps need an authorized administrator to configure/enable boards through **CircZles Catalog → Competition & Completion Rewards**; this task enables none. The repeatable report command is `node --import tsx src/operations/leaderboardCoverage.ts` from backend. It performs aggregate SELECTs only, prints no connection credentials, and rolls back. The database driver emitted an existing SSL-mode future-behavior warning; database connection configuration was not changed.

## Historic QA result and rollout

The task identifies Hazel's approved Lion result as 03:15 with 350 XP and 300 Synapse Points, from an authorized QA approval supported by a shorter recording. This is a historic authorized review decision, **not independently verified competition evidence**. This change does not delete, reset, reassign, reverse or modify that result, reward snapshot/transactions, Player ID, physical claim or leaderboard entry. Public page copy says approved solve times. Any official-launch exclusion of QA results needs a future explicit, audited administrative action; no automatic filtering or reversal is implemented here.

No schema migration, new reward system or configuration variable is required. Submission input is unchanged: existing and added tests confirm numeric sanitization, 0315/0429 formatting, invalid/partial seconds, paste/deletion/caret handling, numeric mobile keyboard and millisecond precision. Cloudinary, manual-review timing policy, first-approved reward uniqueness, personal-best writes, admin settings and inventory are preserved.

After an authorized deployment, live browser verification is still required for leaderboard navigation/profile modal, mobile layout, exact external links and owned Best/Rank refresh. Automated/local builds are not production sign-off.

## Validation

Real SQL/PGlite regressions exercise multiple designs at Levels 1/6, current configuration eligibility, rank beyond top ten, exact tie-breaks, independent/canonical boards, two-query ownership loading, pending/rejected exclusion and read-only coverage. Frontend regressions cover selectors, on-demand requests, exact links, empty categories, keyboard navigation, existing modal, retries/stale requests, newly enabled designs, owned/detail refresh and unchanged time input. Full validation results are recorded in the delivery report.


Final local checks: backend 948/948 tests across 49 files; frontend 222/222 tests. Both lint checks, backend typecheck/build and frontend standalone tsc --noEmit/standard Next.js production build passed. All 45 pages generated. The final ranking regressions also passed 8/8 after the ownership mapping readability update. Frontend build used isolated output/two workers and system certificate trust for existing Google Fonts downloads, with certificate verification enabled. git diff --check passed; next-env.d.ts remains excluded.

## Exact changed files

- `backend/src/domain/leaderboards.ts`
- `backend/src/domain/puzzles.ts`
- `backend/src/http/app.ts`
- `backend/src/operations/leaderboardCoverage.ts`
- `backend/tests/leaderboardOwnership.test.ts`
- `docs/API_CONTRACTS.md`
- `docs/LEADERBOARD_LEVELS_CIRCZLES_RANKING.md`
- `package.json`
- `src/app/leaderboard/page.tsx`
- `src/components/leaderboard/LeaderboardExplorer.tsx`
- `src/components/leaderboard/leaderboard.test.mjs`
- `src/components/puzzles/PremiumPuzzleCard.tsx`
- `src/components/puzzles/PuzzleCollectionExplorer.tsx`
- `src/components/puzzles/PuzzleDetailExplorer.tsx`
- `src/components/puzzles/cards.tsx`
- `src/lib/apiClient.ts`
- `src/types/index.ts`
