# Phase 3F-E Result

## Feedback Architecture

`GameFeedbackProvider` is mounted once at the application root and exposes a reusable `useGameFeedback()` API. Reward requests enter a FIFO queue, so reveals cannot overlap. Each successful reward moves through the applicable stages: reward reveal, Synapse Point travel/count-up, XP progress, and conditional rank-up. Mission claims are the first real integration; future reward sources can submit the same authoritative before/after state contract.

The frontend starts reward feedback only after the claim API succeeds. The pre-request interaction uses only the generic button cue; mission, reward, SP, and XP cues are sequenced by the feedback provider after backend confirmation. Failures show concise error feedback and never animate or sound a received reward. Mission duplicate-click protection, Idempotency-Key reuse, and background mission refresh remain intact.

## Authoritative Player State

The shared player UI store is hydrated from browser `GET /api/me` in API mode. Synapse Points, XP, progression level, rank, and XP target are presentation state backed by the API. A mission claim uses `claimResult.playerState` as the destination and never calculates the final balance locally. Count-up interpolation is visual only. Mock mode continues to hydrate from mock player data.

## Reward Experience

SP rewards show a numeric award and use eight lightweight DOM particles with varied curved paths toward the top-bar balance anchor. The balance counts from the previous authoritative value to the new authoritative value and pulses on arrival. If the anchor is absent, the centered reward remains visible without flying particles.

XP rewards use a distinct cyan energy HUD and animate progress to the authoritative XP value. If the progression level increased, one stronger rank-up overlay presents the final crossed level and rank, with an accessible dismiss control and automatic completion. Zero-value reward types are omitted.

## Motion And Accessibility

Both the operating-system motion preference and the saved in-app Reduced Motion setting are respected. Reduced mode removes flying coins and large movement while retaining reward labels, count updates, fades, and pulses. Each queued reward is announced once through a persistent polite live region, while redundant visual stages and decorative particles are hidden from assistive technology. The Rank Up dialog remains exposed with an accessible title, description, and dismiss button. Animation is never the only indication of the result.

## Audio

Audio preferences are centralized and stored locally. The manager supports master audio, sound effects, notification sounds, music, effects volume, and music volume. Audio elements are cached rather than reconstructed for every event. Background music can begin only after the first pointer or keyboard interaction, loops across route changes, and pauses when master audio or music is disabled.

No approved audio files currently exist under `public/sounds`; only directory placeholders are present. Manifest entries therefore have no path and produce no request or browser 404. Final licensed or owned hub music should be placed at `public/sounds/music/hub-theme.mp3` and then enabled in the manifest. All effect mappings remain replaceable in `src/config/sounds.ts`.

The repository environment template keeps development auto-login opt-in with `NEXT_PUBLIC_DEV_AUTO_LOGIN=false`. A developer may enable it in an untracked personal `.env.local`; the existing development, API-mode, and localhost-only safety guards remain required.

## Development Preview

`/ui-lab/game-feel` is a development-only visual tuning route and resolves to not-found in production. It provides local previews for SP, XP, combined rewards, mission completion, rank-up, reveal-only presentation, errors, reduced motion, and queued rewards. It performs no service call or backend write and is not linked from player navigation.

## Boundaries

Phase 3F-E changes frontend presentation only. Backend reward authority, ledgers, missions, migrations, and database data are unchanged. No Neon, Wix, or production action was performed.
