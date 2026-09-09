# Phase 3E-G Result

## Top-Three Effects

Phase 3E-G adds the required animated presentation to leaderboard placements one through three using the lightweight `lottie-react` package.

Animation logic is isolated in `LeaderboardPlacementEffect`. Only the Top-3 cards mount that component; standard ranks, outside-Top-10 player rows, loading states, error states, and empty states do not mount Lottie.

The final rank-specific asset mapping is:

- Rank #1 -> `src/assets/lottie/leaderboard/rank1.json`
- Rank #2 -> `src/assets/lottie/leaderboard/rank2.json`
- Rank #3 -> `src/assets/lottie/leaderboard/rank3.json`

The original colors in each Lottie are preserved. First place retains the strongest gold card emphasis, second place retains its silver treatment, and third place retains its bronze treatment.

All text and controls remain above the decorative layer. The effect is clipped to the card, cannot create page overflow, and uses `pointer-events: none`, `aria-hidden`, and no focusable controls.

## Visual Review

The leaderboard and public-profile experience has been visually reviewed on desktop and mobile. Mobile Top-3 cards use the approved compact layout, while preserving readable rank, player identity, and best-time information without interference from the Lottie artwork.

Leaderboard rows use a neutral initials avatar slot until authoritative avatar and equipped-frame data is available from the backend. The public-profile modal is centered on both desktop and mobile, sits above mobile navigation, and retains its high-contrast close control and responsive profile header.

A real friendship action remains deferred until a persistent Friends backend is implemented.

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
