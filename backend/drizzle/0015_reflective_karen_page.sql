CREATE TABLE "reward_wheel_segments" (
	"reward_wheel_segment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reward_wheel_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"display_label" text NOT NULL,
	"weight" integer NOT NULL,
	"reward_definition_id" uuid NOT NULL,
	"reward_quantity" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"display_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_wheel_segments_position_check" CHECK ("reward_wheel_segments"."position" >= 0),
	CONSTRAINT "reward_wheel_segments_weight_check" CHECK ("reward_wheel_segments"."weight" > 0),
	CONSTRAINT "reward_wheel_segments_reward_quantity_check" CHECK ("reward_wheel_segments"."reward_quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "reward_wheel_spins" (
	"reward_wheel_spin_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"reward_wheel_id" uuid NOT NULL,
	"reward_wheel_segment_id" uuid NOT NULL,
	"reward_definition_id" uuid NOT NULL,
	"wheel_code_snapshot" text NOT NULL,
	"wheel_name_snapshot" text NOT NULL,
	"segment_position_snapshot" integer NOT NULL,
	"segment_label_snapshot" text NOT NULL,
	"spin_cost_synapse_points_snapshot" integer NOT NULL,
	"cooldown_seconds_snapshot" integer NOT NULL,
	"reward_quantity_snapshot" integer NOT NULL,
	"reward_type_snapshot" "reward_definition_type" NOT NULL,
	"reward_code_snapshot" text NOT NULL,
	"reward_name_snapshot" text NOT NULL,
	"reward_rarity_snapshot" text,
	"reward_image_url_snapshot" text,
	"resulting_synapse_point_balance" integer NOT NULL,
	"cost_point_transaction_id" uuid,
	"reward_point_transaction_id" uuid,
	"reward_xp_transaction_id" uuid,
	"reward_inventory_grant_id" uuid,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"spun_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_wheel_spins_segment_position_snapshot_check" CHECK ("reward_wheel_spins"."segment_position_snapshot" >= 0),
	CONSTRAINT "reward_wheel_spins_spin_cost_snapshot_check" CHECK ("reward_wheel_spins"."spin_cost_synapse_points_snapshot" >= 0),
	CONSTRAINT "reward_wheel_spins_cooldown_snapshot_check" CHECK ("reward_wheel_spins"."cooldown_seconds_snapshot" >= 0),
	CONSTRAINT "reward_wheel_spins_reward_quantity_snapshot_check" CHECK ("reward_wheel_spins"."reward_quantity_snapshot" > 0),
	CONSTRAINT "reward_wheel_spins_resulting_balance_check" CHECK ("reward_wheel_spins"."resulting_synapse_point_balance" >= 0),
	CONSTRAINT "reward_wheel_spins_cost_ledger_link_check" CHECK (("reward_wheel_spins"."spin_cost_synapse_points_snapshot" = 0 and "reward_wheel_spins"."cost_point_transaction_id" is null) or ("reward_wheel_spins"."spin_cost_synapse_points_snapshot" > 0 and "reward_wheel_spins"."cost_point_transaction_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "reward_wheels" (
	"reward_wheel_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"spin_cost_synapse_points" integer DEFAULT 0 NOT NULL,
	"cooldown_seconds" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_wheels_spin_cost_check" CHECK ("reward_wheels"."spin_cost_synapse_points" >= 0),
	CONSTRAINT "reward_wheels_cooldown_check" CHECK ("reward_wheels"."cooldown_seconds" >= 0),
	CONSTRAINT "reward_wheels_availability_check" CHECK ("reward_wheels"."ends_at" is null or "reward_wheels"."starts_at" is null or "reward_wheels"."ends_at" > "reward_wheels"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "reward_wheel_segments" ADD CONSTRAINT "reward_wheel_segments_reward_wheel_id_reward_wheels_reward_wheel_id_fk" FOREIGN KEY ("reward_wheel_id") REFERENCES "public"."reward_wheels"("reward_wheel_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_wheel_segments" ADD CONSTRAINT "reward_wheel_segments_reward_definition_id_reward_definitions_reward_definition_id_fk" FOREIGN KEY ("reward_definition_id") REFERENCES "public"."reward_definitions"("reward_definition_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_wheel_spins" ADD CONSTRAINT "reward_wheel_spins_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_wheel_spins" ADD CONSTRAINT "reward_wheel_spins_reward_wheel_id_reward_wheels_reward_wheel_id_fk" FOREIGN KEY ("reward_wheel_id") REFERENCES "public"."reward_wheels"("reward_wheel_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_wheel_spins" ADD CONSTRAINT "reward_wheel_spins_reward_wheel_segment_id_reward_wheel_segments_reward_wheel_segment_id_fk" FOREIGN KEY ("reward_wheel_segment_id") REFERENCES "public"."reward_wheel_segments"("reward_wheel_segment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_wheel_spins" ADD CONSTRAINT "reward_wheel_spins_reward_definition_id_reward_definitions_reward_definition_id_fk" FOREIGN KEY ("reward_definition_id") REFERENCES "public"."reward_definitions"("reward_definition_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_wheel_spins" ADD CONSTRAINT "reward_wheel_spins_cost_point_transaction_id_point_transactions_transaction_id_fk" FOREIGN KEY ("cost_point_transaction_id") REFERENCES "public"."point_transactions"("transaction_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_wheel_spins" ADD CONSTRAINT "reward_wheel_spins_reward_point_transaction_id_point_transactions_transaction_id_fk" FOREIGN KEY ("reward_point_transaction_id") REFERENCES "public"."point_transactions"("transaction_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_wheel_spins" ADD CONSTRAINT "reward_wheel_spins_reward_xp_transaction_id_xp_transactions_xp_transaction_id_fk" FOREIGN KEY ("reward_xp_transaction_id") REFERENCES "public"."xp_transactions"("xp_transaction_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_wheel_spins" ADD CONSTRAINT "reward_wheel_spins_reward_inventory_grant_id_inventory_grants_inventory_grant_id_fk" FOREIGN KEY ("reward_inventory_grant_id") REFERENCES "public"."inventory_grants"("inventory_grant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reward_wheel_segments_wheel_id_position_unique" ON "reward_wheel_segments" USING btree ("reward_wheel_id","position");--> statement-breakpoint
CREATE INDEX "reward_wheel_segments_wheel_id_active_position_idx" ON "reward_wheel_segments" USING btree ("reward_wheel_id","active","position");--> statement-breakpoint
CREATE INDEX "reward_wheel_segments_reward_definition_id_idx" ON "reward_wheel_segments" USING btree ("reward_definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reward_wheel_spins_player_id_idempotency_key_unique" ON "reward_wheel_spins" USING btree ("player_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "reward_wheel_spins_player_id_spun_at_idx" ON "reward_wheel_spins" USING btree ("player_id","spun_at");--> statement-breakpoint
CREATE INDEX "reward_wheel_spins_player_id_wheel_id_spun_at_idx" ON "reward_wheel_spins" USING btree ("player_id","reward_wheel_id","spun_at");--> statement-breakpoint
CREATE INDEX "reward_wheel_spins_wheel_id_spun_at_idx" ON "reward_wheel_spins" USING btree ("reward_wheel_id","spun_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reward_wheels_code_unique" ON "reward_wheels" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "reward_wheels_single_active_unique" ON "reward_wheels" USING btree ("active") WHERE "reward_wheels"."active" = true;--> statement-breakpoint
CREATE INDEX "reward_wheels_active_window_idx" ON "reward_wheels" USING btree ("active","starts_at","ends_at");