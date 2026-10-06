import { createHash, randomBytes } from "node:crypto";
import { argon2id, hash, verify } from "argon2";
import { AppError } from "./errors.js";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const authToken = () => randomBytes(32).toString("base64url");
export const tokenDigest = (token: string) => createHash("sha256").update(token).digest("hex");
export function safeReturnTo(value?: string) {
  if (!value || !value.startsWith("/") || /[\\\x00-\x20]/.test(value)) return "/hub";
  try {
    const url = new URL(value, "https://hub.invalid");
    return url.origin === "https://hub.invalid" && value.length <= 512 ? `${url.pathname}${url.search}${url.hash}` : "/hub";
  } catch { return "/hub"; }
}
export function hashPassword(password: string) {
  if (password.length < 12 || password.length > 256) throw new AppError("PASSWORD_INVALID", "Use a password between 12 and 256 characters.", 400);
  return hash(password, { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
}
export async function verifyPassword(encoded: string, password: string) {
  try { return await verify(encoded, password); } catch { return false; }
}
