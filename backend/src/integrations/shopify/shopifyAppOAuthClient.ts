import { AppError, validationFailed } from "../../domain/errors.js";

const DEFAULT_REFRESH_WINDOW_MS = 60_000;

export type ShopifyOAuthHttpClient = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ShopifyAppOAuthConfig {
  shopDomain?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface ShopifyAccessTokenProvider {
  getAccessToken(): Promise<string>;
  getShopDomain(): string;
}

export class ShopifyAppOAuthError extends AppError {
  constructor(code: string, message: string, details: { operation: "TOKEN"; httpStatus?: number }) {
    super(code, message, 502, details);
  }
}

export class ShopifyAppOAuthClient implements ShopifyAccessTokenProvider {
  private readonly fetchImpl: ShopifyOAuthHttpClient;
  private readonly getConfig: () => ShopifyAppOAuthConfig;
  private readonly now: () => number;
  private readonly refreshWindowMs: number;
  private readonly cache = new Map<string, { accessToken: string; expiresAtMs: number }>();
  private readonly pending = new Map<string, Promise<string>>();

  constructor(options: {
    fetchImpl?: ShopifyOAuthHttpClient;
    getConfig?: () => ShopifyAppOAuthConfig;
    now?: () => number;
    refreshWindowMs?: number;
  } = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.getConfig = options.getConfig ?? readShopifyAppOAuthConfig;
    this.now = options.now ?? Date.now;
    this.refreshWindowMs = options.refreshWindowMs ?? DEFAULT_REFRESH_WINDOW_MS;
  }

  getShopDomain() {
    return resolveShopifyAppCredentials(this.getConfig()).shopDomain;
  }

  async getAccessToken() {
    const credentials = resolveShopifyAppCredentials(this.getConfig());
    const cacheKey = `${credentials.shopDomain}:${credentials.clientId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && this.now() < cached.expiresAtMs - this.refreshWindowMs) return cached.accessToken;

    const pending = this.pending.get(cacheKey);
    if (pending) return pending;

    const request = this.createAccessToken(credentials, cacheKey).finally(() => {
      this.pending.delete(cacheKey);
    });
    this.pending.set(cacheKey, request);
    return request;
  }

  private async createAccessToken(credentials: ShopifyAppCredentials, cacheKey: string) {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    });
    let response: Response;
    try {
      response = await this.fetchImpl(`https://${credentials.shopDomain}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch {
      throw new ShopifyAppOAuthError(
        "SHOPIFY_OAUTH_REQUEST_FAILED",
        "Shopify access-token request failed before a response was received.",
        { operation: "TOKEN" },
      );
    }

    if (!response.ok) {
      throw new ShopifyAppOAuthError(
        "SHOPIFY_OAUTH_HTTP_ERROR",
        "Shopify access-token request was rejected.",
        { operation: "TOKEN", httpStatus: response.status },
      );
    }

    const payload = await readJson(response);
    const accessToken = readNonblankString(payload, "access_token");
    const expiresIn = isRecord(payload) ? payload.expires_in : undefined;
    if (!accessToken || !Number.isSafeInteger(expiresIn) || Number(expiresIn) <= 0) {
      throw invalidTokenResponse();
    }
    const expiresAtMs = this.now() + Number(expiresIn) * 1000;
    if (!Number.isSafeInteger(expiresAtMs)) throw invalidTokenResponse();

    this.cache.set(cacheKey, { accessToken, expiresAtMs });
    return accessToken;
  }
}

export function normalizeShopifyShopDomain(value: string) {
  const input = value.trim();
  if (!input) throw validationFailed("Shopify shop domain is not configured.");

  let hostname = input;
  if (/^https?:\/\//i.test(input)) {
    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      throw validationFailed("Shopify shop domain must be a canonical myshopify.com hostname.");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port
      || (parsed.pathname !== "/" && parsed.pathname !== "") || parsed.search || parsed.hash) {
      throw validationFailed("Shopify shop domain must be a canonical myshopify.com hostname.");
    }
    hostname = parsed.hostname;
  } else {
    hostname = input.replace(/\/+$/, "");
    if (hostname.includes("/") || hostname.includes(":") || hostname.includes("?") || hostname.includes("#")) {
      throw validationFailed("Shopify shop domain must be a canonical myshopify.com hostname.");
    }
  }

  hostname = hostname.toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.myshopify\.com$/.test(hostname)) {
    throw validationFailed("Shopify shop domain must be a canonical myshopify.com hostname.");
  }
  return hostname;
}

interface ShopifyAppCredentials {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
}

function readShopifyAppOAuthConfig(): ShopifyAppOAuthConfig {
  return {
    shopDomain: process.env.SHOPIFY_SHOP_DOMAIN,
    clientId: process.env.SHOPIFY_CLIENT_ID,
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET,
  };
}

function resolveShopifyAppCredentials(config: ShopifyAppOAuthConfig): ShopifyAppCredentials {
  const shopDomain = normalizeShopifyShopDomain(config.shopDomain ?? "");
  const clientId = config.clientId?.trim();
  if (!clientId) {
    throw new ShopifyAppOAuthError("SHOPIFY_CLIENT_ID_MISSING", "Shopify client ID is not configured.", { operation: "TOKEN" });
  }
  const clientSecret = config.clientSecret?.trim();
  if (!clientSecret) {
    throw new ShopifyAppOAuthError("SHOPIFY_CLIENT_SECRET_MISSING", "Shopify client secret is not configured.", { operation: "TOKEN" });
  }
  return { shopDomain, clientId, clientSecret };
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text.trim()) throw invalidTokenResponse();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalidTokenResponse();
  }
}

function invalidTokenResponse() {
  return new ShopifyAppOAuthError(
    "SHOPIFY_OAUTH_RESPONSE_INVALID",
    "Shopify access-token response was invalid.",
    { operation: "TOKEN" },
  );
}

function readNonblankString(value: unknown, key: string) {
  if (!isRecord(value) || typeof value[key] !== "string") return null;
  return value[key].trim() || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
