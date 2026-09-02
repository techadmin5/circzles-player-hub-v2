# Backend Implementation Plan

## Rule

Do not implement production backend code during blueprint phase.

## Recommended Order

1. Identity/auth proof of concept with Wix handoff token.
2. Backend project setup with Node.js, TypeScript, test framework, linting, config, request IDs.
3. PostgreSQL setup and migration tooling.
4. Core schema migrations for users, players, puzzles, sessions, wallets, progression.
5. Service-layer transaction helpers and idempotency middleware.
6. Core player API: `GET /api/me`, profiles, settings.
7. Wix migration extraction and dry-run tooling.
8. Puzzle catalog and player ownership APIs.
9. Video upload signed URL abstraction.
10. Submission creation and lifecycle APIs.
11. Admin submission review with idempotent approval.
12. Synapse Point ledger and wallet cache.
13. XP ledger and progression engine.
14. Leaderboard best-time model and query endpoints.
15. Game event table and mission evaluator.
16. Mission claim and reward-grant flows.
17. Reward definitions, store, purchase transactions.
18. Inventory equip/use flows and Rename Card consumption.
19. Reward wheel configuration and atomic spin.
20. Coupon ownership and optional Wix coupon bridge.
21. Activity event projector.
22. Notification persistence.
23. Friend requests, friendships, blocks, friends leaderboard filters.
24. Admin mission/store/season/player management.
25. Migration validation dashboard/reports.
26. Staging cutover rehearsal.
27. Production migration freeze/delta/cutover.
28. Realtime chat/social enhancements later.

## Test Priorities

- Auth bridge token replay prevention.
- Public player ID preservation.
- `levelId` derivation for migrated submissions.
- Point and XP ledger idempotency.
- Double-click purchase/spin/claim protection.
- Submission approval cannot award twice.
- Leaderboard rank correctness and tie behavior.
- Mission progress and period reset.
- Rename Card changes only `displayName`.
- Migration reconciliation counts.

## Frontend Compatibility Check

The future backend can replace `src/services` because current service methods are action-oriented. The backend should return DTOs shaped similarly to `src/types`, with richer internal data hidden from the client.

No frontend contract change is required before backend implementation, but adding `videoUploadId` to submission creation will be needed when real uploads begin.
