import { AppError, validationFailed } from "../../domain/errors.js";
import type { CouponProviderGateway, CouponProvisionRequest, CouponStorefrontTarget } from "../../domain/couponBridge.js";
import { WixAppOAuthClient, type WixAccessTokenProvider } from "./wixAppOAuthClient.js";

const WIX_COUPONS_URL = "https://www.wixapis.com/stores/v2/coupons";
const WIX_COUPONS_QUERY_URL = `${WIX_COUPONS_URL}/query`;
const WIX_QUERY_PAGE_SIZE = 100;
const DEFAULT_RECOVERY_DELAYS_MS = [250, 500, 1_000] as const;

export const wixCouponStorefronts = Object.freeze({
  WIX_CIRCZLES_IN: Object.freeze({ domain: "https://www.circzles.in/", wixSiteId: "5cd5bcc4-823e-485a-b791-c22fb487aaf8", currency: "INR" as const }),
  WIX_CIRCZLES_COM: Object.freeze({ domain: "https://www.circzles.com/", wixSiteId: "b5d3a6d5-bc44-44d4-9b14-e7b673bfd171", currency: "USD" as const }),
  WIX_COGZART_IN: Object.freeze({ domain: "https://www.cogzart.in/", wixSiteId: "d37a119e-a978-451f-a39f-c33f6b1d145f", currency: "INR" as const }),
  WIX_COGZART_COM: Object.freeze({ domain: "https://www.cogzart.com/", wixSiteId: "35afe62f-b860-4e10-b033-918b8577a870", currency: "USD" as const }),
});

export type WixCouponStorefrontTarget = keyof typeof wixCouponStorefronts;
export type WixCouponHttpClient = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class WixCouponProviderError extends AppError {
  constructor(code: string, message: string, details: { storefront: CouponStorefrontTarget; operation: "QUERY" | "CREATE" | "GET" | "DISABLE"; httpStatus?: number }) {
    super(code, message, 502, details);
  }
}

export function resolveWixCouponStorefront(target: CouponStorefrontTarget) {
  if (!(target in wixCouponStorefronts)) {
    throw validationFailed("Wix coupon operations require a configured Wix storefront.", { storefront: target });
  }
  return wixCouponStorefronts[target as WixCouponStorefrontTarget];
}

export class WixCouponGateway implements CouponProviderGateway {
  private readonly fetchImpl: WixCouponHttpClient;
  private readonly accessTokens: WixAccessTokenProvider;
  private readonly recoveryDelaysMs: readonly number[];
  private readonly delay: (milliseconds: number) => Promise<void>;

  constructor(options: {
    fetchImpl?: WixCouponHttpClient;
    accessTokens?: WixAccessTokenProvider;
    recoveryDelaysMs?: readonly number[];
    delay?: (milliseconds: number) => Promise<void>;
  } = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.accessTokens = options.accessTokens ?? new WixAppOAuthClient({ fetchImpl: this.fetchImpl });
    const recoveryDelaysMs = [...(options.recoveryDelaysMs ?? DEFAULT_RECOVERY_DELAYS_MS)].slice(0, DEFAULT_RECOVERY_DELAYS_MS.length);
    if (recoveryDelaysMs.some((milliseconds) => !Number.isSafeInteger(milliseconds) || milliseconds < 0)) {
      throw validationFailed("Wix coupon recovery delays must be non-negative integer milliseconds.");
    }
    this.recoveryDelaysMs = recoveryDelaysMs;
    this.delay = options.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async provision(request: CouponProvisionRequest) {
    if (request.provider !== "WIX") throw validationFailed("Wix coupon gateway cannot provision a non-Wix storefront.", { storefront: request.storefrontTarget });
    const existing = await this.findByExactCode(request.storefrontTarget, request.couponCode);
    if (existing) return { providerCouponId: existing };

    let providerCouponId: string;
    try {
      const body = buildWixCreateCouponBody(request);
      const response = await this.requestJson(request.storefrontTarget, "CREATE", WIX_COUPONS_URL, { method: "POST", body: JSON.stringify(body) });
      const createdId = readNonblankString(response, "id");
      if (!createdId) {
        throw new WixCouponProviderError("WIX_COUPON_RESPONSE_INVALID", "Wix coupon create returned an invalid response.", { storefront: request.storefrontTarget, operation: "CREATE" });
      }
      providerCouponId = createdId;
    } catch (error) {
      if (!isAmbiguousCreateFailure(error)) throw error;
      return { providerCouponId: await this.recoverAfterAmbiguousCreate(request.storefrontTarget, request.couponCode, error) };
    }

    await this.verifyCreatedCoupon(request.storefrontTarget, providerCouponId, request.couponCode);
    return { providerCouponId };
  }

  async disable(input: { storefrontTarget: CouponStorefrontTarget; providerCouponId: string; couponCode: string }) {
    resolveWixCouponStorefront(input.storefrontTarget);
    const providerCouponId = input.providerCouponId.trim();
    if (!providerCouponId) throw validationFailed("Wix coupon disable requires a provider coupon id.");
    await this.requestJson(input.storefrontTarget, "DISABLE", `${WIX_COUPONS_URL}/${encodeURIComponent(providerCouponId)}`, {
      method: "PATCH",
      body: JSON.stringify({ fieldMask: { paths: ["active"] }, specification: { active: false } }),
    });
  }

  private async findByExactCode(storefrontTarget: CouponStorefrontTarget, couponCode: string) {
    let expectedTotal: number | null = null;
    let matchedId: string | null = null;

    for (let offset = 0; expectedTotal === null || offset < expectedTotal; offset += WIX_QUERY_PAGE_SIZE) {
      const response = await this.requestJson(storefrontTarget, "QUERY", WIX_COUPONS_QUERY_URL, {
        method: "POST",
        body: JSON.stringify({ query: { paging: { limit: WIX_QUERY_PAGE_SIZE, offset } } }),
      });
      const page = readCouponQueryPage(response, storefrontTarget, offset, expectedTotal);
      expectedTotal = page.totalResults;

      for (const coupon of page.coupons) {
        if (!isRecord(coupon) || !isRecord(coupon.specification) || coupon.specification.code !== couponCode) continue;
        const providerCouponId = readNonblankString(coupon, "id");
        if (!providerCouponId) {
          throw new WixCouponProviderError("WIX_COUPON_RESPONSE_INVALID", "Matched Wix coupon did not include a valid id.", { storefront: storefrontTarget, operation: "QUERY" });
        }
        if (matchedId !== null) {
          throw new WixCouponProviderError("WIX_COUPON_RECOVERY_AMBIGUOUS", "Multiple Wix coupons matched the canonical coupon code.", { storefront: storefrontTarget, operation: "QUERY" });
        }
        matchedId = providerCouponId;
      }
    }
    return matchedId;
  }

  private async verifyCreatedCoupon(storefrontTarget: CouponStorefrontTarget, providerCouponId: string, couponCode: string) {
    const response = await this.requestJson(storefrontTarget, "GET", `${WIX_COUPONS_URL}/${encodeURIComponent(providerCouponId)}`, { method: "GET" });
    if (!isRecord(response) || !isRecord(response.coupon) || !isRecord(response.coupon.specification)) {
      throw new WixCouponProviderError("WIX_COUPON_RESPONSE_INVALID", "Wix get coupon returned an invalid response.", { storefront: storefrontTarget, operation: "GET" });
    }
    const returnedId = readNonblankString(response.coupon, "id");
    if (returnedId !== providerCouponId || response.coupon.specification.code !== couponCode) {
      throw new WixCouponProviderError("WIX_COUPON_VERIFICATION_FAILED", "Wix created coupon did not match the requested coupon.", { storefront: storefrontTarget, operation: "GET" });
    }
  }

  private async recoverAfterAmbiguousCreate(storefrontTarget: CouponStorefrontTarget, couponCode: string, createError: WixCouponProviderError) {
    for (const delayMs of this.recoveryDelaysMs) {
      await this.delay(delayMs);
      try {
        const existing = await this.findByExactCode(storefrontTarget, couponCode);
        if (existing) return existing;
      } catch (error) {
        if (!isRetryableRecoveryQueryFailure(error)) throw error;
      }
    }
    throw new WixCouponProviderError("WIX_COUPON_RECOVERY_EXHAUSTED", "Wix coupon creation could not be reconciled safely.", {
      storefront: storefrontTarget,
      operation: "CREATE",
      httpStatus: readHttpStatus(createError),
    });
  }

  private async requestJson(storefrontTarget: CouponStorefrontTarget, operation: "QUERY" | "CREATE" | "GET" | "DISABLE", url: string, init: RequestInit) {
    resolveWixCouponStorefront(storefrontTarget);
    const accessToken = await this.accessTokens.getAccessToken(storefrontTarget);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: { Authorization: accessToken, "Content-Type": "application/json" },
      });
    } catch {
      throw new WixCouponProviderError("WIX_COUPON_REQUEST_FAILED", "Wix coupon request failed before a response was received.", { storefront: storefrontTarget, operation });
    }

    if (!response.ok) {
      throw new WixCouponProviderError("WIX_COUPON_HTTP_ERROR", "Wix coupon request was rejected.", { storefront: storefrontTarget, operation, httpStatus: response.status });
    }
    const text = await response.text();
    if (!text.trim()) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new WixCouponProviderError("WIX_COUPON_RESPONSE_INVALID", "Wix coupon response was not valid JSON.", { storefront: storefrontTarget, operation, httpStatus: response.status });
    }
  }
}

export function buildWixCreateCouponBody(request: CouponProvisionRequest) {
  if (request.provider !== "WIX") throw validationFailed("Wix coupon request requires a Wix storefront.", { storefront: request.storefrontTarget });
  resolveWixCouponStorefront(request.storefrontTarget);
  const specification: Record<string, unknown> = {
    name: `CircZles Reward ${request.couponCode}`,
    code: request.couponCode,
    startTime: String(request.startsAt.getTime()),
    usageLimit: 1,
    limitPerCustomer: 1,
    active: true,
    scope: { namespace: "stores" },
    limitedToOneItem: false,
    appliesToSubscriptions: false,
  };
  if (request.expiresAt) specification.expirationTime = String(request.expiresAt.getTime());
  if (request.benefit.type === "PERCENTAGE") specification.percentOffRate = request.benefit.percentage;
  else specification.moneyOffAmount = request.benefit.amount;
  return { specification };
}

function readNonblankString(value: unknown, key: string) {
  if (!isRecord(value) || typeof value[key] !== "string") return null;
  return value[key].trim() || null;
}

function readCouponQueryPage(response: unknown, storefrontTarget: CouponStorefrontTarget, offset: number, expectedTotal: number | null) {
  if (!isRecord(response) || !Array.isArray(response.coupons)
    || !Number.isSafeInteger(response.totalResults) || Number(response.totalResults) < 0) {
    throw invalidCouponQueryResponse(storefrontTarget);
  }
  const totalResults = Number(response.totalResults);
  const expectedPageLength = Math.min(WIX_QUERY_PAGE_SIZE, Math.max(totalResults - offset, 0));
  if ((expectedTotal !== null && totalResults !== expectedTotal) || response.coupons.length !== expectedPageLength) {
    throw invalidCouponQueryResponse(storefrontTarget);
  }
  return { coupons: response.coupons, totalResults };
}

function invalidCouponQueryResponse(storefrontTarget: CouponStorefrontTarget) {
  return new WixCouponProviderError("WIX_COUPON_RESPONSE_INVALID", "Wix coupon query returned an invalid pagination response.", { storefront: storefrontTarget, operation: "QUERY" });
}

function isAmbiguousCreateFailure(error: unknown): error is WixCouponProviderError {
  if (!(error instanceof WixCouponProviderError)) return false;
  if (readErrorOperation(error) !== "CREATE") return false;
  if (error.code === "WIX_COUPON_REQUEST_FAILED" || error.code === "WIX_COUPON_RESPONSE_INVALID") return true;
  const status = readHttpStatus(error);
  return status === 408 || status === 409 || status === 425 || status === 429 || (status !== undefined && status >= 500);
}

function isRetryableRecoveryQueryFailure(error: unknown) {
  if (!(error instanceof WixCouponProviderError) || readErrorOperation(error) !== "QUERY") return false;
  if (error.code === "WIX_COUPON_REQUEST_FAILED") return true;
  const status = readHttpStatus(error);
  return status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500);
}

function readHttpStatus(error: WixCouponProviderError) {
  return isRecord(error.details) && typeof error.details.httpStatus === "number" ? error.details.httpStatus : undefined;
}

function readErrorOperation(error: WixCouponProviderError) {
  return isRecord(error.details) && typeof error.details.operation === "string" ? error.details.operation : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
