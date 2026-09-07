# Phase 3D Result

Phase 3D implements the real submission and signed video-upload pipeline while preserving mock mode and the existing Player Hub visual design.

## Implemented

- Schema-only `0003_phase_3d_submissions.sql` migration for `video_uploads` and `submissions`.
- Optional Cloudinary provider boundary using the official Node SDK.
- Authenticated signing, backend verification/finalization, submission creation, current-player list, and current-player detail endpoints.
- Browser-owned-puzzle selection, precise completion-time parsing, actual file selection, direct Cloudinary upload with progress, backend verification, and final submission creation.
- Session-derived authority and strict request bodies. The backend derives `puzzleId` and `levelId` from `playerPuzzleId` and never accepts reward fields.

## Upload Lifecycle

The backend validates MIME and a 500 MiB declared-size limit, creates a `SIGNED` record with a backend-controlled public ID and 30-minute expiry, and returns signed upload fields. The browser uploads directly to Cloudinary. Finalization verifies the expected video through Cloudinary, enforces the authoritative size limit, stores verified metadata, and marks it `COMPLETE`. Verification failures become `FAILED`. Only a current player's `COMPLETE` upload can create one `PENDING_REVIEW` submission.

Completion time is constrained to `1..2147483647` milliseconds at both HTTP and domain boundaries. Submission retries reuse one caller-owned, player-scoped idempotency key. Matching replays return the existing submission, including after a unique-constraint race is resolved outside the rolled-back transaction; changed payloads return `IDEMPOTENCY_CONFLICT`.

## Configuration

`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` are optional at backend startup. Without all three, non-video APIs remain available and video signing/finalization returns `VIDEO_STORAGE_NOT_CONFIGURED`. The API secret is never returned to the browser.

## Deferred To Phase 3E

Admin review, approval/rejection workflow, rewards, XP, Synapse Points, leaderboard processing, and review audit behavior remain unimplemented.

## Verification Status

Automated tests use a fake storage provider and perform no Cloudinary or internet calls. Real Cloudinary runtime upload/verification has not been performed. Migration `0003_phase_3d_submissions.sql` has not been run against Neon. No seed, production action, or real Wix data change was performed.
