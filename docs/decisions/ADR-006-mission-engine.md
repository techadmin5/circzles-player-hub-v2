# ADR-006: Event-Driven Mission Engine

## Status

Accepted for backend blueprint.

## Decision

Use data-driven mission definitions, rules, rewards, and player progress evaluated from game events.

## Rationale

New missions should not require application-code edits. Events provide a common input for missions, activity, notifications, and future realtime.

## Consequences

Mission claims must be idempotent and period-aware. Mission rewards are granted only by backend transactions.
