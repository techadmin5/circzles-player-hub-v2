import { v2 as cloudinary } from "cloudinary";
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

export interface VideoStorage {
  configured: boolean;
  signUpload(publicId: string): Promise<SignedVideoUpload>;
  verifyUpload(publicId: string): Promise<VerifiedVideoAsset>;
  viewingUrl?(publicId: string): Promise<string>;
  deleteUpload?(publicId: string): Promise<void>;
}

export class CloudinaryVideoStorage implements VideoStorage {
  public readonly configured: boolean;

  constructor(private config: { cloudName?: string; apiKey?: string; apiSecret?: string }) {
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

  async verifyUpload(publicId: string): Promise<VerifiedVideoAsset> {
    this.assertConfigured();
    try {
      const asset = await cloudinary.api.resource(publicId, { resource_type: "video", type: "authenticated" });
      if (asset.resource_type !== "video" || asset.public_id !== publicId || asset.type !== "authenticated" || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || !["mp4", "mov", "webm", "m4v"].includes(asset.format) || !Number.isFinite(asset.duration) || asset.duration <= 0 || !asset.video?.codec || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0) {
        throw new Error("Unexpected Cloudinary asset metadata");
      }
      return {
        publicId: asset.public_id,
        bytes: asset.bytes,
        // Ceiling prevents sub-millisecond over-limit recordings rounding down.
        durationMs: Math.ceil(asset.duration * 1000),
        format: asset.format,
        resourceType: "video",
      };
    } catch {
      throw new AppError("VIDEO_UPLOAD_VERIFICATION_FAILED", "The uploaded video could not be verified.", 422);
    }
  }

  async viewingUrl(publicId: string) {
    const asset = await this.verifyUpload(publicId);
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
