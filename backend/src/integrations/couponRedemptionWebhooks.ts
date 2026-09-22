import type { CouponRedemptionSyncResult, CouponRedemptionSyncService } from "../domain/couponRedemptionSync.js";
import type { ShopifyWebhookHeaders, ShopifyOrdersPaidWebhook } from "./shopify/shopifyWebhook.js";
import type { WixCouponAppliedWebhook } from "./wix/wixWebhook.js";

export interface CouponRedemptionWebhookHandler {
  handleWix(rawBody: Buffer): Promise<CouponRedemptionSyncResult>;
  handleShopify(rawBody: Buffer, headers: ShopifyWebhookHeaders): Promise<CouponRedemptionSyncResult>;
}

export class ProviderCouponRedemptionWebhookHandler implements CouponRedemptionWebhookHandler {
  constructor(
    private wix: WixCouponAppliedWebhook,
    private shopify: ShopifyOrdersPaidWebhook,
    private redemptionSync: CouponRedemptionSyncService,
  ) {}

  handleWix(rawBody: Buffer) {
    return this.redemptionSync.synchronize(this.wix.verifyAndParse(rawBody));
  }

  async handleShopify(rawBody: Buffer, headers: ShopifyWebhookHeaders) {
    const event = this.shopify.verifyAndParse(rawBody, headers);
    return event ? this.redemptionSync.synchronize(event) : { status: "IGNORED" as const };
  }
}
