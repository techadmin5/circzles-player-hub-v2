CREATE TYPE "public"."coupon_provider" AS ENUM('WIX', 'SHOPIFY');--> statement-breakpoint
CREATE TYPE "public"."coupon_provider_sync_status" AS ENUM('PENDING_CREATE', 'ACTIVE', 'PENDING_DISABLE', 'DISABLED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."coupon_storefront_target" AS ENUM('WIX_CIRCZLES_IN', 'WIX_CIRCZLES_COM', 'WIX_COGZART_IN', 'WIX_COGZART_COM', 'SHOPIFY_COGZART');--> statement-breakpoint
CREATE TABLE "coupon_provider_mappings" (
	"coupon_provider_mapping_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_ownership_id" uuid NOT NULL,
	"storefront_target" "coupon_storefront_target" NOT NULL,
	"provider" "coupon_provider" NOT NULL,
	"provider_coupon_id" text,
	"sync_status" "coupon_provider_sync_status" DEFAULT 'PENDING_CREATE' NOT NULL,
	"last_sync_attempt_at" timestamp with time zone,
	"last_sync_succeeded_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_provider_mappings_provider_pair_check" CHECK (("coupon_provider_mappings"."storefront_target" in ('WIX_CIRCZLES_IN', 'WIX_CIRCZLES_COM', 'WIX_COGZART_IN', 'WIX_COGZART_COM') and "coupon_provider_mappings"."provider" = 'WIX') or ("coupon_provider_mappings"."storefront_target" = 'SHOPIFY_COGZART' and "coupon_provider_mappings"."provider" = 'SHOPIFY')),
	CONSTRAINT "coupon_provider_mappings_provider_coupon_id_check" CHECK ("coupon_provider_mappings"."provider_coupon_id" is null or btrim("coupon_provider_mappings"."provider_coupon_id") <> ''),
	CONSTRAINT "coupon_provider_mappings_sync_timestamp_check" CHECK (("coupon_provider_mappings"."last_sync_attempt_at" is null or ("coupon_provider_mappings"."last_sync_attempt_at" >= "coupon_provider_mappings"."created_at" and "coupon_provider_mappings"."last_sync_attempt_at" <= "coupon_provider_mappings"."updated_at")) and ("coupon_provider_mappings"."last_sync_succeeded_at" is null or ("coupon_provider_mappings"."last_sync_succeeded_at" >= "coupon_provider_mappings"."created_at" and "coupon_provider_mappings"."last_sync_succeeded_at" <= "coupon_provider_mappings"."updated_at")) and ("coupon_provider_mappings"."disabled_at" is null or ("coupon_provider_mappings"."disabled_at" >= "coupon_provider_mappings"."created_at" and "coupon_provider_mappings"."disabled_at" <= "coupon_provider_mappings"."updated_at"))),
	CONSTRAINT "coupon_provider_mappings_disabled_state_check" CHECK (("coupon_provider_mappings"."sync_status" = 'DISABLED' and "coupon_provider_mappings"."disabled_at" is not null) or ("coupon_provider_mappings"."sync_status" <> 'DISABLED' and "coupon_provider_mappings"."disabled_at" is null)),
	CONSTRAINT "coupon_provider_mappings_updated_at_check" CHECK ("coupon_provider_mappings"."updated_at" >= "coupon_provider_mappings"."created_at")
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"coupon_redemption_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_ownership_id" uuid NOT NULL,
	"storefront_target" "coupon_storefront_target" NOT NULL,
	"source_redemption_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"redeemed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_redemptions_source_redemption_id_check" CHECK (btrim("coupon_redemptions"."source_redemption_id") <> ''),
	CONSTRAINT "coupon_redemptions_idempotency_key_check" CHECK (btrim("coupon_redemptions"."idempotency_key") <> '')
);
--> statement-breakpoint
ALTER TABLE "coupon_ownerships" ADD COLUMN "coupon_code" text;--> statement-breakpoint
UPDATE "coupon_ownerships"
SET "coupon_code" = 'CZ' || upper(substr(md5("coupon_ownership_id"::text), 1, 16))
WHERE "coupon_code" IS NULL;--> statement-breakpoint
ALTER TABLE "coupon_ownerships" ALTER COLUMN "coupon_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "coupon_provider_mappings" ADD CONSTRAINT "coupon_provider_mappings_coupon_ownership_id_coupon_ownerships_coupon_ownership_id_fk" FOREIGN KEY ("coupon_ownership_id") REFERENCES "public"."coupon_ownerships"("coupon_ownership_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_ownership_id_coupon_ownerships_coupon_ownership_id_fk" FOREIGN KEY ("coupon_ownership_id") REFERENCES "public"."coupon_ownerships"("coupon_ownership_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_provider_mappings_ownership_storefront_unique" ON "coupon_provider_mappings" USING btree ("coupon_ownership_id","storefront_target");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_provider_mappings_storefront_provider_coupon_id_unique" ON "coupon_provider_mappings" USING btree ("storefront_target","provider_coupon_id") WHERE "coupon_provider_mappings"."provider_coupon_id" is not null;--> statement-breakpoint
CREATE INDEX "coupon_provider_mappings_coupon_ownership_id_idx" ON "coupon_provider_mappings" USING btree ("coupon_ownership_id");--> statement-breakpoint
CREATE INDEX "coupon_provider_mappings_provider_sync_status_idx" ON "coupon_provider_mappings" USING btree ("provider","sync_status");--> statement-breakpoint
CREATE INDEX "coupon_provider_mappings_storefront_sync_status_idx" ON "coupon_provider_mappings" USING btree ("storefront_target","sync_status");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_redemptions_coupon_ownership_id_unique" ON "coupon_redemptions" USING btree ("coupon_ownership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_redemptions_ownership_idempotency_key_unique" ON "coupon_redemptions" USING btree ("coupon_ownership_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_redemptions_storefront_source_unique" ON "coupon_redemptions" USING btree ("storefront_target","source_redemption_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_storefront_redeemed_at_idx" ON "coupon_redemptions" USING btree ("storefront_target","redeemed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_ownerships_coupon_code_unique" ON "coupon_ownerships" USING btree ("coupon_code");--> statement-breakpoint
ALTER TABLE "coupon_ownerships" ADD CONSTRAINT "coupon_ownerships_coupon_code_check" CHECK (char_length("coupon_ownerships"."coupon_code") between 1 and 20 and "coupon_ownerships"."coupon_code" ~ '^[A-Z0-9]+$');
