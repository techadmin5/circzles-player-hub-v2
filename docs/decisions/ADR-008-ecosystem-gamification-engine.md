# ADR-008: CircZles V2 As Ecosystem Gamification Engine

## Status

Accepted as a permanent architecture requirement.

## Context

CircZles Player Hub V2 is not a standalone dashboard. It is the gamification engine for the whole CircZles ecosystem, including:

- `circzles.in`
- `dashboard.circzles.in`
- Fastify backend
- PostgreSQL
- Cloudinary
- future commerce integrations
- future review/form integrations

Future missions may originate from the main website as well as the dashboard.

## Decision

Design the backend around a shared V2 player identity and a unified game-event/mission engine. Dashboard events, website events, commerce events, review events, and admin events should flow into the same validated event model.

Examples:

- Website: `website.page_visited`, `website.gem_found`, `website.quest_completed`, `website.review_submitted`, `website.cta_completed`
- Dashboard: `player.login`, `puzzle.added`, `submission.created`, `submission.approved`, `wheel.spun`, `store.purchase`, `friend.added`
- Commerce: `order.created`, `puzzle.purchased`, `coupon.used`

## Security Requirement

The browser must not be authoritative for valuable rewards. A valuable mission must not trust client-side claims such as `gemFound=true`.

The backend must validate:

- authenticated player
- valid event and mission
- valid page, gem, action, order, or review
- eligibility
- prior completion state
- idempotency
- source-system proof where applicable

## Submission Media Requirement

Cloudinary remains suitable for submission videos.

Submission media flow:

1. Player uploads video.
2. Cloudinary stores video.
3. Cloudinary URL/reference is returned.
4. PostgreSQL stores only URL/reference and submission metadata.
5. Admin manually reviews.
6. Approved submission feeds leaderboard/reward processing.

## Consequences

- V2 identity must be reusable across website, dashboard, commerce, reviews, and website quests.
- Mission rules need source/event validation fields, not only dashboard action fields.
- Browser events may be useful signals, but valuable rewards require backend or source-system validation.
- Cloudinary integration belongs behind the storage/provider boundary.
