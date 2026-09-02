# ADR-003: Wix Relationship

## Status

Accepted for backend blueprint.

## Decision

Retain Wix for the existing website, member login bridge, and possible commerce/coupon integrations. Do not use Wix CMS as authoritative V2 game state.

## Rationale

The existing production system remains live while V2 is developed. V2 needs stronger transactional guarantees than Wix CMS should provide for game economy and leaderboards.

## Consequences

Migration tooling must preserve legacy IDs and reconcile known data inconsistencies.
