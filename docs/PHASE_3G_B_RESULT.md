# Phase 3G-B Result: Secure Synapse Point Store Purchases

## Scope

Phase 3G-B adds server-authoritative purchase identity, SP debit, purchase limits, immutable purchase history, idempotent replay, and `store.purchase.completed`. It does not add inventory, equip/use, Rename Card consumption, coupon redemption, Reward Wheel authority, Store administration, or Wix integration.

## Authority And Transaction

The browser supplies only a listing UUID, an empty JSON body, and an `Idempotency-Key`. The authenticated session supplies player identity. The backend re-reads the listing and reward definition, checks active state and the current availability window, derives price and purchase limit, and reads the locked wallet balance.

One PostgreSQL transaction uses this deterministic order: player/key advisory lock, exact-replay lookup, listing/reward shared row lock, player wallet row lock, completed-purchase count, optional SP debit, immutable purchase insert, and game-event insert. Wallet serialization prevents concurrent purchases by the same player from overspending or bypassing limits. Any later failure rolls back the debit and all purchase effects.

Exact same-player/key/listing replay returns the original purchase with `idempotent: true`. Reusing the player-scoped key for another listing returns `IDEMPOTENCY_CONFLICT`. Database uniqueness backs the application locking.

## Ledger And History

Paid purchases use `debitPointsInTransaction` with `STORE_PURCHASE` reason/source and link the immutable `store_purchases` row to the actual `point_transactions` debit. Price, reward identity, presentation fields, resulting balance, and purchase time are snapshotted for historical clarity.

Free purchases do not create bogus zero-SP ledger rows. Their nullable `point_transaction_id` remains null and balance is unchanged. A database check requires null linkage at zero price and non-null linkage at positive price. All purchase-history foreign keys are restrictive.

## API And Frontend Boundary

Authenticated `POST /api/rewards/store/:listingId/purchase` requires `{}` and a trimmed, non-empty `Idempotency-Key` of at most 200 characters. It returns stable purchase/reward snapshots, authoritative price and balance, purchase time, and replay status without metadata or player UUID.

The frontend API client includes `purchaseStoreListing(listingId, idempotencyKey)`. API-mode Buy remains disabled through the existing coming-soon state because Phase 3G-B creates purchase proof but not an inventory entitlement. No success sound is fabricated; real purchase UI waits for Phase 3G-C.

## Event And Migration

Each first successful purchase appends one `store.purchase.completed` event in the same transaction using `store.purchase.completed:<purchaseId>`. Its payload contains purchase/listing/reward identity, reward type, authoritative price, and resulting balance. Exact replay emits nothing new.

Migration `0012_early_the_hood.sql` adds `store_purchases` only. It is additive, schema-only, contains no drops or seed data, and was not run. No development wallet values or catalog records were changed.

Automated tests use fake repositories and a serialized transaction harness; they make no external calls. Concurrent retry and purchase-limit behavior was exercised in that harness, but live PostgreSQL concurrency was not integration-tested in this phase.
