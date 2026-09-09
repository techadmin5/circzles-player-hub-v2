CREATE TABLE "mission_rewards" (
	"mission_reward_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"reward_type" text NOT NULL,
	"amount" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mission_rewards_amount_check" CHECK ("mission_rewards"."amount" > 0),
	CONSTRAINT "mission_rewards_display_order_check" CHECK ("mission_rewards"."display_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mission_rules" (
	"mission_rule_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"target_count" integer NOT NULL,
	"source_type" text,
	"puzzle_id" uuid,
	"level_id" numeric(4, 1),
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mission_rules_target_count_check" CHECK ("mission_rules"."target_count" > 0),
	CONSTRAINT "mission_rules_level_id_check" CHECK ("mission_rules"."level_id" is null or "mission_rules"."level_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"mission_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"period_type" text NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "missions_display_order_check" CHECK ("missions"."display_order" >= 0),
	CONSTRAINT "missions_date_window_check" CHECK ("missions"."starts_at" is null or "missions"."ends_at" is null or "missions"."ends_at" > "missions"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "player_mission_progress" (
	"player_mission_progress_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"mission_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"current_count" integer DEFAULT 0 NOT NULL,
	"target_count_snapshot" integer NOT NULL,
	"status" text DEFAULT 'IN_PROGRESS' NOT NULL,
	"completed_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"last_game_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_mission_progress_current_count_check" CHECK ("player_mission_progress"."current_count" >= 0 and "player_mission_progress"."current_count" <= "player_mission_progress"."target_count_snapshot"),
	CONSTRAINT "player_mission_progress_target_count_snapshot_check" CHECK ("player_mission_progress"."target_count_snapshot" > 0),
	CONSTRAINT "player_mission_progress_status_check" CHECK ("player_mission_progress"."status" in ('IN_PROGRESS', 'CLAIMABLE', 'CLAIMED'))
);
--> statement-breakpoint
ALTER TABLE "mission_rewards" ADD CONSTRAINT "mission_rewards_mission_id_missions_mission_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("mission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_rules" ADD CONSTRAINT "mission_rules_mission_id_missions_mission_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("mission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_rules" ADD CONSTRAINT "mission_rules_puzzle_id_puzzles_puzzle_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("puzzle_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_mission_progress" ADD CONSTRAINT "player_mission_progress_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_mission_progress" ADD CONSTRAINT "player_mission_progress_mission_id_missions_mission_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("mission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_mission_progress" ADD CONSTRAINT "player_mission_progress_last_game_event_id_game_events_game_event_id_fk" FOREIGN KEY ("last_game_event_id") REFERENCES "public"."game_events"("game_event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mission_rewards_mission_id_display_order_idx" ON "mission_rewards" USING btree ("mission_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "mission_rules_mission_id_unique" ON "mission_rules" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "mission_rules_event_type_active_idx" ON "mission_rules" USING btree ("event_type","active");--> statement-breakpoint
CREATE INDEX "missions_visibility_idx" ON "missions" USING btree ("active","starts_at","ends_at","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "player_mission_progress_player_mission_period_unique" ON "player_mission_progress" USING btree ("player_id","mission_id","period_key");--> statement-breakpoint
CREATE INDEX "player_mission_progress_player_status_idx" ON "player_mission_progress" USING btree ("player_id","status");--> statement-breakpoint
CREATE INDEX "player_mission_progress_mission_period_idx" ON "player_mission_progress" USING btree ("mission_id","period_key");