# Phase C1.1 Rank UI Result

## Status

Phase C1.1 is a frontend-only presentation refinement. Rank names, order, progression levels, XP thresholds, rank detection, and backend authority are unchanged.

## Wording

The production progression dialog now uses:

- Kicker: `Progression`
- Title: `Ranks`
- Accessible dialog label: `Progression ranks`

The internal component filename remains implementation detail; `Codex` is no longer visible in the production rank dialog.

## Rank Visual Hierarchy

Rank presentation is centralized in `src/config/rankVisualHierarchy.ts`. The nine ranks map to five normalized visual tiers:

| Rank | Tier | Treatment |
| --- | ---: | --- |
| Peasant | 1 | Restrained surface, quiet silver edge, no continuous motion |
| Farmer | 1 | Soft green edge and a very small current-state breath |
| Squire | 2 | Blue-steel halo and measured current-state breathing |
| Knight | 2 | Stronger aqua edge with a slow, low-opacity sheen |
| Apprentice | 3 | Violet/aqua aura with slow breathing and sheen |
| Nobleman | 3 | Warm gold rim with a restrained shimmer |
| Master | 4 | Layered premium aura, slow pulse, sheen, and subtle radial energy |
| Hero | 4 | Warm gold/red energy, controlled radial motion, and light sweep |
| Conqueror | 5 | Strongest gold/aqua halo, very slow radial rotation, sheen, and three restrained sparks |

The treatment is reusable rather than nine separate animation implementations. Each rendered emblem exposes its visual tier and progression state as data attributes for inspection.

## State And Motion Rules

- `CURRENT`: receives the configured tier treatment. Continuous effects remain slow and low-opacity.
- `COMPLETED`: receives a polished static halo and border without strong ongoing animation.
- `LOCKED`: remains muted, grayscale, desaturated, and static with a visible lock indicator.
- Selecting a rank updates the left preview while preserving the authoritative completed/current/locked state derived from rank order.
- System `prefers-reduced-motion` and the saved in-app Reduced Motion setting both disable floating, breathing, sheen, rotation, and spark animation. Static color, halo, and border hierarchy remain visible.

## Rank And Achievement Separation

Ranks continue to use the dedicated replaceable paths under `/ranks/<rank>/emblem.svg` through `rankEmblem()`. The rank dialog does not import or use `BADGE_ICON`, `AchievementBadge`, or `ACHIEVEMENT_CATALOG`. Achievement badges remain a separate product system.

The current SVG artwork is intentionally replaceable at the same paths. No random or generated rank artwork was added to component code.

## Layout

- The left preview has a bounded, intentional emblem stage with the aura behind the artwork and no text overlap.
- The right list keeps all nine ranks selectable and gives higher ranks a subtle identity tint without making locked ranks look active.
- Under 390px, each row moves its state chip beneath the rank details. The list uses shrink-safe grid tracks and the modal uses a `92dvh` bounded internal scroll region.
- The modal remains centered and balanced on desktop while fitting 320px, 360px, 390px, and 430px-class widths without introducing page-level horizontal overflow.

## Files Changed

- `src/config/rankVisualHierarchy.ts`
- `src/components/progression/RankEmblem.tsx`
- `src/components/progression/ProgressionCodex.tsx`
- `docs/PHASE_C1_1_RANK_UI_RESULT.md`

## Validation

- All nine configured ranks remain rendered from `progressionRanks`.
- Current/completed/locked state calculation remains unchanged.
- Rank selection still updates the preview.
- Reduced-motion behavior is guarded by both system and saved application preference.
- Responsive grid and scroll behavior was reviewed for 320px, 360px, 390px, 430px, and desktop constraints.
- `npm run lint`: passed.
- `npm run build`: passed, including Next.js TypeScript checking and production prerender.
- `git diff --check`: passed.

No backend file, migration, database state, auth/session behavior, XP calculation, rank threshold, Admin behavior, Rewards data, or protected stash was changed.
