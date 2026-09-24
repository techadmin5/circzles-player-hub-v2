# Phase C1 Production Data Audit

## Status

Phase C1 makes `NEXT_PUBLIC_DATA_MODE=api` fail closed: production pages use browser-authenticated APIs, show a neutral unavailable/empty state, or are hidden as deferred. Mock data remains available only in explicit mock/local mode. This work did not change backend behavior, schemas, provider configuration, or production data.

## Root Causes

1. App Router pages are server components, while the backend session is an HTTP-only browser cookie. Several pages called browser-oriented services during server rendering. The old `canUseBrowserApi()` check returned false on the server and silently selected mock data.
2. `/hub` explicitly loaded the mock player, leaderboard, activity, and season, so production looked populated even when no authoritative data existed.
3. Navigation exposed mock-only features and Admin to every authenticated player. The Admin layout used normal authentication but had no server-authoritative admin role check.
4. Avatar selection/upload was preview-only. Different components used initials, mock avatars, or the default asset independently.
5. Rewards category height followed item count, causing the wheel column and surrounding layout to move between tabs.
6. Hub grids and rows lacked consistent `min-width: 0` containment, allowing narrow viewports to inherit page-level horizontal overflow.

## Route Matrix

`REAL_API` means production content is loaded from an implemented API or is a non-demo local preference. `EMPTY_STATE` means the route is safe but the authoritative API or wiring is unavailable. `HIDDEN_DEFERRED` means it is also removed from production navigation.

| Route | Production Status | Data Source | Mock/Demo in API mode? | Authenticated player real? | Mobile readiness | Visible? / action |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | REAL_API | Static public content | No | N/A | Ready | Public |
| `/login` | REAL_API | Direct auth APIs | No | Session check is real | Ready | Public |
| `/signup` | REAL_API | Direct auth APIs | No | Session check is real | Ready | Public |
| `/auth/handoff` | REAL_API | Auth handoff API | No | Yes | Ready | Auth callback only |
| `/hub` | REAL_API | Session, puzzles, missions, leaderboard, wheel | No | Yes | C1 containment fixed at 320/360/390/430px and tablet CSS breakpoints | Primary nav |
| `/puzzles` | REAL_API | `GET /api/me/puzzles`, claim API | No | Yes | Ready | Primary nav |
| `/puzzles/[id]` | REAL_API | Puzzle and submission APIs | No | Yes | Stats stack below 390px | Linked detail |
| `/submissions` | REAL_API | `GET /api/submissions` | No | Yes | Ready | Primary nav |
| `/submissions/new` | REAL_API | Owned puzzles, upload, create APIs | No | Yes | Ready | Linked action |
| `/submissions/[id]` | REAL_API | `GET /api/submissions/:id` | No | Yes | Ready | Linked detail |
| `/leaderboard` | REAL_API | Catalog, leaderboard, public-profile APIs | No | Yes | Existing compact mobile board | Primary nav |
| `/missions` | REAL_API | Mission list and claim APIs | No | Yes | Ready | Primary nav |
| `/rewards` | REAL_API | Store, purchase, wheel APIs | No | Yes | Tabs internally scroll; content has stable minimum height | Primary nav |
| `/inventory` | REAL_API | Inventory/equipment/rename APIs | No | Yes | Ready | Primary nav |
| `/profile` | REAL_API | Session and owned-puzzle APIs | No | Yes | Rows stack at narrow widths | Primary nav |
| `/profile/[playerId]` | REAL_API | Public profile API | No | Shell session is real | Header stacks below 430px | Linked from leaderboard |
| `/settings` | REAL_API | Browser-persisted sound/motion preferences | No | Yes | Ready | Profile form hidden until a real profile API exists |
| `/coupons` | EMPTY_STATE / HIDDEN_DEFERRED | Backend API exists; frontend not wired | No | Yes | Safe state | Hidden |
| `/seasons`, `/seasons/[id]` | EMPTY_STATE / HIDDEN_DEFERRED | No production season API | No | Yes | Safe state | Hidden |
| `/achievements` | EMPTY_STATE / HIDDEN_DEFERRED | No persistent achievements API | No | Yes | Safe state | Hidden |
| `/activity` | EMPTY_STATE / HIDDEN_DEFERRED | No activity-feed API | No | Yes | Safe state | Hidden |
| `/friends`, `/friends/search`, `/friends/requests` | EMPTY_STATE / HIDDEN_DEFERRED | No friendship APIs | No | Yes | Safe state | Hidden |
| `/notifications` | EMPTY_STATE / HIDDEN_DEFERRED | No notification API | No | Yes | Safe state | Hidden |
| `/chat` | EMPTY_STATE / HIDDEN_DEFERRED | No messaging API | No | Yes | Safe state | Hidden |
| `/admin` and subroutes | HIDDEN_DEFERRED | Mock admin screens; some review APIs exist | Layout blocks mock UI | Session only, not admin authority | Safe unavailable state | Hidden; launch blocker |
| `/ui-lab`, `/ui-lab/game-feel` | HIDDEN_DEFERRED | Local mock presentation data | Not available in production | N/A | Development only | Production 404 |

## Production Cleanup

- `/hub` no longer loads `getMockCurrentPlayer()`, `getMockLeaderboard()`, mock activity, or mock season data in API mode.
- Authenticated identity comes from the global `/api/auth/session` check and `/api/me`; private feature calls run in client components so the browser session cookie is included.
- API-backed services now throw when accidentally invoked on the server in API mode instead of falling through to mock arrays.
- Development Login and session diagnostics render only when `NODE_ENV=development` and data mode is `api`.
- Mock-only navigation entries, notification affordances, and Admin links are hidden in API mode.
- Deferred direct routes render neutral states and do not call their mock services.
- The inactive profile form is hidden in API mode. Sound, volume, and reduced-motion settings remain local browser preferences.
- Unsupported Hub season, activity, personal-best claims, and status copy were removed. Unsupported metrics say unavailable rather than displaying zero as real data.
- Rank reward previews are hidden in API mode because their reward values are not backend-authoritative.

## Real APIs Used

Production UI now uses the existing session/profile, owned puzzle and claim, submission/upload, leaderboard/public profile, mission/claim, Store/purchase, Reward Wheel/spin, Inventory/equipment, and Rename Card APIs. Coupon ownership (`GET /api/me/coupons`) is implemented in the backend but remains intentionally unwired in C1.

## Empty And Deferred Features

Seasons, achievements, activity, friends/search/requests, notifications, chat, coupons UI, and the Admin Control Center are absent from production navigation. Their direct routes do not present demo content. The feature source remains for local mock-mode design work.

## Mobile Findings

- The application content column, Hub sections, API cards, leaderboard rows, and puzzle grids now use `min-w-0` containment.
- The page shell clips accidental page-level x overflow; intentionally wide tab sets retain controlled internal horizontal scrolling.
- Hub leaderboard rows use a bounded rank/name/time grid with truncation and a non-wrapping time.
- Puzzle-detail stats stack at 320/360px-class widths and expand from 390px.
- Public/profile headers stack on narrow screens. The six-item bottom navigation remains fixed and usable.
- C1 checked responsive constraints at approximately 320, 360, 390, 430, and tablet breakpoints in code. A full device/browser visual matrix remains C4.

## Auth Transition Findings

`AuthenticatedRoute` redirects only after status becomes `unauthenticated`; while status is `checking`, it renders a neutral busy shell. A valid session remains on the requested protected route. `/login` redirects an already authenticated session to `returnTo`, and Google OAuth starts only after an explicit user action. No cookie/session security was changed.

The reported brief login screen can still occur when navigation reaches `/login` before the client session check resolves, because auth is currently client-established after hydration. C2 should add a coordinated auth transition/loading boundary and prevent public auth form paint while status is `checking`, without restarting OAuth or weakening the HTTP-only session model.

## Avatar Findings

`/api/me` adaptation, the shell, profile views, leaderboard identities, and public-profile fallbacks now consistently use `/brand/avatar.svg` when no authoritative avatar URL exists. API mode does not expose the preview-only avatar picker.

Avatar persistence is not implemented. C3 requires: an authoritative selected-avatar/media reference on the player profile; allow-listed built-in avatar selection; authenticated read/update APIs; signed image upload plus backend provider verification for custom photos; size/type/content validation; replacement/deletion lifecycle; `/api/me` and public-profile DTO fields; inventory/equipment integration where applicable; and cross-device tests. No browser-supplied URL should become authoritative directly.

## Rewards Findings

Store and wheel remain API-backed. The Store board now has a stable minimum content height, empty categories occupy a balanced panel, and the parent grid uses shrink-safe tracks so the wheel column does not jump or force page overflow.

The visible `3H Development Smoke Wheel` and `3I Development Smoke Coupon` originate from Development database smoke setup documented in Phase 3H/3I result files, not frontend mocks. There is no reliable production-safe test-data marker in the public DTO, so C1 does not hide records by name and does not mutate data. Before launch, an authorized operator must review/deactivate or remove Development-only wheel, listing, reward-definition, and coupon records in the intended environment using audited admin/database procedures.

## Admin Security Findings

The current frontend Admin tree has no authoritative role gate. Normal `AuthenticatedRoute` proves only that a player session exists. C1 hides Admin navigation and replaces the production Admin layout with an unavailable screen, but this is containment, not authorization.

Phase D must introduce server-side admin roles/status, a protected admin-session or authorization check on every admin API, least-privilege actions, audit attribution, and frontend role-derived visibility. Ordinary players must receive 403 for admin APIs regardless of route visibility. TOTP/authenticator-app support can follow role authorization. Phase E can then build the real Admin Control Center.

## Manual Follow-Ups

1. Review and clean Development smoke Store, wheel, reward, inventory, and coupon records before exposing Rewards publicly. Do not use frontend string filters as cleanup.
2. C2: stabilize auth/session transition and suppress auth-form paint while session status is checking.
3. C3: implement authoritative avatar/profile persistence and secure photo uploads.
4. C4: run a full responsive/device/accessibility audit across supported routes and browsers.
5. C5: complete rewards production-data cleanup and operational catalog controls if still required.
6. D: implement server-authoritative Admin role security, then optional TOTP.
7. E: replace mock Admin screens with the authorized Admin Control Center.
8. Wire the existing coupon ownership API in a later scoped phase.

## Validation Boundary

No frontend test command exists in the root package. C1 therefore uses ESLint, the Next.js production build/typecheck, static route/data-source inspection, and `git diff --check`. Backend code was not changed, so backend tests are not required for this phase. No migration, database command, database/provider access, deployment, or external runtime call was performed.
