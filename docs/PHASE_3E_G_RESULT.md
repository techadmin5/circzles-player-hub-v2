# Phase 3E-G Result

## Top-Three Effects

Phase 3E-G adds the required animated presentation to leaderboard placements one through three using the lightweight `lottie-react` package.

Animation logic is isolated in `LeaderboardPlacementEffect`. Only the Top-3 cards mount that component; standard ranks, outside-Top-10 player rows, loading states, error states, and empty states do not mount Lottie.

The visual hierarchy is intentionally distinct:

- First place has the largest and brightest gold orbit, strongest glow, and slightly taller desktop card.
- Second place has a smaller, quieter silver treatment.
- Third place has the lightest bronze treatment.

All text and controls remain above the decorative layer. The effect is clipped to the card, cannot create page overflow, and uses `pointer-events: none`, `aria-hidden`, and no focusable controls.

## Temporary Local Asset

`src/assets/lottie/leaderboard-energy.json` is a small, transparent, repository-owned temporary orbit-and-pulse animation. It contains no remote asset references or third-party artwork. Rank-specific presentation varies its scale, opacity, filtering, border, and shadow while reusing one animation payload.

Final branded Lottie artwork can replace this JSON file without changing leaderboard ranking, selection, or profile-popup logic.

## Motion And Performance

The existing Framer Motion `useReducedMotion` signal disables Lottie autoplay and looping when `prefers-reduced-motion` is enabled. Static rank-specific color, border, and glow styling remains, preserving the first/second/third hierarchy.

Lottie owns continuous animation without React timers or render loops. Only visible Top-3 entries instantiate renderers.

## Interaction Compatibility

Top-3 cards remain semantic buttons and continue to open the Phase 3E-F public player popup by mouse or keyboard. Their current-player You label and aqua focus treatment remain intact alongside the placement styling.

## Scope

No backend, public-profile contract, schema, database, migration, seed, or production behavior changed.

Phase 3E is now functionally complete:

- 3E-A competition configuration
- 3E-B admin review foundation
- 3E-C completion rewards
- 3E-D leaderboard backend and personal-best processing
- 3E-E leaderboard frontend
- 3E-F public player popup
- 3E-G Top-3 effects
