CREATE TABLE "store_purchases" (
	"purchase_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"store_listing_id" uuid NOT NULL,
	"reward_definition_id" uuid NOT NULL,
	"price_synapse_points_snapshot" integer NOT NULL,
	"reward_type_snapshot" "reward_definition_type" NOT NULL,
	"reward_code_snapshot" text NOT NULL,
	"reward_name_snapshot" text NOT NULL,
	"rarity_snapshot" text,
	"image_url_snapshot" text,
	"point_transaction_id" uuid,
	"balance_after" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_purchases_price_synapse_points_snapshot_check" CHECK ("store_purchases"."price_synapse_points_snapshot" >= 0),
	CONSTRAINT "store_purchases_balance_after_check" CHECK ("store_purchases"."balance_after" >= 0),
	CONSTRAINT "store_purchases_point_transaction_link_check" CHECK (("store_purchases"."price_synapse_points_snapshot" = 0 and "store_purchases"."point_transaction_id" is null) or ("store_purchases"."price_synapse_points_snapshot" > 0 and "store_purchases"."point_transaction_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "store_purchases" ADD CONSTRAINT "store_purchases_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_purchases" ADD CONSTRAINT "store_purchases_store_listing_id_store_listings_store_listing_id_fk" FOREIGN KEY ("store_listing_id") REFERENCES "public"."store_listings"("store_listing_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_purchases" ADD CONSTRAINT "store_purchases_reward_definition_id_reward_definitions_reward_definition_id_fk" FOREIGN KEY ("reward_definition_id") REFERENCES "public"."reward_definitions"("reward_definition_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_purchases" ADD CONSTRAINT "store_purchases_point_transaction_id_point_transactions_transaction_id_fk" FOREIGN KEY ("point_transaction_id") REFERENCES "public"."point_transactions"("transaction_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_purchases_player_id_idempotency_key_unique" ON "store_purchases" USING btree ("player_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "store_purchases_point_transaction_id_unique" ON "store_purchases" USING btree ("point_transaction_id");--> statement-breakpoint
CREATE INDEX "store_purchases_player_id_store_listing_id_idx" ON "store_purchases" USING btree ("player_id","store_listing_id");--> statement-breakpoint
CREATE INDEX "store_purchases_player_id_purchased_at_idx" ON "store_purchases" USING btree ("player_id","purchased_at");