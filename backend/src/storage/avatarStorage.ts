import { v2 as cloudinary } from "cloudinary";
import { AppError, validationFailed } from "../domain/errors.js";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const avatarMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export interface AvatarAsset { publicId: string; url: string }
export interface AvatarStorage { upload(bytes: Buffer, mimeType: string, publicId: string): Promise<AvatarAsset> }

export function decodeAvatar(mimeType: string, base64: string) {
  if (!avatarMimeTypes.includes(mimeType as typeof avatarMimeTypes[number]) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw validationFailed("Use a JPEG, PNG or WebP image.");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) throw validationFailed("Photo must be at most 2 MiB.");
  const detected = bytes.subarray(0, 3).equals(Buffer.from([0xff,0xd8,0xff])) ? "image/jpeg"
    : bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png"
    : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" ? "image/webp" : null;
  if (detected !== mimeType) throw validationFailed("The file content does not match its image type.");
  return bytes;
}

export class CloudinaryAvatarStorage implements AvatarStorage {
  constructor(private config: { cloudName?: string; apiKey?: string; apiSecret?: string }) {}
  async upload(bytes: Buffer, mimeType: string, publicId: string): Promise<AvatarAsset> {
    if (!this.config.cloudName || !this.config.apiKey || !this.config.apiSecret) throw new AppError("AVATAR_STORAGE_NOT_CONFIGURED", "Profile photo storage is not configured.", 503);
    try {
      // Cloudinary decodes the raster and stores a bounded transformed image.
      const asset = await cloudinary.uploader.upload(`data:${mimeType};base64,${bytes.toString("base64")}`, {
        cloud_name: this.config.cloudName, api_key: this.config.apiKey, api_secret: this.config.apiSecret,
        resource_type: "image", public_id: publicId, overwrite: false, timeout: 20_000,
        allowed_formats: ["jpg", "png", "webp"],
        transformation: [{ width: 512, height: 512, crop: "limit", flags: "force_strip.strip_profile" }],
      });
      if (asset.public_id !== publicId || asset.resource_type !== "image" || !["jpg","png","webp"].includes(asset.format)
        || !Number.isSafeInteger(asset.version) || asset.version <= 0 || !Number.isSafeInteger(asset.width) || !Number.isSafeInteger(asset.height) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.width <= 0 || asset.height <= 0
        || asset.width > 512 || asset.height > 512 || asset.bytes > MAX_AVATAR_BYTES) throw new Error("Invalid image asset");
      return { publicId, url: cloudinary.url(publicId, { cloud_name: this.config.cloudName, secure: true, resource_type: "image", version: asset.version, format: asset.format }) };
    } catch { throw new AppError("AVATAR_UPLOAD_FAILED", "The image could not be stored. Try a valid JPEG, PNG or WebP photo.", 422); }
  }
}
