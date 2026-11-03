CREATE TABLE "mission_earned_collectibles" (
	"progress_id" uuid PRIMARY KEY NOT NULL,
	"reward_definition_id" uuid NOT NULL,
	"reward_type" text NOT NULL,
	"disposition" text DEFAULT 'PENDING' NOT NULL,
	CONSTRAINT "mission_collectible_type_check" CHECK ("mission_earned_collectibles"."reward_type" IN ('BADGE','FRAME')),
	CONSTRAINT "mission_collectible_state_check" CHECK ("mission_earned_collectibles"."disposition" IN ('PENDING','GRANTED','ALREADY_OWNED'))
);
--> statement-breakpoint
CREATE TABLE "mission_event_contributions" (
	"player_id" uuid NOT NULL,
	"mission_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"contribution_key" text NOT NULL,
	"game_event_id" uuid NOT NULL,
	CONSTRAINT "mission_event_contributions_player_id_mission_id_period_key_contribution_key_pk" PRIMARY KEY("player_id","mission_id","period_key","contribution_key")
);
--> statement-breakpoint
CREATE TABLE "mission_starter_batch_items" (
	"batch_key" text NOT NULL,
	"definition_key" text NOT NULL,
	"mission_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	CONSTRAINT "mission_starter_batch_items_batch_key_definition_key_pk" PRIMARY KEY("batch_key","definition_key"),
	CONSTRAINT "mission_starter_batch_items_mission_id_unique" UNIQUE("mission_id")
);
--> statement-breakpoint
CREATE TABLE "mission_tracking_configs" (
	"mission_id" uuid PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"first_ever" boolean DEFAULT false NOT NULL,
	"eligible_mission_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"collectible_id" uuid,
	CONSTRAINT "mission_tracking_mode_check" CHECK ("mission_tracking_configs"."mode" IN ('EVENT_COUNT','DISTINCT_UTC_DAYS','DISTINCT_MISSIONS')),
	CONSTRAINT "mission_tracking_ids_check" CHECK (jsonb_typeof("mission_tracking_configs"."eligible_mission_ids") = 'array')
);
--> statement-breakpoint
ALTER TABLE "mission_earned_collectibles" ADD CONSTRAINT "mission_earned_collectibles_progress_id_player_mission_progress_player_mission_progress_id_fk" FOREIGN KEY ("progress_id") REFERENCES "public"."player_mission_progress"("player_mission_progress_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_earned_collectibles" ADD CONSTRAINT "mission_earned_collectibles_reward_definition_id_reward_definitions_reward_definition_id_fk" FOREIGN KEY ("reward_definition_id") REFERENCES "public"."reward_definitions"("reward_definition_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_event_contributions" ADD CONSTRAINT "mission_event_contributions_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_event_contributions" ADD CONSTRAINT "mission_event_contributions_mission_id_missions_mission_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("mission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_event_contributions" ADD CONSTRAINT "mission_event_contributions_game_event_id_game_events_game_event_id_fk" FOREIGN KEY ("game_event_id") REFERENCES "public"."game_events"("game_event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_starter_batch_items" ADD CONSTRAINT "mission_starter_batch_items_mission_id_missions_mission_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("mission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_tracking_configs" ADD CONSTRAINT "mission_tracking_configs_mission_id_missions_mission_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("mission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_tracking_configs" ADD CONSTRAINT "mission_tracking_configs_collectible_id_reward_definitions_reward_definition_id_fk" FOREIGN KEY ("collectible_id") REFERENCES "public"."reward_definitions"("reward_definition_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION mission_collectible_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'Earned collectibles cannot be deleted or truncated'; END IF;
  IF OLD.progress_id IS DISTINCT FROM NEW.progress_id OR OLD.reward_definition_id IS DISTINCT FROM NEW.reward_definition_id OR OLD.reward_type IS DISTINCT FROM NEW.reward_type OR OLD.disposition <> 'PENDING' THEN
    RAISE EXCEPTION 'Earned collectible snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER mission_collectible_frozen BEFORE UPDATE OR DELETE ON mission_earned_collectibles FOR EACH ROW EXECUTE FUNCTION mission_collectible_frozen();
--> statement-breakpoint
CREATE TRIGGER mission_collectible_no_truncate BEFORE TRUNCATE ON mission_earned_collectibles FOR EACH STATEMENT EXECUTE FUNCTION mission_collectible_frozen();
--> statement-breakpoint
CREATE TRIGGER mission_contributions_immutable BEFORE UPDATE OR DELETE ON mission_event_contributions FOR EACH ROW EXECUTE FUNCTION mission_approval_immutable();
--> statement-breakpoint
CREATE TRIGGER mission_contributions_no_truncate BEFORE TRUNCATE ON mission_event_contributions FOR EACH STATEMENT EXECUTE FUNCTION mission_approval_immutable();
--> statement-breakpoint
CREATE TRIGGER mission_batch_items_immutable BEFORE UPDATE OR DELETE ON mission_starter_batch_items FOR EACH ROW EXECUTE FUNCTION mission_approval_immutable();
--> statement-breakpoint
CREATE TRIGGER mission_batch_items_no_truncate BEFORE TRUNCATE ON mission_starter_batch_items FOR EACH STATEMENT EXECUTE FUNCTION mission_approval_immutable();
