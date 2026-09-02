# ADR-002: Separate Users And Players

## Status

Accepted for backend blueprint.

## Decision

Use `users` for authentication/account ownership and `players` for game identity.

## Rationale

`users` needs Wix member mapping, sessions, email, account status, and admin role linkage. `players` needs `publicPlayerId`, `displayName`, progression, profile, region, and social identity.

## Consequences

Rename Card mutates `players.display_name` only. It never changes `users.user_id`, `players.player_id`, `public_player_id`, or `wix_member_id`.
