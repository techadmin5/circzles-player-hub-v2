import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { AppError } from "./errors.js";
import type { IdentityProvider, IdentitySourceSite, VerifiedExternalIdentity } from "./identity.js";

const headerSchema = z.object({ alg: z.literal("HS256"), typ: z.literal("CZ-HANDOFF") }).strict();
const payloadSchema = z.object({
  v: z.literal(1),
  iss: z.enum(["circzles.com", "circzles.in"]),
  aud: z.literal("circzles-player-hub"),
  sub: z.string().trim().min(1).max(200),
  jti: z.string().trim().min(16).max(200),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  email: z.string().email().max(320),
  emailVerified: z.literal(true),
  provider: z.enum(["WIX", "EMAIL", "GOOGLE", "FACEBOOK"]).default("WIX"),
  displayName: z.string().trim().min(1).max(80).optional(),
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  avatarUrl: z.string().url().max(2048).optional(),
}).strict();

const issuerConfig: Record<string, { sourceSite: IdentitySourceSite; secretKey: "circzlesCom" | "circzlesIn" }> = {
  "circzles.com": { sourceSite: "CIRCZLES_COM", secretKey: "circzlesCom" },
  "circzles.in": { sourceSite: "CIRCZLES_IN", secretKey: "circzlesIn" },
};

export interface AuthHandoffSecrets {
  circzlesCom?: string;
  circzlesIn?: string;
}

export interface VerifiedAuthHandoff extends Omit<VerifiedExternalIdentity, "handoff"> {
  tokenId: string;
  expiresAt: Date;
}

export class AuthHandoffVerifier {
  constructor(private secrets: AuthHandoffSecrets) {}

  verify(token: string, now = new Date()): VerifiedAuthHandoff {
    if (token.length > 8192) throw invalidHandoff();
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !part)) throw invalidHandoff();
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = parseJsonPart(encodedHeader, headerSchema);
    void header;
    const payload = parseJsonPart(encodedPayload, payloadSchema);
    const issuer = issuerConfig[payload.iss];
    if (!issuer) throw invalidHandoff();
    const secret = this.secrets[issuer.secretKey];
    if (!secret) throw new AppError("AUTH_HANDOFF_NOT_CONFIGURED", "Authentication handoff is not configured for this site.", 503);

    const expected = createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest();
    const supplied = decodeBase64Url(encodedSignature);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw invalidHandoff();

    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (payload.iat > nowSeconds + 60 || payload.exp <= nowSeconds || payload.exp - payload.iat > 300) throw invalidHandoff();

    return {
      sourceSite: issuer.sourceSite,
      provider: payload.provider as IdentityProvider,
      externalIdentityId: payload.sub,
      verifiedEmail: payload.email.toLowerCase(),
      emailVerified: true,
      displayName: payload.displayName,
      firstName: payload.firstName,
      lastName: payload.lastName,
      avatarUrl: payload.avatarUrl,
      tokenId: payload.jti,
      expiresAt: new Date(payload.exp * 1000),
    };
  }
}

function parseJsonPart<T>(value: string, schema: z.ZodType<T>): T {
  try {
    const parsed = JSON.parse(decodeBase64Url(value).toString("utf8"));
    const result = schema.safeParse(parsed);
    if (!result.success) throw invalidHandoff();
    return result.data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalidHandoff();
  }
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw invalidHandoff();
  return Buffer.from(value, "base64url");
}

function invalidHandoff() {
  return new AppError("AUTH_HANDOFF_INVALID", "Authentication handoff is invalid or expired.", 401);
}
