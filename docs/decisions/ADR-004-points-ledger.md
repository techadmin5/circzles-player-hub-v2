# ADR-004: Synapse Point Ledger

## Status

Accepted for backend blueprint.

## Decision

Use immutable `point_transactions` as source of truth and `wallets.balance` as a transactional cache.

## Rationale

Synapse Points need auditability, duplicate reward prevention, admin corrections, and safe concurrent spending.

## Consequences

Never silently edit balances. Every point change creates a transaction with source and idempotency metadata.
