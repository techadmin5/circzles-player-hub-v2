# Phase 3E-F Result

## Scope

Phase 3E-F adds an authenticated, compact public player profile opened directly from leaderboard entries. It does not add full profile navigation, social actions, editable profiles, cosmetic systems, or Lottie effects.

## Public Profile API

`GET /api/players/:publicPlayerId/public-profile` requires a valid player session and validates the public ID before lookup. The repository joins only active users and looks up the target using `publicPlayerId`.

The exact response fields are:

- `publicPlayerId`
- `displayName`
- `progressionRank`
- `approvedPuzzlesSolved`
- `avatarUrl`
- `equippedFrame`
- `displayedBadges`

Unknown, suspended, or deleted players do not produce profiles and return `PLAYER_NOT_FOUND`.

## Approved Puzzle Count

`approvedPuzzlesSolved` is an authoritative count of distinct canonical `puzzleId` values from the player's approved submissions. Multiple approved attempts for one puzzle count once. Pending, rejected, and resubmission-required submissions are excluded.

## Privacy

The response excludes email, Wix member identity, internal user and player IDs, session data, admin data, XP transaction history, wallet balance, and private location. The route does not accept internal IDs.

The current schema has no authoritative avatar, equipped-frame, or displayed-badge system. API responses therefore return `avatarUrl: null`, `equippedFrame: null`, and `displayedBadges: []`. No Starter Frame, avatar URL, or badge is invented.

## Leaderboard Popup

Top-three cards, Top-10 rows, and the separate current-player rank row are semantic buttons that open the same compact profile dialog without navigating away.

The dialog:

- displays public identity, progression rank, and approved puzzle count
- uses neutral initials when no authoritative avatar exists
- omits an equipped-frame claim when none exists
- shows a quiet empty badge state
- closes by close button, Escape, or backdrop
- traps focus, restores prior focus, and prevents background page scrolling
- provides loading, friendly error, and retry states
- cancels stale requests
- caches loaded profiles only within the mounted leaderboard explorer session

In API mode the browser performs the request through the existing client with `credentials: "include"`. Mock mode returns the same safe DTO shape with null cosmetics.

## Deferred Work

Public profile editing, social controls, authoritative cosmetics, and full profile pages remain out of scope. Phase 3E-G Lottie podium treatments remain deferred.

No database migration was created or run.
