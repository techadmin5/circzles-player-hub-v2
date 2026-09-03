# CircZles Player Hub V2 — PRD

## Problem statement
Build the premium player-facing frontend for CircZles (a phygital puzzle ecosystem): own a physical puzzle → add via SKU → solve → submit → verify → earn XP + Synapse Points → leaderboards, missions, ranks, rewards. Combine the approved `/ui-lab` premium visual direction with the COMPLETE existing feature set. Preserve backend (Fastify + Drizzle + Neon Postgres), `/api/me` identity/session, service layer, and mock systems. Do NOT redesign Admin in this pass.

## Architecture (unchanged foundation)
- Next.js App Router (v16) + TypeScript + Tailwind v4 + framer-motion + lucide-react + zustand.
- Backend `/app/backend` (Fastify/Drizzle/Neon) — UNTOUCHED. Only identity (`/api/me`, dev login, sessions) is real.
- Service layer `src/services` + `src/lib/apiClient` + `src/config/dataMode` — UNTOUCHED (swap seam preserved). `NEXT_PUBLIC_DATA_MODE=mock`.
- Domain types `src/types` — UNCHANGED. Domain rules respected: puzzleId (identity), levelId (difficulty, never renamed), progressionLevel (XP), leaderboard placement (#1/#2/#3), achievement badges separate. 9 ranks Peasant→Conqueror kept in order; XP/rewards remain config-driven placeholders in `src/config/progression.ts`.

## Runtime
- Served on :3000 by supervisor `frontend` program via persistent shim `/app/frontend/package.json` (`next start`). `.next` build lives in `/app`.
- Validation: `yarn lint` clean; `yarn build` passes (38 routes). All 30 checked routes return 200 (incl. untouched `/admin/*` and `/ui-lab`).

## What's been implemented (2026-09-03 — Player Frontend Build)
- Promoted `/ui-lab` premium language into a canonical design system in `globals.css` (`--cz-*` tokens, surfaces, buttons, chips, tracks, grain) while keeping legacy classes for admin/public/ui-lab.
- Shared shell `components/game-shell/GameShell.tsx`: desktop sidebar (14 nav + Settings + Admin), topbar (SP, notifications, avatar), mobile bottom nav (5 + More) with premium More bottom sheet. Real Next Link + pathname active state.
- Player identity: `AvatarFrame` (avatar+frame+optional placement badge), `RankChip`, `PlayerIdentityPanel`/`PlayerHero` (preserves real `/api/me` + dev login in api mode), Progression Codex modal, Avatar Picker (CircZles/Unlocked/My Photo preview-only), config-driven replaceable asset maps `src/config/assets.ts`.
- Redesigned all player routes: hub, puzzles (+[id], Add Puzzle SKU), submissions (+new stepper, +[id]), leaderboard (podium + placement medals + filters), missions (categories/states/claim), rewards store (rarity) + premium dark-metallic service-authoritative reward wheel, inventory locker, coupons, seasons (+[id]), achievements (rarity), activity timeline, friends (+search, +requests), notifications, profile (+public [playerId]), settings (sound/motion via zustand), chat (Coming Soon), public landing/login/signup/how-it-works (Wix identity direction preserved).
- Sound architecture upgraded: 20 event hooks + replaceable file map (`config/sounds.ts`), graceful no-op on missing files, wired across nav/tabs/buttons/modals/claims/purchases/wheel; Settings controls master/effects/reduced-motion/notifications.
- Loading/empty/error states in premium language.

## Still mocked (backend to replace later — via existing service layer)
gameplay XP state, Synapse economy, puzzle ownership, submissions, leaderboards, missions, store, reward-wheel result, inventory, coupons, activity, achievements, seasons, friends, notifications, admin gameplay data.

## Intentionally deferred (not in this pass)
Admin redesign; realtime chat; real Cloudinary/media upload; Wix auth handoff wiring; final art assets (rank emblems, badges, frames, avatars) — architecture is drop-in replaceable.

## Mobile responsive pass (2026-09-03)
- Root cause of Hub hero overflow: top wrappers used implicit `auto` grid column. Fixed `/hub` + `/profile` wrappers to `grid grid-cols-1` (minmax(0,1fr)); hero `<section>` now `w-full min-w-0 overflow-hidden`; inner flex row `min-w-0`; stat row 2-col grid + truncating MiniStats on mobile.
- Reward wheel responsive `w-[min(300px,82vw)]`; mobile bottom-nav labels truncate; Progression Codex single-column + scroll on mobile; store cards `aspect-[16/9] sm:aspect-square`; `html` overflow-x hidden.
- Verified by testing_agent (iteration_2.json): hero fits at 360/390/430 on /hub + /profile; all 9 mobile routes overflow-clean; desktop 1280 unaffected. 100% pass.

## Backlog / next
- P1: Admin premium redesign pass.
- P1: Wire real APIs per system as backend lands (swap mock service internals only).
- P2: Real media upload in submission stepper; chat realtime; final artwork drop-in.
