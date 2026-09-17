CREATE TYPE "public"."coupon_ownership_status" AS ENUM('ACTIVE', 'REDEEMED', 'REVOKED');--> statement-breakpoint
CREATE TABLE "coupon_ownerships" (
	"coupon_ownership_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"reward_definition_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"issuance_ordinal" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "coupon_ownership_status" DEFAULT 'ACTIVE' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "coupon_ownerships_issuance_ordinal_check" CHECK ("coupon_ownerships"."issuance_ordinal" > 0),
	CONSTRAINT "coupon_ownerships_expiry_check" CHECK ("coupon_ownerships"."expires_at" is null or "coupon_ownerships"."expires_at" > "coupon_ownerships"."issued_at"),
	CONSTRAINT "coupon_ownerships_redeemed_at_check" CHECK ("coupon_ownerships"."redeemed_at" is null or "coupon_ownerships"."redeemed_at" >= "coupon_ownerships"."issued_at"),
	CONSTRAINT "coupon_ownerships_revoked_at_check" CHECK ("coupon_ownerships"."revoked_at" is null or "coupon_ownerships"."revoked_at" >= "coupon_ownerships"."issued_at"),
	CONSTRAINT "coupon_ownerships_lifecycle_check" CHECK (("coupon_ownerships"."status" = 'ACTIVE' and "coupon_ownerships"."redeemed_at" is null and "coupon_ownerships"."revoked_at" is null) or ("coupon_ownerships"."status" = 'REDEEMED' and "coupon_ownerships"."redeemed_at" is not null and "coupon_ownerships"."revoked_at" is null) or ("coupon_ownerships"."status" = 'REVOKED' and "coupon_ownerships"."redeemed_at" is null and "coupon_ownerships"."revoked_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "coupon_ownerships" ADD CONSTRAINT "coupon_ownerships_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_ownerships" ADD CONSTRAINT "coupon_ownerships_reward_definition_id_reward_definitions_reward_definition_id_fk" FOREIGN KEY ("reward_definition_id") REFERENCES "public"."reward_definitions"("reward_definition_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_ownerships_player_id_idempotency_key_ordinal_unique" ON "coupon_ownerships" USING btree ("player_id","idempotency_key","issuance_ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_ownerships_player_source_ordinal_unique" ON "coupon_ownerships" USING btree ("player_id","source_type","source_id","issuance_ordinal");--> statement-breakpoint
CREATE INDEX "coupon_ownerships_player_id_issued_at_idx" ON "coupon_ownerships" USING btree ("player_id","issued_at");--> statement-breakpoint
CREATE INDEX "coupon_ownerships_player_id_status_idx" ON "coupon_ownerships" USING btree ("player_id","status");--> statement-breakpoint
CREATE INDEX "coupon_ownerships_source_idx" ON "coupon_ownerships" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "coupon_ownerships_reward_definition_id_idx" ON "coupon_ownerships" USING btree ("reward_definition_id");