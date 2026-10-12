import { v2 as cloudinary } from "cloudinary";
import { setTimeout as delay } from "node:timers/promises";
import { MAX_VIDEO_SIZE_BYTES } from "../domain/submissionEligibility.js";
import { AppError } from "../domain/errors.js";

export interface SignedVideoUpload {
  uploadUrl: string;
  fields: { apiKey: string; timestamp: number; publicId: string; signature: string; type?: "authenticated"; overwrite?: string; allowedFormats?: string };
}

export interface VerifiedVideoAsset {
  publicId: string;
  bytes: number;
  durationMs?: number;
  resourceType: "video";
  format?: string;
}

export interface VerificationContext { uploadId?: string; requestId?: string; stage?: "finalization" | "submission" | "approval" | "viewing" }
export interface VideoStorage {
  configured: boolean;
  signUpload(publicId: string): Promise<SignedVideoUpload>;
  verifyUpload(publicId: string, context?: VerificationContext): Promise<VerifiedVideoAsset>;
  viewingUrl?(publicId: string): Promise<string>;
  deleteUpload?(publicId: string): Promise<void>;
}

export class CloudinaryVideoStorage implements VideoStorage {
  public readonly configured: boolean;

  constructor(private config: { cloudName?: string; apiKey?: string; apiSecret?: string; retryDelaysMs?: readonly number[]; diagnostic?: (entry: Record<string, unknown>) => void }) {
    this.configured = Boolean(config.cloudName && config.apiKey && config.apiSecret);
    if (this.configured) {
      cloudinary.config({ cloud_name: config.cloudName, api_key: config.apiKey, api_secret: config.apiSecret, secure: true });
    }
  }

  async signUpload(publicId: string): Promise<SignedVideoUpload> {
    this.assertConfigured();
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = cloudinary.utils.api_sign_request({ public_id: publicId, timestamp, type: "authenticated", overwrite: false, allowed_formats: "mp4,mov,webm,m4v" }, this.config.apiSecret!);
    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(this.config.cloudName!)}/video/upload`,
      fields: { apiKey: this.config.apiKey!, timestamp, publicId, signature, type: "authenticated", overwrite: "false", allowedFormats: "mp4,mov,webm,m4v" },
    };
  }

  async verifyUpload(publicId: string, context: VerificationContext = {}): Promise<VerifiedVideoAsset> {
    this.assertConfigured();
    const waits = this.config.retryDelaysMs ?? [250, 750];
    for (let attempt = 0; ; attempt++) {
      let stage = "provider_lookup";
      try {
        const asset = await cloudinary.api.resource(publicId, { resource_type: "video", type: "authenticated", media_metadata: true, timeout: 10000 });
        const invalid = (code: string, message: string) => { throw new AppError(code, message, 422); };
        stage = "identity";
        if (asset.resource_type !== "video" || asset.public_id !== publicId || asset.type !== "authenticated") invalid("VIDEO_UPLOAD_METADATA_INVALID", "The recording identity or protected delivery could not be verified.");
        stage = "processing";
        if (["pending", "processing"].includes(asset.status)) throw new AppError("VIDEO_PROCESSING_PENDING", "Cloudinary is still processing this recording. Retry verification shortly.", 503);
        stage = "format";
        if (!["mp4", "mov", "webm", "m4v"].includes(asset.format) || asset.is_audio === true) invalid("VIDEO_MEDIA_UNSUPPORTED", "Use a supported MP4, MOV, WebM or M4V recording with video evidence.");
        stage = "metadata";
        if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || !Number.isFinite(asset.duration) || asset.duration <= 0 || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0) invalid("VIDEO_UPLOAD_METADATA_INVALID", "The recording has missing or invalid size, dimensions or duration metadata.");
        if (asset.bytes > MAX_VIDEO_SIZE_BYTES) invalid("VIDEO_UPLOAD_SIZE_INVALID", "The recording exceeds the 100 MB maximum.");
        stage = "codec";
        // Authenticated Admin API responses expose codec at the top level; upload
        // responses may instead expose video.codec. Neither is client-supplied.
        const codec = asset.codec ?? asset.video?.codec;
        if (typeof codec !== "string" || !codec) invalid("VIDEO_UPLOAD_METADATA_INVALID", "The recording codec could not be verified.");
        if (!["h264", "hevc", "h265", "vp8", "vp9", "av1", "mpeg4", "prores"].includes(codec.toLowerCase())) invalid("VIDEO_CODEC_UNSUPPORTED", "This recording uses an unsupported video codec. Export it as H.264 MP4 and try again.");
        const durationMs = Math.ceil(asset.duration * 1000);
        if (!Number.isSafeInteger(durationMs) || durationMs > 2147483647) invalid("VIDEO_UPLOAD_METADATA_INVALID", "The recording duration is invalid.");
        this.diagnostic(context, { result: "verified", verificationStage: "complete", attempt: attempt + 1, codecLocation: asset.codec ? "top_level" : "video" });
        return { publicId: asset.public_id, bytes: asset.bytes, durationMs, format: asset.format, resourceType: "video" };
      } catch (error) {
        const provider = error as { error?: { http_code?: number }; http_code?: number; code?: string };
        const http = provider.error?.http_code ?? provider.http_code;
        const pending = error instanceof AppError && error.code === "VIDEO_PROCESSING_PENDING" || http === 423;
        const transient = pending || [408, 420, 429, 500, 502, 503, 504].includes(http ?? 0) || ["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"].includes(provider.code ?? "") || (http === 404 && context.stage === "finalization");
        const category = pending ? "processing" : http === 404 ? "not_found" : [401, 403].includes(http ?? 0) ? "authorization" : transient ? "temporary" : error instanceof AppError ? "invalid_media" : "provider_failure";
        this.diagnostic(context, { result: "failed", verificationStage: stage, providerCategory: category, providerHttpCode: http ?? null, attempt: attempt + 1, retryable: transient });
        if (transient && attempt < Math.min(waits.length, 2)) { await delay(waits[attempt]); continue; }
        if (error instanceof AppError) throw error;
        if (pending) throw new AppError("VIDEO_PROCESSING_PENDING", "Cloudinary is still processing this recording. Retry verification shortly.", 503);
        if (http === 404) throw new AppError("VIDEO_UPLOAD_NOT_FOUND", "The recording was not found in Cloudinary. Retry shortly or upload it again.", 422);
        throw new AppError("VIDEO_VERIFICATION_UNAVAILABLE", "Video verification is temporarily unavailable. Retry shortly; contact support if this continues.", 503);
      }
    }
  }
  private diagnostic(context: VerificationContext, fields: Record<string, unknown>) {
    const entry = { event: "video.verification", uploadId: context.uploadId, requestId: context.requestId, stage: context.stage ?? "verification", ...fields };
    (this.config.diagnostic ?? (value => console.info(JSON.stringify(value))))(entry);
  }

  async viewingUrl(publicId: string) {
    const asset = await this.verifyUpload(publicId, { stage: "viewing" });
    return cloudinary.utils.private_download_url(publicId, asset.format!, { resource_type: "video", type: "authenticated", expires_at: Math.floor(Date.now() / 1000) + 300, attachment: false });
  }
  async deleteUpload(publicId: string) {
    this.assertConfigured();
    await cloudinary.uploader.destroy(publicId, { resource_type: "video", type: "authenticated", invalidate: true });
  }
  private assertConfigured() {
    if (!this.configured) throw new AppError("VIDEO_STORAGE_NOT_CONFIGURED", "Video storage is not configured.", 503);
  }
}
