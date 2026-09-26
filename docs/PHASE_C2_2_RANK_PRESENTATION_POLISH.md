# Phase C2.2: Rank Presentation Polish

## Status

Implemented on `phase-c2-2-rank-presentation-polish`. This phase changes progression presentation only. Rank authority, names, order, thresholds, XP calculations, authentication, backend behavior, and database state are unchanged.

## Why Normalization Was Required

The nine progression PNGs have different canvas sizes and substantially different transparent margins. Alpha-bound inspection found visible artwork ranging from about 49% of source height for Peasant, Farmer, Squire, and Knight to about 71% for Conqueror. Master is visually top-heavy, while Apprentice and Nobleman sit low in their source canvases. Rendering every complete PNG canvas at one raw size therefore made some badges look much smaller or off-center.

The source artwork remains untouched. A scale-only normalization attempt still allowed the transparent source canvas to influence placement and was rejected during visual review. `progressionVisuals.ts` now records the measured visible alpha bounds for each rank, and `ProgressionBadge` crops only transparent padding before fitting the visible artwork into a common centered stage.

## Visible-Bounds Strategy

| Rank | Source canvas | Visible alpha bounds `(x, y, width, height)` |
| --- | --- | --- |
| Peasant | 300x484 | 52, 125, 196, 237 |
| Farmer | 279x462 | 45, 120, 189, 226 |
| Squire | 306x480 | 42, 124, 264, 235 |
| Knight | 375x480 | 31, 124, 314, 235 |
| Apprentice | 373x480 | 27, 124, 315, 287 |
| Nobleman | 395x480 | 31, 124, 316, 302 |
| Master | 391x500 | 74, 80, 239, 268 |
| Hero | 415x500 | 42, 90, 338, 314 |
| Conqueror | 482x500 | 59, 80, 358, 356 |

All preview artwork now uses the same centered 112px visible height. All row artwork uses the same centered 30px visible height. Width follows each badge's real visible aspect ratio; the widest case is Knight at about 150px in the preview and 40px in the row, both safely inside their containers. The crop wrapper removes transparent padding from layout calculations, so changing rank no longer changes the artwork center or lets the visible badge touch the frame.

## Preview Containment

The selected-rank frame keeps fixed responsive dimensions: 160px high with a 240px width cap on small screens, then 176px high with a 260px cap from `sm` upward. Every visible badge is exactly 112px high, leaving 24px of vertical clearance inside the smallest frame. Even the widest artwork remains at least 45px from each horizontal frame edge.

The frame uses `overflow-hidden` to contain aura and ring effects. Only measured transparent padding is cropped from the source image; the complete visible alpha bounds are retained. The artwork keeps its intrinsic aspect ratio and remains centered.

## List Alignment

Every rank row retains the same 42px outer icon slot. The complete visible artwork is centered at the same 30px height while preserving its original proportions; the widest artwork is about 40px and remains inside the slot. Current rows keep a subtle rank-colored glow, completed rows remain full-color and static, and locked rows retain recognizable grayscale artwork with a small independent lock marker.

## Prestige Hierarchy

`ProgressionVisual.prestigeLevel` now runs from 1 through 9:

1. Peasant: restrained warm aura; no ring or particles.
2. Farmer: slightly stronger blue aura; no ring or particles.
3. Squire: defined aura and slow light ring; no particles.
4. Knight: stronger metallic aura and slow ring.
5. Apprentice: richer warm energy with two tiny particles.
6. Nobleman: layered purple/pink halo with two tiny particles.
7. Master: gold layered halo, slow ring, and three particles.
8. Hero: stronger warm radial treatment and four restrained particles.
9. Conqueror: strongest gold/aqua layered treatment, slow ring, and five restrained sparks.

The badge artwork no longer bounces. The selected current badge has only a restrained 1px drift, slow aura breathing, a slow energy ring, and tier-scaled frame breathing. Higher configured tiers add tiny 1-2px particle drift. Completed ranks keep static premium effects. Locked ranks remain static, mute only the artwork, and retain a faint underlying tier tint.

## Reduced Motion

Both `prefers-reduced-motion` and the application's reduced-motion setting disable aura breathing, ring rotation, frame breathing, and moving particles. Static aura, border, ring, normalized artwork, and prestige colors remain visible.

## Mobile And Scrolling

The smaller preview frame applies below 640px and remains centered without changing modal height. The existing single mobile modal scroll, independent desktop rank-list scroll, body scroll lock, and horizontal containment were preserved. All nine rows, including Conqueror, remain in the unchanged scroll region.

## Validation

- Inspected intrinsic dimensions and alpha bounds for all nine PNG assets.
- Verified all measured alpha bounds are retained by the crop calculation.
- Every preview uses the same centered 112px visible height inside the smallest `240x160px` frame.
- Every row icon uses the same centered 30px visible height inside its `42px` slot.
- `npm run lint`: passed.
- `npm run build`: passed, including TypeScript and all 40 application routes.
- `git diff --check`: passed.
