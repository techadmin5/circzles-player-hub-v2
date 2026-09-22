import { AppError, validationFailed } from "../../domain/errors.js";
import type { CouponProviderGateway, CouponProvisionRequest, CouponStorefrontTarget } from "../../domain/couponBridge.js";
import { ShopifyAppOAuthClient, type ShopifyAccessTokenProvider } from "./shopifyAppOAuthClient.js";

const SHOPIFY_API_VERSION = "2026-07";
const DEFAULT_RECOVERY_DELAYS_MS = [250, 500, 1_000] as const;

const LOOKUP_QUERY = `
  query CircZlesCouponByCode($code: String!) {
    codeDiscountNodeByCode(code: $code) {
      id
      codeDiscount {
        __typename
        ... on DiscountCodeBasic {
          codes(first: 2) {
            nodes {
              code
            }
          }
        }
      }
    }
  }
`;

const CREATE_MUTATION = `
  mutation CircZlesCreateCoupon($input: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $input) {
      codeDiscountNode {
        id
        codeDiscount {
          __typename
          ... on DiscountCodeBasic {
            codes(first: 2) {
              nodes {
                code
              }
            }
          }
        }
      }
      userErrors {
        code
        field
        message
      }
    }
  }
`;

const DISABLE_MUTATION = `
  mutation CircZlesDisableCoupon($id: ID!) {
    discountCodeDeactivate(id: $id) {
      codeDiscountNode {
        id
      }
      userErrors {
        code
        field
        message
      }
    }
  }
`;

export type ShopifyCouponHttpClient = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type ShopifyCouponOperation = "LOOKUP" | "CREATE" | "DISABLE";

export class ShopifyCouponProviderError extends AppError {
  constructor(code: string, message: string, details: {
    storefront: "SHOPIFY_COGZART";
    operation: ShopifyCouponOperation;
    httpStatus?: number;
    retryable?: boolean;
  }) {
    super(code, message, 502, details);
  }
}

export class ShopifyCouponGateway implements CouponProviderGateway {
  private readonly fetchImpl: ShopifyCouponHttpClient;
  private readonly accessTokens: ShopifyAccessTokenProvider;
  private readonly recoveryDelaysMs: readonly number[];
  private readonly delay: (milliseconds: number) => Promise<void>;

  constructor(options: {
    fetchImpl?: ShopifyCouponHttpClient;
    accessTokens?: ShopifyAccessTokenProvider;
    recoveryDelaysMs?: readonly number[];
    delay?: (milliseconds: number) => Promise<void>;
  } = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.accessTokens = options.accessTokens ?? new ShopifyAppOAuthClient({ fetchImpl: this.fetchImpl });
    const delays = [...(options.recoveryDelaysMs ?? DEFAULT_RECOVERY_DELAYS_MS)].slice(0, DEFAULT_RECOVERY_DELAYS_MS.length);
    if (delays.some((milliseconds) => !Number.isSafeInteger(milliseconds) || milliseconds < 0)) {
      throw validationFailed("Shopify coupon recovery delays must be non-negative integer milliseconds.");
    }
    this.recoveryDelaysMs = delays;
    this.delay = options.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async provision(request: CouponProvisionRequest) {
    assertShopifyRequest(request);
    const existing = await this.findByExactCode(request.couponCode);
    if (existing) return { providerCouponId: existing };

    try {
      const response = await this.requestGraphql("CREATE", CREATE_MUTATION, buildShopifyCreateVariables(request));
      const providerCouponId = readCreateResult(response, request.couponCode);
      return { providerCouponId };
    } catch (error) {
      if (!isAmbiguousCreateFailure(error)) throw error;
      return { providerCouponId: await this.recoverAfterAmbiguousCreate(request.couponCode, error) };
    }
  }

  async disable(input: { storefrontTarget: CouponStorefrontTarget; providerCouponId: string; couponCode: string }) {
    assertShopifyStorefront(input.storefrontTarget);
    const providerCouponId = input.providerCouponId.trim();
    if (!isDiscountCodeNodeGid(providerCouponId)) {
      throw validationFailed("Shopify coupon disable requires a valid DiscountCodeNode id.");
    }
    const response = await this.requestGraphql("DISABLE", DISABLE_MUTATION, { id: providerCouponId });
    const data = readGraphqlData(response, "DISABLE");
    const payload = data.discountCodeDeactivate;
    if (!isRecord(payload)) throw invalidResponse("DISABLE");
    assertNoUserErrors(payload.userErrors, "DISABLE");
    if (!isRecord(payload.codeDiscountNode) || payload.codeDiscountNode.id !== providerCouponId) {
      throw invalidResponse("DISABLE");
    }
  }

  private async findByExactCode(couponCode: string) {
    const response = await this.requestGraphql("LOOKUP", LOOKUP_QUERY, { code: couponCode });
    const data = readGraphqlData(response, "LOOKUP");
    if (!("codeDiscountNodeByCode" in data)) throw invalidResponse("LOOKUP");
    const node = data.codeDiscountNodeByCode;
    if (node === null) return null;
    return readBasicDiscountNode(node, couponCode, "LOOKUP");
  }

  private async recoverAfterAmbiguousCreate(couponCode: string, createError: ShopifyCouponProviderError) {
    for (const delayMs of this.recoveryDelaysMs) {
      await this.delay(delayMs);
      try {
        const existing = await this.findByExactCode(couponCode);
        if (existing) return existing;
      } catch (error) {
        if (!isRetryableRecoveryLookupFailure(error)) throw error;
      }
    }
    throw new ShopifyCouponProviderError(
      "SHOPIFY_COUPON_RECOVERY_EXHAUSTED",
      "Shopify coupon creation could not be reconciled safely.",
      {
        storefront: "SHOPIFY_COGZART",
        operation: "CREATE",
        httpStatus: readHttpStatus(createError),
      },
    );
  }

  private async requestGraphql(operation: ShopifyCouponOperation, query: string, variables: Record<string, unknown>) {
    const shopDomain = this.accessTokens.getShopDomain();
    const accessToken = await this.accessTokens.getAccessToken();
    let response: Response;
    try {
      response = await this.fetchImpl(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch {
      throw new ShopifyCouponProviderError(
        "SHOPIFY_COUPON_REQUEST_FAILED",
        "Shopify coupon request failed before a response was received.",
        { storefront: "SHOPIFY_COGZART", operation, retryable: true },
      );
    }

    if (!response.ok) {
      throw new ShopifyCouponProviderError(
        "SHOPIFY_COUPON_HTTP_ERROR",
        "Shopify coupon request was rejected.",
        {
          storefront: "SHOPIFY_COGZART",
          operation,
          httpStatus: response.status,
          retryable: isRetryableHttpStatus(response.status),
        },
      );
    }

    const text = await response.text();
    if (!text.trim()) throw invalidResponse(operation);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw invalidResponse(operation);
    }
  }
}

export function buildShopifyCreateVariables(request: CouponProvisionRequest) {
  assertShopifyRequest(request);
  const value = request.benefit.type === "PERCENTAGE"
    ? { percentage: request.benefit.percentage / 100 }
    : { discountAmount: { amount: request.benefit.amount, appliesOnEachItem: false } };
  return {
    input: {
      title: `CircZles Reward ${request.couponCode}`,
      code: request.couponCode,
      startsAt: request.startsAt.toISOString(),
      endsAt: request.expiresAt?.toISOString() ?? null,
      context: { all: "ALL" },
      customerGets: {
        items: { all: true },
        value,
      },
      usageLimit: 1,
      appliesOncePerCustomer: true,
    },
  };
}

function assertShopifyRequest(request: CouponProvisionRequest) {
  assertShopifyStorefront(request.storefrontTarget);
  if (request.provider !== "SHOPIFY") {
    throw validationFailed("Shopify coupon gateway requires the Shopify provider.", { storefront: request.storefrontTarget });
  }
  if (!request.couponCode.trim()) throw validationFailed("Shopify coupon code is required.");
  if (Number.isNaN(request.startsAt.getTime()) || (request.expiresAt && Number.isNaN(request.expiresAt.getTime()))) {
    throw validationFailed("Shopify coupon dates must be valid.");
  }
  if (request.benefit.type === "PERCENTAGE") {
    if (!Number.isFinite(request.benefit.percentage) || request.benefit.percentage <= 0 || request.benefit.percentage > 100) {
      throw validationFailed("Shopify coupon percentage must be greater than 0 and at most 100.");
    }
  } else if (request.benefit.currency !== "USD" || !Number.isFinite(request.benefit.amount) || request.benefit.amount <= 0) {
    throw validationFailed("Shopify fixed-amount coupons require a positive USD amount.");
  }
}

function assertShopifyStorefront(storefrontTarget: CouponStorefrontTarget): asserts storefrontTarget is "SHOPIFY_COGZART" {
  if (storefrontTarget !== "SHOPIFY_COGZART") {
    throw validationFailed("Shopify coupon operations require SHOPIFY_COGZART.", { storefront: storefrontTarget });
  }
}

function readCreateResult(response: unknown, couponCode: string) {
  const data = readGraphqlData(response, "CREATE");
  const payload = data.discountCodeBasicCreate;
  if (!isRecord(payload)) throw invalidResponse("CREATE");
  assertNoUserErrors(payload.userErrors, "CREATE");
  return readBasicDiscountNode(payload.codeDiscountNode, couponCode, "CREATE");
}

function readBasicDiscountNode(node: unknown, couponCode: string, operation: "LOOKUP" | "CREATE") {
  if (!isRecord(node) || !isDiscountCodeNodeGid(node.id) || !isRecord(node.codeDiscount)) {
    throw invalidResponse(operation);
  }
  if (node.codeDiscount.__typename !== "DiscountCodeBasic") {
    throw new ShopifyCouponProviderError(
      "SHOPIFY_COUPON_TYPE_CONFLICT",
      "Shopify coupon code belongs to an incompatible discount type.",
      { storefront: "SHOPIFY_COGZART", operation },
    );
  }
  const codes = node.codeDiscount.codes;
  if (!isRecord(codes) || !Array.isArray(codes.nodes) || codes.nodes.length === 0) throw invalidResponse(operation);
  const returnedCodes = codes.nodes.map((item) => readNonblankString(item, "code"));
  if (returnedCodes.some((code) => code === null)) throw invalidResponse(operation);
  if (!returnedCodes.includes(couponCode)) {
    throw new ShopifyCouponProviderError(
      "SHOPIFY_COUPON_CODE_CONFLICT",
      "Shopify coupon lookup did not preserve the canonical coupon code.",
      { storefront: "SHOPIFY_COGZART", operation },
    );
  }
  return node.id;
}

function readGraphqlData(response: unknown, operation: ShopifyCouponOperation) {
  if (!isRecord(response)) throw invalidResponse(operation);
  if ("errors" in response) {
    if (!Array.isArray(response.errors)) throw invalidResponse(operation);
    if (response.errors.length > 0) {
      const retryable = response.errors.some((error) => isRecord(error)
        && isRecord(error.extensions) && error.extensions.code === "THROTTLED");
      throw new ShopifyCouponProviderError(
        "SHOPIFY_GRAPHQL_ERROR",
        "Shopify GraphQL returned an operation error.",
        { storefront: "SHOPIFY_COGZART", operation, retryable },
      );
    }
  }
  if (!isRecord(response.data)) throw invalidResponse(operation);
  return response.data;
}

function assertNoUserErrors(value: unknown, operation: "CREATE" | "DISABLE") {
  if (!Array.isArray(value)) throw invalidResponse(operation);
  if (value.length === 0) return;
  if (value.some((error) => !isRecord(error))) throw invalidResponse(operation);
  const codes = value.map((error) => readNonblankString(error, "code"));
  if (operation === "CREATE" && codes.some((code) => code === "DUPLICATE" || code === "IMPLICIT_DUPLICATE" || code === "TAKEN")) {
    throw new ShopifyCouponProviderError(
      "SHOPIFY_COUPON_CODE_DUPLICATE",
      "Shopify reported that the coupon code already exists.",
      { storefront: "SHOPIFY_COGZART", operation },
    );
  }
  const retryable = codes.includes("INTERNAL_ERROR");
  throw new ShopifyCouponProviderError(
    "SHOPIFY_COUPON_USER_ERROR",
    "Shopify rejected the coupon operation.",
    { storefront: "SHOPIFY_COGZART", operation, retryable },
  );
}

function invalidResponse(operation: ShopifyCouponOperation) {
  return new ShopifyCouponProviderError(
    "SHOPIFY_COUPON_RESPONSE_INVALID",
    "Shopify coupon response was invalid.",
    { storefront: "SHOPIFY_COGZART", operation },
  );
}

function isAmbiguousCreateFailure(error: unknown): error is ShopifyCouponProviderError {
  if (!(error instanceof ShopifyCouponProviderError) || readErrorDetails(error).operation !== "CREATE") return false;
  if (error.code === "SHOPIFY_COUPON_REQUEST_FAILED" || error.code === "SHOPIFY_COUPON_RESPONSE_INVALID"
    || error.code === "SHOPIFY_GRAPHQL_ERROR" || error.code === "SHOPIFY_COUPON_CODE_DUPLICATE") return true;
  return readErrorDetails(error).retryable === true;
}

function isRetryableRecoveryLookupFailure(error: unknown) {
  return error instanceof ShopifyCouponProviderError
    && readErrorDetails(error).operation === "LOOKUP"
    && readErrorDetails(error).retryable === true;
}

function isRetryableHttpStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function readErrorDetails(error: ShopifyCouponProviderError) {
  return isRecord(error.details) ? error.details : {};
}

function readHttpStatus(error: ShopifyCouponProviderError) {
  const status = readErrorDetails(error).httpStatus;
  return typeof status === "number" ? status : undefined;
}

function isDiscountCodeNodeGid(value: unknown): value is string {
  return typeof value === "string" && /^gid:\/\/shopify\/DiscountCodeNode\/[A-Za-z0-9_-]+$/.test(value);
}

function readNonblankString(value: unknown, key: string) {
  if (!isRecord(value) || typeof value[key] !== "string") return null;
  return value[key].trim() || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
