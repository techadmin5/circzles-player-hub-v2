# Phase C2.2: Rank Presentation Polish

## Status

Implemented on `phase-c2-2-rank-presentation-polish`. This phase changes progression presentation only. Rank authority, names, order, thresholds, XP calculations, authentication, backend behavior, and database state are unchanged.

## Why Normalization Was Required

The nine progression PNGs have different canvas sizes and substantially different transparent margins. Alpha-bound inspection found visible artwork ranging from about 49% of source height for Peasant, Farmer, Squire, and Knight to about 71% for Conqueror. Master is visually top-heavy, while Apprentice and Nobleman sit low in their source canvases. Rendering every complete PNG canvas at one raw size therefore made some badges look much smaller or off-center.

The source artwork remains untouched. `progressionVisuals.ts` now owns presentation scale and alignment for preview and list contexts.

## Scale Strategy

| Rank | Preview scale | List scale | Preview/list offset X | Preview/list offset Y |
| --- | ---: | ---: | ---: | ---: |
| Peasant | 1.36 | 1.55 | 0% | 0% |
| Farmer | 1.38 | 1.55 | 0% | 0% |
| Squire | 1.28 | 1.38 | -5.5% | 0% |
| Knight | 1.12 | 1.16 | 0% | 0% |
| Apprentice | 1.14 | 1.16 | 0% | -5.5% |
| Nobleman | 1.14 | 1.16 | 2% | -7% |
| Master | 1.42 | 1.42 | 1% | 10% |
| Hero | 1.14 | 1.12 | -1% | 1% |
| Conqueror | 1.08 | 1.06 | 1% | -1.5% |

These values normalize the 38px list slot to an apparent maximum artwork dimension of roughly 29px for every rank. The 150px preview stage intentionally grows visible maximum artwork from approximately 100px for Peasant to 116px for Conqueror, preserving controlled prestige growth without abrupt size jumps.

## Preview Containment

The selected-rank frame keeps fixed responsive dimensions: 160px high with a 240px width cap on small screens, then 176px high with a 260px cap from `sm` upward. The normalized badge renders on a separate 150px stage. Programmatic alpha-bound calculations place every rank's visible artwork at or below 116px in either dimension, leaving at least 17px of vertical clearance inside the smallest frame even before its wider horizontal clearance.

The frame uses `overflow-hidden` to contain aura and ring effects. The measured artwork bounds remain inside the frame, so source pixels are not clipped. The artwork keeps its intrinsic aspect ratio through `object-contain`.

## List Alignment

Every rank row retains the same 42px outer icon slot and 38px badge stage. Per-rank list scaling and offsets normalize the visible artwork to about 29px while preserving each badge's original proportions. Current rows keep a subtle rank-colored glow, completed rows remain full-color and static, and locked rows retain recognizable grayscale artwork with a small independent lock marker.

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

The badge artwork no longer bounces vertically. Current-rank motion is limited to slow aura breathing, a slow rotating energy ring from Squire upward, restrained 1-2px particle drift where configured, and tier-scaled frame breathing. Completed ranks keep static premium effects. Locked ranks remain static, mute only the artwork, and retain a faint underlying tier tint.

## Reduced Motion

Both `prefers-reduced-motion` and the application's reduced-motion setting disable aura breathing, ring rotation, frame breathing, and moving particles. Static aura, border, ring, normalized artwork, and prestige colors remain visible.

## Mobile And Scrolling

The smaller preview frame applies below 640px and remains centered without changing modal height. The existing single mobile modal scroll, independent desktop rank-list scroll, body scroll lock, and horizontal containment were preserved. All nine rows, including Conqueror, remain in the unchanged scroll region.

## Validation

- Inspected intrinsic dimensions and alpha bounds for all nine PNG assets.
- Verified preview and list containment mathematically from visible alpha bounds and configured transforms. Every preview returned `PreviewFits = true`; every row icon returned `ListFits = true`.
- Preview visible bounds range from `83x100px` for Peasant to `116x115px` for Conqueror inside the smallest `240x160px` frame.
- List artwork has a normalized maximum dimension of approximately `29px` inside every `42px` slot.
- `npm run lint`: passed.
- `npm run build`: passed, including TypeScript and all 40 application routes.
- `git diff --check`: passed.
