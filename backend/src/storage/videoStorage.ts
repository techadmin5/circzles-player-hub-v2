import { v2 as cloudinary } from "cloudinary";
import { AppError } from "../domain/errors.js";

export interface SignedVideoUpload {
  uploadUrl: string;
  fields: { apiKey: string; timestamp: number; publicId: string; signature: string };
}

export interface VerifiedVideoAsset {
  publicId: string;
  bytes: number;
  durationMs?: number;
  resourceType: "video";
}

export interface VideoStorage {
  configured: boolean;
  signUpload(publicId: string): Promise<SignedVideoUpload>;
  verifyUpload(publicId: string): Promise<VerifiedVideoAsset>;
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
    const signature = cloudinary.utils.api_sign_request({ public_id: publicId, timestamp }, this.config.apiSecret!);
    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(this.config.cloudName!)}/video/upload`,
      fields: { apiKey: this.config.apiKey!, timestamp, publicId, signature },
    };
  }

  async verifyUpload(publicId: string): Promise<VerifiedVideoAsset> {
    this.assertConfigured();
    try {
      const asset = await cloudinary.api.resource(publicId, { resource_type: "video" });
      if (asset.resource_type !== "video" || asset.public_id !== publicId || !Number.isFinite(asset.bytes) || asset.bytes <= 0) {
        throw new Error("Unexpected Cloudinary asset metadata");
      }
      return {
        publicId: asset.public_id,
        bytes: asset.bytes,
        durationMs: typeof asset.duration === "number" ? Math.round(asset.duration * 1000) : undefined,
        resourceType: "video",
      };
    } catch {
      throw new AppError("VIDEO_UPLOAD_VERIFICATION_FAILED", "The uploaded video could not be verified.", 422);
    }
  }

  private assertConfigured() {
    if (!this.configured) throw new AppError("VIDEO_STORAGE_NOT_CONFIGURED", "Video storage is not configured.", 503);
  }
}
