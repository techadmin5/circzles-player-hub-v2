CREATE TYPE "public"."reward_definition_type" AS ENUM('FRAME', 'BADGE', 'AVATAR', 'RENAME_CARD', 'COUPON', 'SYNAPSE_POINTS', 'XP', 'COSMETIC');--> statement-breakpoint
CREATE TABLE "reward_definitions" (
	"reward_definition_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reward_type" "reward_definition_type" NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"image_url" text,
	"rarity" text,
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_listings" (
	"store_listing_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reward_definition_id" uuid NOT NULL,
	"price_synapse_points" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"available_from" timestamp with time zone,
	"available_until" timestamp with time zone,
	"purchase_limit" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_listings_price_synapse_points_check" CHECK ("store_listings"."price_synapse_points" >= 0),
	CONSTRAINT "store_listings_display_order_check" CHECK ("store_listings"."display_order" >= 0),
	CONSTRAINT "store_listings_purchase_limit_check" CHECK ("store_listings"."purchase_limit" is null or "store_listings"."purchase_limit" > 0),
	CONSTRAINT "store_listings_availability_check" CHECK ("store_listings"."available_until" is null or "store_listings"."available_from" is null or "store_listings"."available_until" > "store_listings"."available_from")
);
--> statement-breakpoint
ALTER TABLE "store_listings" ADD CONSTRAINT "store_listings_reward_definition_id_reward_definitions_reward_definition_id_fk" FOREIGN KEY ("reward_definition_id") REFERENCES "public"."reward_definitions"("reward_definition_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reward_definitions_code_unique" ON "reward_definitions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "reward_definitions_active_idx" ON "reward_definitions" USING btree ("active");--> statement-breakpoint
CREATE INDEX "store_listings_reward_definition_id_idx" ON "store_listings" USING btree ("reward_definition_id");--> statement-breakpoint
CREATE INDEX "store_listings_catalog_order_idx" ON "store_listings" USING btree ("active","featured","display_order");