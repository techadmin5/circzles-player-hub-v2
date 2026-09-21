import type { CouponStorefrontTarget } from "../../domain/couponBridge.js";
import { AppError, validationFailed } from "../../domain/errors.js";

const WIX_OAUTH_TOKEN_URL = "https://www.wixapis.com/oauth2/token";
const DEFAULT_REFRESH_WINDOW_MS = 60_000;

export type WixOAuthHttpClient = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface WixAccessTokenProvider {
  getAccessToken(storefrontTarget: CouponStorefrontTarget): Promise<string>;
}

export interface WixAppOAuthConfig {
  sharedApp?: WixAppOAuthCredentialConfig;
  storefrontApps?: Partial<Record<CouponStorefrontTarget, WixAppOAuthCredentialConfig>>;
  instanceIds?: Partial<Record<CouponStorefrontTarget, string>>;
}

export interface WixAppOAuthCredentialConfig {
  appId?: string;
  appSecret?: string;
}

export class WixAppOAuthError extends AppError {
  constructor(code: string, message: string, details: { storefront: CouponStorefrontTarget; operation: "TOKEN"; httpStatus?: number }) {
    super(code, message, 502, details);
  }
}

export class WixAppOAuthClient implements WixAccessTokenProvider {
  private readonly fetchImpl: WixOAuthHttpClient;
  private readonly getConfig: () => WixAppOAuthConfig;
  private readonly now: () => number;
  private readonly refreshWindowMs: number;
  private readonly cache = new Map<string, { accessToken: string; expiresAtMs: number }>();
  private readonly pending = new Map<string, Promise<string>>();

  constructor(options: {
    fetchImpl?: WixOAuthHttpClient;
    getConfig?: () => WixAppOAuthConfig;
    now?: () => number;
    refreshWindowMs?: number;
  } = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.getConfig = options.getConfig ?? readWixAppOAuthConfig;
    this.now = options.now ?? Date.now;
    this.refreshWindowMs = options.refreshWindowMs ?? DEFAULT_REFRESH_WINDOW_MS;
  }

  async getAccessToken(storefrontTarget: CouponStorefrontTarget) {
    const credentials = resolveCredentials(this.getConfig(), storefrontTarget);
    const cacheKey = `${storefrontTarget}:${credentials.appId}:${credentials.instanceId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && this.now() < cached.expiresAtMs - this.refreshWindowMs) return cached.accessToken;

    const pending = this.pending.get(cacheKey);
    if (pending) return pending;

    const request = this.createAccessToken(storefrontTarget, credentials).finally(() => {
      this.pending.delete(cacheKey);
    });
    this.pending.set(cacheKey, request);
    return request;
  }

  private async createAccessToken(storefrontTarget: CouponStorefrontTarget, credentials: WixAppCredentials) {
    let response: Response;
    try {
      response = await this.fetchImpl(WIX_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: credentials.appId,
          client_secret: credentials.appSecret,
          instance_id: credentials.instanceId,
        }),
      });
    } catch {
      throw new WixAppOAuthError("WIX_OAUTH_REQUEST_FAILED", "Wix app token request failed before a response was received.", { storefront: storefrontTarget, operation: "TOKEN" });
    }

    if (!response.ok) {
      throw new WixAppOAuthError("WIX_OAUTH_HTTP_ERROR", "Wix app token request was rejected.", { storefront: storefrontTarget, operation: "TOKEN", httpStatus: response.status });
    }

    const payload = await readJson(response, storefrontTarget);
    const accessToken = readNonblankString(payload, "access_token");
    const tokenType = readNonblankString(payload, "token_type");
    const expiresIn = isRecord(payload) ? payload.expires_in : undefined;
    if (!accessToken || tokenType?.toLowerCase() !== "bearer" || !Number.isSafeInteger(expiresIn) || Number(expiresIn) <= 0) {
      throw invalidTokenResponse(storefrontTarget);
    }
    const expiresAtMs = this.now() + Number(expiresIn) * 1000;
    if (!Number.isSafeInteger(expiresAtMs)) throw invalidTokenResponse(storefrontTarget);

    const cacheKey = `${storefrontTarget}:${credentials.appId}:${credentials.instanceId}`;
    this.cache.set(cacheKey, { accessToken, expiresAtMs });
    return accessToken;
  }
}

function readWixAppOAuthConfig(): WixAppOAuthConfig {
  return {
    sharedApp: {
      appId: process.env.WIX_APP_ID,
      appSecret: process.env.WIX_APP_SECRET,
    },
    storefrontApps: {
      WIX_CIRCZLES_IN: {
        appId: process.env.WIX_CIRCZLES_IN_APP_ID,
        appSecret: process.env.WIX_CIRCZLES_IN_APP_SECRET,
      },
    },
    instanceIds: {
      WIX_CIRCZLES_IN: process.env.WIX_CIRCZLES_IN_INSTANCE_ID,
      WIX_CIRCZLES_COM: process.env.WIX_CIRCZLES_COM_INSTANCE_ID,
      WIX_COGZART_IN: process.env.WIX_COGZART_IN_INSTANCE_ID,
      WIX_COGZART_COM: process.env.WIX_COGZART_COM_INSTANCE_ID,
    },
  };
}

interface WixAppCredentials {
  appId: string;
  appSecret: string;
  instanceId: string;
}

function resolveCredentials(config: WixAppOAuthConfig, storefrontTarget: CouponStorefrontTarget): WixAppCredentials {
  if (storefrontTarget === "SHOPIFY_COGZART") {
    throw validationFailed("Wix app OAuth cannot operate on a Shopify storefront.", { storefront: storefrontTarget });
  }
  const app = storefrontTarget === "WIX_CIRCZLES_IN"
    ? config.storefrontApps?.WIX_CIRCZLES_IN
    : config.sharedApp;
  const appId = app?.appId?.trim();
  if (!appId) throw new WixAppOAuthError("WIX_APP_ID_MISSING", "Wix app ID is not configured.", { storefront: storefrontTarget, operation: "TOKEN" });
  const appSecret = app?.appSecret?.trim();
  if (!appSecret) throw new WixAppOAuthError("WIX_APP_SECRET_MISSING", "Wix app secret is not configured.", { storefront: storefrontTarget, operation: "TOKEN" });
  const instanceId = config.instanceIds?.[storefrontTarget]?.trim();
  if (!instanceId) throw new WixAppOAuthError("WIX_APP_INSTANCE_ID_MISSING", "Wix app instance ID is not configured for this storefront.", { storefront: storefrontTarget, operation: "TOKEN" });
  return { appId, appSecret, instanceId };
}

async function readJson(response: Response, storefrontTarget: CouponStorefrontTarget) {
  const text = await response.text();
  if (!text.trim()) throw invalidTokenResponse(storefrontTarget);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalidTokenResponse(storefrontTarget);
  }
}

function invalidTokenResponse(storefrontTarget: CouponStorefrontTarget) {
  return new WixAppOAuthError("WIX_OAUTH_RESPONSE_INVALID", "Wix app token response was invalid.", { storefront: storefrontTarget, operation: "TOKEN" });
}

function readNonblankString(value: unknown, key: string) {
  if (!isRecord(value) || typeof value[key] !== "string") return null;
  return value[key].trim() || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
