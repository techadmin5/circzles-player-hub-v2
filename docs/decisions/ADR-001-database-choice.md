# ADR-001: PostgreSQL As Authoritative Game Database

## Status

Accepted for backend blueprint.

## Decision

Use PostgreSQL as the authoritative V2 game-state database.

## Rationale

CircZles needs relational integrity for players, puzzle ownership, submissions, ledgers, missions, leaderboards, inventory, coupons, and admin audits. PostgreSQL supports transactions, constraints, indexes, JSON metadata where useful, and migration tooling.

## Consequences

Wix CMS becomes a migration source and optional integration point, not the long-term source of truth.
