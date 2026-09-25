# Phase C1.2 - Hub Session Loading and Rank Presentation

## Status

Implemented and locally validated on `phase-c1-2-hub-loading-rank-fix`.

## Blank-Screen Root Cause

`AuthenticatedRoute` previously rendered an empty dark `div` while the authoritative `/api/auth/session` request was pending. A Render cold start therefore looked like a broken or blank Player Hub even though session verification was still active.

## Session Loading Experience

The checking state now renders `PlayerHubLoadingSkeleton`, which mirrors the Hub shell without displaying player data or loaded values. It includes desktop sidebar/top-bar placeholders, a mobile header and bottom navigation placeholder, a player-card placeholder, metric and content placeholders, and a compact fixed-height tip region.

Session tips are centralized in `SESSION_LOADING_TIPS`, rotate every 3.6 seconds, and use a restrained fade/vertical transition. Browser and saved reduced-motion preferences remove the sliding transition and disable skeleton pulse motion. The tip area reserves its height so changes do not shift the surrounding layout. No patent claim is included because no approved patent wording was found in repository product copy.

The loading shell exposes `aria-busy="true"` and an accessible session-check label. Decorative skeleton blocks are hidden from assistive technology; the current tip is exposed through one polite live region.

## Session Policy

Only `/api/auth/session` receives the new 20-second request timeout. A timeout, network failure, or server failure produces the recoverable `error` state and never marks the player unauthenticated. The retry action begins a fresh authoritative request and returns immediately to the loading skeleton.

Concurrent calls to `refresh()` share the active session promise, preventing duplicate initial checks and duplicate retry requests. The initial effect remains authoritative and does not cache a prior client-side login assumption.

Redirect behavior is state-specific:

- `checking`: display the skeleton and do not redirect.
- `authenticated`: render the requested protected route.
- authoritative HTTP `401`: set unauthenticated and redirect once to `/login?returnTo=<internal-path>`.
- transient `error`: display retry UI and do not redirect or initiate Google OAuth.

Login continues to present Google, email, and profile-creation choices. Login and signup now carry a sanitized internal `returnTo` through their links and provider calls; invalid, protocol-relative, cross-origin, or backslash-based values fall back to `/hub`.

## Rank Artwork

All nine canonical production assets now use the intended tracked artwork from `public/ui-lab/claude/ranks/`:

- `public/ranks/peasant/emblem.svg`
- `public/ranks/farmer/emblem.svg`
- `public/ranks/squire/emblem.svg`
- `public/ranks/knight/emblem.svg`
- `public/ranks/apprentice/emblem.svg`
- `public/ranks/nobleman/emblem.svg`
- `public/ranks/master/emblem.svg`
- `public/ranks/hero/emblem.svg`
- `public/ranks/conqueror/emblem.svg`

XML structure comparison confirmed each canonical asset matches its corresponding UI Lab source. The rank assets remain separate from achievement badges. C1.1 visual hierarchy, state treatment, animation progression, rank ordering, and progression thresholds are unchanged.

## Rank Modal Scrolling

The modal now has an explicit viewport-bounded height. Its header remains outside the scroll region. On desktop, the preview column stays fixed while the right rank list scrolls independently. On mobile, the single-column modal body scrolls as one internal region. Opening the modal locks body scrolling and restores the previous body overflow value when closed.

Local runtime checks confirmed all nine ranks render and Conqueror becomes visible at the end of both desktop and mobile internal scroll regions. The modal did not create horizontal overflow at 320 CSS pixels.

## Responsive Verification

The session skeleton was rendered with browser device-metric overrides at 320, 360, 390, 430, and 768 CSS pixels, plus desktop. At each requested mobile/tablet width, measured document width remained within the viewport. The player placeholder, two-column metric layout, stacked content, tip area, and fixed mobile navigation remained usable without page-level horizontal overflow.

## Validation

- `npm run lint`: passed.
- `npm run build`: passed with Next.js 16.3.4 production compilation and TypeScript checking.
- `git diff --check`: passed.
- Session tip rotation: passed at the configured 3.6-second interval.
- Session timeout and retry runtime probe: passed; timeout reached recoverable UI and retry restored checking UI.
- Authoritative 401 runtime probe: passed; redirected to `/login?returnTo=%2Fhub` and showed Google, email, and signup choices.
- Authenticated runtime probe: passed; remained on `/hub` and rendered authenticated player identity without login UI.
- Rank asset check: nine distinct canonical files, each XML-equivalent to its intended UI Lab source.
- Rank modal runtime probe: nine ranks present, desktop/mobile internal scrolling passed, Conqueror reachable, body locked, no mobile horizontal overflow.

The root frontend package does not currently define a test script or include a frontend unit-test runner, so no automated frontend unit suite was available in this focused phase. No new testing framework was introduced.

No backend, authentication-provider, cookie, CORS, database, migration, progression-authority, reward, or mock-data policy changes were made.
