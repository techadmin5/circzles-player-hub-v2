# Per-CircZles leaderboard timing

The catalog defaults to ACTIVE. All statuses, DRAFT and ARCHIVED remain available. The name and Edit button open the same details editor, with Basic Information, Leaderboard Configuration and Manufacturing Batches sections.

Maximum Leaderboard Time accepts whole non-negative minutes and seconds (0?59), with a positive total. Both blank, or Clear / Not configured followed by Save Changes, stores NULL. Examples: 5:00 = 300000 ms; 2:30 = 150000 ms; 0:45 = 45000 ms. Malformed, fractional, negative, zero and PostgreSQL integer-overflow values are rejected. The list displays MM:SS or Not set.

Storage is `puzzle_competition_settings.max_leaderboard_time_ms`, keyed uniquely by `puzzle_id`, exposed as `maxLeaderboardTimeMs` on catalog list/detail/update responses. It is not stored on manufacturing batches. Shared canonical R2/R3 batches inherit one value; different playable configurations remain independent. Accessories and incomplete drafts without a playable puzzle cannot receive timing. Archived playable entries can be viewed/edited without reactivation.

Migration `0025_catalog_max_leaderboard_time.sql` adds the nullable positive integer and its CHECK. It performs no backfill. Category and display order previously had mandatory values without business defaults. To safely store timing for puzzles with no competition configuration, this migration allows both to be NULL together. A CHECK requires such timing-only rows to have leaderboard/reward flags false and zero rewards. Existing configured rows retain their category/order, flags, rewards and timestamps: catalog upserts update only the timing column on conflict. Competition configuration reads treat timing-only rows as absent, preserving the existing missing-configuration behavior. Leaderboard navigation continues to require leaderboard_enabled; the CHECK prevents a timing-only row from being enabled. Existing competition settings upserts can later supply the required category/order without overwriting timing.

All edits use existing server-side CATALOG_MANAGE authorization, origin/proxy/session protections, and the catalog management transaction/advisory lock. A failed metadata edit rolls the timing write back. Timing-only requests leave catalog/puzzle/manufacturing records unchanged. Saving unchanged archive status does not rewrite batches.

Future integration: backend eligibility logic may compare a verified submission completion time and/or verified video duration against this value. This change only stores configuration; it does not enforce timing, reject submissions, change global completion/video/upload limits, or affect XP/SP and player progression. NULL means unconfigured; no level-derived or universal threshold exists.

The migration has been exercised only in isolated test databases. Production migration, imports, repair, deployment and merge are separate operations and were not run for this feature.

## Validation

- Backend: `npm test -- --maxWorkers=2`: 894 tests in 46 files passed; lint, typecheck and build passed.
- Frontend: `npm test`: 197 tests passed; lint, `tsc --noEmit` and production build passed (45 pages generated).
- `git diff --check` passed.
- Coverage includes ACTIVE/default filters, Edit/name navigation, null/render/save/clear/reload, exact time conversion and invalid input, shared batches, independent puzzle timing, archive access, accessory/incomplete-draft rejection, existing settings/identity preservation, database constraints, rollback, management locking/concurrent saves, and unchanged server authorization protections. Full importer/auth/player/submission/leaderboard regressions passed.
