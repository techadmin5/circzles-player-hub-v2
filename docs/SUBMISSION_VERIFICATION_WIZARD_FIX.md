# Submission upload verification and wizard correction

## Confirmed production cause and read-only integration evidence

The existing test recording was inspected using a PostgreSQL BEGIN READ ONLY transaction and authenticated Cloudinary Admin API GET requests. The protected MP4 was 4,095,836 bytes, 1920x1080, with duration 20.062367 seconds. Cloudinary returned codec=h264 at the TOP LEVEL and no video.codec object. Public ID matched the database-controlled reference, resource_type was video and delivery type was authenticated. No processing-pending response was observed for this asset. The old verifier required video.codec and collapsed all errors into the same message, incorrectly rejecting this valid response.

The updated CloudinaryVideoStorage.verifyUpload was then executed against that real existing recording. It returned verifiedBytes=4095836 and verifiedDurationMs=20063. This was an actual read-only provider integration check, not a mocked response. The database row remained SIGNED with null verified metadata; it was neither finalized nor submitted/approved. No assets, credentials, account settings or production data were changed. Full deployed browser workflow sign-off remains a separate post-approval check; this branch is not deployed by the agent.

## Verification and diagnostic behavior

Verification requests explicit authenticated video media_metadata and checks expected public ID, delivery/resource types, allowed format, positive integer bytes <=100000000, positive dimensions, positive duration and supported codec. Codec is read from the observed Admin API top-level codec, with the documented upload-response video.codec structure also supported. Missing codec is invalid metadata; unknown codecs are rejected with a specific code. The supported codec names are h264/hevc/h265/vp8/vp9/av1/mpeg4/prores. Neither client duration nor filename replaces provider proof.

Policy update: [Submission finalization and admin rewards](SUBMISSION_FINALIZATION_ADMIN_REWARDS.md) supersedes the automatic recording-length eligibility gates described in this paragraph; duration differences now require manual review.

The original fix: duration retains the existing conservative ceiling to integer milliseconds. Creation AND approval additionally reject completionTimeMs > verified recording duration. A reported 04:59 cannot be substantiated by a 00:20.063 recording. This supplements the existing configured-maximum check; reviewers still judge continuity, unboxing, correctness and timing evidence manually. Size, ownership, active puzzle checks, idempotent review/reward grants and approval-only personal best logic are preserved.

Distinct safe errors cover pending processing, unsupported media/codec, invalid metadata, oversize, expired uploads, not-found recordings and temporary verifier unavailability. Terminal invalid media/size/codec stores the specific failure code; provider/processing failures remain retryable until upload expiration. No raw provider messages or URLs are returned to players.

Retries are bounded to three attempts with 250/750 ms delays and a 10-second provider timeout per attempt. Only explicit pending/processing/423, rate limit, documented transient server/network failures and a fresh-finalization 404 are retried. Approval/viewing missing assets and authentication failures are not retried automatically. Lack of required metadata without an explicit pending signal is not guessed to be a processing delay.

Structured video.verification diagnostics contain stage, verificationStage, provider category/status, attempt, retryability and upload/request correlation IDs. They omit public IDs, video URLs, API keys/secrets, raw responses and raw provider error messages. Finalization passes the HTTP request ID; submission/approval/viewing retain stage and upload correlation where available. Cloudinary resource behavior reference: https://cloudinary.com/documentation/admin_api#resource_details

## Time entry and wizard state (original fix)

A labelled mobile-friendly completion-time input inserts the colon after two minute digits. Pasting 0459 becomes 04:59, never 459 seconds. Deletion/backspace does not continually reinsert a deleted colon. Explicit MM:SS.mmm and existing HH:MM:SS.mmm parsing preserve millisecond precision; review displays normalized minutes/seconds/milliseconds. Seconds must be complete two-digit values 00-59; partial edits remain invalid and are not coerced into a different duration on blur. Full duration is checked against the puzzle maximum and available recording evidence before Continue.

Step access derives from prerequisites, not the current numeric step. Completed prerequisite steps can be revisited; future steps are locked. Transfer 100% enters verifying, never completed. Review requires a backend-confirmed COMPLETE upload with a valid verified duration; Submit additionally requires review confirmation. Failure/expiration clears the verified ID and displays Failed, without an upload checkmark or Ready to submit text. All sidebar, Continue, Back and final submit paths use these rules.

Selecting a different video clears old verification/review/idempotency state. Selecting a different owned CircZles clears time/video/upload/review state. Time changes revalidate evidence and require review confirmation again. Verification retries reuse transferred media, and lost submission responses preserve the existing idempotency key.

## Validation

Backend and frontend regressions cover actual-shaped top-level codec responses, safe logs, genuine transient processing, bounded retries, authentication failure, missing/unsupported codecs, 100 MB boundaries, direct API inconsistent-time rejection at creation/approval, compact time entry/paste/partial editing, failed/verified upload gates, recording/CircZles changes and existing reward/review behavior. Final full test/lint/typecheck/build results are recorded in the delivery report.

Final local validation: backend full suite 934/934 tests across 48 files; backend lint, typecheck and production build passed. Frontend full suite 210/210 tests; frontend lint, standalone tsc --noEmit and standard Next.js production build passed (45/45 pages). The build used isolated output and two workers, with system certificate trust enabled for existing Google Fonts downloads after a network failure; certificate verification remained enabled. No application build configuration or user next-env.d.ts edits were changed. git diff --check passed.
