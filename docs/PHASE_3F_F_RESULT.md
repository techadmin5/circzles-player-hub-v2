# Phase 3F-F Result

## Scope

Phase 3F-F integrates the supplied nine CircZles progression badges and Hub Lottie artwork into the frontend. Badge identity is resolved by normalized `rankName`, never by puzzle `levelId` or by treating `progressionLevel` as an artwork index. Unknown rank names fall back safely to Peasant artwork while retaining the supplied label.

## Progression Experience

`ProgressionBadge` centralizes artwork, rank aura/glow, a slow idle float, breathing light, and restrained high-rank particles. The level-up dialog shows the previous rank briefly, assembles five clipped copies of the new flat PNG, performs a short dimensional flip, then lands with scale overshoot and a radial impact wave. Reduced motion replaces travel, flip, vibration, and shockwave with a brief crossfade/scale reveal while preserving all information and actions.

The presentation-only reward model supports Synapse Points, badges, frames, avatars, Rename Cards, coupons, and items. Normal gameplay does not invent progression rewards and therefore shows only Okay. Okay dismisses presentation and never means rewards are forfeited. The development Game Feel Lab supplies local sample rewards and a local Collect Rewards callback; it makes no API or database request.

## Future Reward Contract

Progression level reached -> server records entitlement/reward grant -> player may dismiss Level Up without losing reward -> Collect Rewards is idempotent. Synapse Points use the point ledger; item, badge, frame, avatar, and Rename Card rewards go to inventory; coupons go to coupon ownership. Exclusive progression rewards do not need to be purchasable in the Store.

Admin will eventually configure XP requirements, rank metadata, badge/visual identity, rewards, and active status. No reward tables, inventory fulfillment, reward API, or real progression grant was added in this phase.

## Hub And Audio

The Hub metric strip uses `coin.json` for Synapse Points, `fire-streak-orange.json` for Puzzle Streak, and `fortune-wheel.json` for Rewards Wheel; `fire.json` remains a reusable alternate. API mode never fabricates streak or wheel authority and displays a neutral unavailable state. The active-mission area safely renders an empty state when the API returns no missions.

Optional `rankBuild`, `rankImpact`, `rankReveal`, and `rewardCollect` timing hooks were added to the central sound manifest. Their paths remain undefined, so they create no network requests. Approved audio files for those events, and all other currently pathless sound events, are still pending.

## Asset Mapping

- Peasant: `src/assets/progression/peasant.png`
- Farmer: `src/assets/progression/farmer.png`
- Squire: `src/assets/progression/squire.png`
- Knight: `src/assets/progression/knight.png`
- Apprentice: `src/assets/progression/apprentice.png`
- Nobleman: `src/assets/progression/nobleman.png`
- Master: `src/assets/progression/master.png`
- Hero: `src/assets/progression/hero.png`
- Conqueror: `src/assets/progression/conqueror.png`

## Authority

This phase changes frontend presentation only. It does not modify backend behavior, schemas, migrations, Neon, Wix, production, or progression reward authority.
