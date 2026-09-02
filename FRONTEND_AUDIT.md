# CircZles Player Hub V2 Frontend Audit

Date: 2026-09-01

## 1. Architecture Checked

Inspected `package.json`, `src/app`, `src/components`, `src/features`, `src/services`, `src/mocks`, `src/types`, `src/config`, `src/hooks`, `src/lib`, `public`, `README.md`, and `.env.example`.

The app uses Next.js App Router with server-rendered pages by default. Interactive behavior is isolated to `src/components/Interactive.tsx`, `src/app/error.tsx`, and `src/hooks/useSound.ts`.

Largest source files after audit:

- `src/components/ui.tsx` - shared shell/cards/table components.
- `src/mocks/data.ts` - mock data behind the service boundary.
- `src/components/Interactive.tsx` - client-only tabs, nav active state, mock actions, submission stepper, reward wheel.
- `src/types/index.ts` - shared domain contracts.
- `src/services/index.ts` - replaceable Promise-based mock service facade.

No final HTML monolith exists. No route file embeds large static mock arrays.

## 2. Routes Checked

HTTP smoke checks against `http://localhost:3000` returned `200` for all required routes:

- Public: `/`, `/how-it-works`, `/leaderboard`, `/rewards`, `/login`, `/signup`
- Player: `/hub`, `/puzzles`, `/puzzles/puzzle-1`, `/submissions`, `/submissions/new`, `/submissions/sub-1`, `/missions`, `/inventory`, `/coupons`, `/activity`, `/profile`, `/profile/CZ-8F42KD`, `/friends`, `/friends/search`, `/friends/requests`, `/notifications`, `/settings`
- Future: `/seasons`, `/seasons/season-2026-monsoon`, `/achievements`, `/chat`
- Admin: `/admin`, `/admin/players`, `/admin/submissions`, `/admin/puzzles`, `/admin/missions`, `/admin/rewards`, `/admin/store`, `/admin/progression`, `/admin/leaderboards`, `/admin/seasons`, `/admin/notifications`, `/admin/audit-log`

Added route-level loading/error coverage:

- `src/app/loading.tsx`
- `src/app/error.tsx`
- dynamic loading files for puzzle, submission, profile, and season details
- `src/app/admin/loading.tsx`

## 3. levelId Audit

Search confirmed no `levelNumber` usage.

`levelId` is used only for puzzle difficulty/challenge contexts:

- `Puzzle.levelId`
- `PlayerPuzzle.levelId`
- `Submission.levelId`
- `LeaderboardFilter.levelId`
- `LeaderboardEntry.levelId`
- puzzle cards/details, submission details, leaderboard rows, admin puzzle/submission review

## 4. progressionLevel Audit

`progressionLevel` is used only for player XP/RPG progression:

- `Player.progressionLevel`
- `ProgressionLevel.progressionLevel`
- `progressionMap`
- player summary/profile/admin progression views

No progression data uses `levelId` ambiguously.

## 5. Player Identity Audit

The frontend distinguishes:

- `internalId` - immutable internal technical ID in mock player data.
- `publicPlayerId` - immutable searchable public player ID.
- `displayName` - renameable player name.

`playerService.renameDisplayName(displayName)` returns a player with only `displayName` changed. It does not change `internalId` or `publicPlayerId`.

## 6. Mission Architecture

Missions are data-driven through `MissionCard` and mission objects. There are no specialized mission components like `DailyLoginMission`.

Fixed mission schema to include:

- `missionId`
- `title`
- `description`
- `category`
- `progress.current`
- `progress.target`
- `rewards`
- `startAt`
- `endAt`
- `status`
- `claimable`

Supported categories and reward types are typed in `src/types/index.ts`.

## 7. Service Architecture

Feature/player pages use `src/services`.

Found and fixed direct admin imports from `src/mocks/data`. Admin pages now call `adminService` methods:

- `getPlayers`
- `getSubmissions`
- `getPuzzles`
- `getMissions`
- `getStoreItems`
- `getLeaderboardEntries`
- `getCurrentSeason`
- `getNotifications`

The only remaining `src/mocks/data` import is inside `src/services/index.ts`.

## 8. Wheel Authority

No `Math.random()` exists in frontend components.

`RewardWheel` calls `rewardService.spinWheel()` and animates to `wheelSegmentIndex` from the service response. The mock service represents the future backend authority boundary.

## 9. Performance Findings

Search results:

- No `transition-all`
- No `duration-500`, `duration-700`, or `duration-1000`
- No `setInterval`
- No component-side artificial navigation or tab delays
- One `setTimeout` exists only inside `src/services/mockRuntime.ts`

Tabs update local state immediately. Buttons update labels before awaiting service calls where relevant. Main navigation uses Next `<Link>`.

Added global `prefers-reduced-motion` CSS handling.

## 10. Typography

`src/app/layout.tsx` configures:

- Rajdhani for major headings, rank/stat numbers, game presentation.
- Inter for body, navigation, buttons, forms, tables, metadata.

Both fonts use `display: "swap"` and explicit fallbacks.

## 11. Responsive Findings

Static inspection confirms:

- Mobile bottom navigation uses fixed safe-area padding.
- Desktop uses sidebar navigation.
- Main page containers use responsive max widths and grids.
- Leaderboard rows collapse to stacked mobile rows instead of squeezing desktop columns.
- Store, inventory, missions, puzzles, and admin lists use responsive grids/flex wrapping.

Attempted in-app browser visual inspection, but the browser connector failed during setup because the runtime reported missing sandbox metadata. Playwright is not installed locally, so final responsive validation was limited to HTTP render checks and code/CSS inspection.

## 12. Issues Fixed

1. Admin pages directly imported mock arrays.
2. Mission schema lacked `missionId`, `startAt`, `endAt`, and `claimable`.
3. Mission consumers used generic `id` instead of `missionId`.
4. Navigation lacked active route state.
5. Initial active nav implementation passed component functions across a server/client boundary, causing a production build failure.
6. Missing route loading/error conventions for future API latency.
7. Missing required asset folders for badges, frames, ranks, and sounds.
8. Login/signup/settings/Add Puzzle inputs lacked explicit labels or aria labels.
9. Missing global reduced-motion handling.
10. Missed `puzzles` service import after admin service refactor.

## 13. Intentionally Mocked Features

- Authentication
- Backend APIs
- PostgreSQL/Supabase/Firebase/database
- Uploads and video storage
- Leaderboard rank calculation
- Mission validation
- Economy balances and purchase authority
- Reward wheel results
- Admin review persistence
- Chat/realtime networking

## 14. Build Result

`npm run build` passed after fixes.

The build generated 37 routes successfully.

## 15. Lint Result

`npm run lint` passed.

## 16. Deferred To Backend Phase

- Real auth bridge
- PostgreSQL schema and APIs
- Submission upload pipeline
- Leaderboard engine
- Mission engine
- Economy/wallet authority
- Social graph persistence
- Notifications delivery
- Realtime chat
- Wix migration integration
