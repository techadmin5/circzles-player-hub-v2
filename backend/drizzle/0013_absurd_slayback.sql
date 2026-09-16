CREATE TYPE "public"."equipment_slot" AS ENUM('FRAME', 'AVATAR', 'BADGE_1', 'BADGE_2', 'BADGE_3');--> statement-breakpoint
CREATE TABLE "inventory_grants" (
	"inventory_grant_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"reward_definition_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_grants_quantity_check" CHECK ("inventory_grants"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "player_equipment" (
	"player_equipment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"slot" "equipment_slot" NOT NULL,
	"player_inventory_item_id" uuid NOT NULL,
	"equipped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_inventory_items" (
	"player_inventory_item_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"reward_definition_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"first_acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_inventory_items_quantity_check" CHECK ("player_inventory_items"."quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_grants" ADD CONSTRAINT "inventory_grants_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_grants" ADD CONSTRAINT "inventory_grants_reward_definition_id_reward_definitions_reward_definition_id_fk" FOREIGN KEY ("reward_definition_id") REFERENCES "public"."reward_definitions"("reward_definition_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_equipment" ADD CONSTRAINT "player_equipment_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_equipment" ADD CONSTRAINT "player_equipment_player_inventory_item_id_player_inventory_items_player_inventory_item_id_fk" FOREIGN KEY ("player_inventory_item_id") REFERENCES "public"."player_inventory_items"("player_inventory_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_inventory_items" ADD CONSTRAINT "player_inventory_items_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_inventory_items" ADD CONSTRAINT "player_inventory_items_reward_definition_id_reward_definitions_reward_definition_id_fk" FOREIGN KEY ("reward_definition_id") REFERENCES "public"."reward_definitions"("reward_definition_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_grants_player_id_idempotency_key_unique" ON "inventory_grants" USING btree ("player_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "inventory_grants_player_id_created_at_idx" ON "inventory_grants" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_grants_source_idx" ON "inventory_grants" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "player_equipment_player_id_slot_unique" ON "player_equipment" USING btree ("player_id","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "player_equipment_player_id_inventory_item_unique" ON "player_equipment" USING btree ("player_id","player_inventory_item_id");--> statement-breakpoint
CREATE INDEX "player_equipment_player_id_idx" ON "player_equipment" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "player_inventory_items_player_id_reward_definition_id_unique" ON "player_inventory_items" USING btree ("player_id","reward_definition_id");--> statement-breakpoint
CREATE INDEX "player_inventory_items_player_id_idx" ON "player_inventory_items" USING btree ("player_id");