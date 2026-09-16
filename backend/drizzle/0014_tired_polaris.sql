CREATE TABLE "inventory_consumptions" (
	"inventory_consumption_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"player_inventory_item_id" uuid NOT NULL,
	"reward_definition_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"quantity_after" integer NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_consumptions_quantity_check" CHECK ("inventory_consumptions"."quantity" > 0),
	CONSTRAINT "inventory_consumptions_quantity_after_check" CHECK ("inventory_consumptions"."quantity_after" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "inventory_consumptions_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "inventory_consumptions_player_inventory_item_id_player_inventory_items_player_inventory_item_id_fk" FOREIGN KEY ("player_inventory_item_id") REFERENCES "public"."player_inventory_items"("player_inventory_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "inventory_consumptions_reward_definition_id_reward_definitions_reward_definition_id_fk" FOREIGN KEY ("reward_definition_id") REFERENCES "public"."reward_definitions"("reward_definition_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_consumptions_player_id_idempotency_key_unique" ON "inventory_consumptions" USING btree ("player_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "inventory_consumptions_player_id_created_at_idx" ON "inventory_consumptions" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_consumptions_player_inventory_item_id_idx" ON "inventory_consumptions" USING btree ("player_inventory_item_id");