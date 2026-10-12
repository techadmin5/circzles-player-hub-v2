import { AppError } from "./errors.js";
export const MAX_VIDEO_SIZE_BYTES = 100000000;
export const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"]);
export function assertSubmissionEligibility(name: string, maximum: number | null | undefined, completion: number, video: { status: string; verifiedSizeBytes: number | null; durationMs: number | null; mimeType: string; storageProvider: string }) {
  if (!Number.isInteger(maximum) || !maximum || maximum <= 0) throw new AppError("COMPETITION_TIMING_NOT_CONFIGURED", `Competition timing has not been configured for ${name}. Please try again after an admin configures it.`, 422);
  if (video.status !== "COMPLETE" || video.storageProvider !== "CLOUDINARY" || !VIDEO_MIME_TYPES.has(video.mimeType) || !Number.isSafeInteger(video.verifiedSizeBytes) || !video.verifiedSizeBytes || video.verifiedSizeBytes > MAX_VIDEO_SIZE_BYTES || !Number.isInteger(video.durationMs) || !video.durationMs || video.durationMs < 0) throw new AppError("VIDEO_UPLOAD_METADATA_INVALID", "A completed video with verified size and duration is required.", 422);
  if (!Number.isInteger(completion) || completion <= 0 || completion > maximum || video.durationMs > maximum) {
    const time = String(Math.floor(maximum / 60000)).padStart(2, "0") + ":" + String(Math.floor(maximum / 1000) % 60).padStart(2, "0");
    throw new AppError("SUBMISSION_TIME_LIMIT_EXCEEDED", `This recording or completion time exceeds the ${time} maximum for ${name} and is not eligible for submission.`, 422);
  }
}
