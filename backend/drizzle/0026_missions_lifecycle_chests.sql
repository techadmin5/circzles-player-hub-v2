CREATE TABLE "mission_chest_claims" (
	"chest_claim_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_chest_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"chest_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"reward_snapshot" jsonb NOT NULL,
	"point_transaction_id" uuid,
	"xp_transaction_id" uuid,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mission_chest_completions" (
	"completion_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_chest_id" uuid NOT NULL,
	"mission_id" uuid NOT NULL,
	"player_mission_progress_id" uuid NOT NULL,
	"game_event_id" uuid NOT NULL,
	"eligibility_id" uuid NOT NULL,
	"eligibility_effective_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mission_chest_eligibility" (
	"eligibility_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chest_id" uuid NOT NULL,
	"mission_id" uuid NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mission_chests" (
	"chest_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"period_type" text NOT NULL,
	"target_count" integer NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"activation_effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"rewards" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mission_chests_period_check" CHECK ("mission_chests"."period_type" IN ('DAILY', 'WEEKLY')),
	CONSTRAINT "mission_chests_target_check" CHECK ("mission_chests"."target_count" > 0),
	CONSTRAINT "mission_chests_window_check" CHECK ("mission_chests"."ends_at" IS NULL OR "mission_chests"."starts_at" IS NULL OR "mission_chests"."ends_at" > "mission_chests"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "mission_event_attempts" (
	"game_event_id" uuid PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"quarantined_at" timestamp with time zone,
	"error_code" text NOT NULL,
	CONSTRAINT "mission_event_attempts_count_check" CHECK ("mission_event_attempts"."attempts" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE TABLE "mission_processing_failures" (
	"failure_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_event_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"error_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_mission_chests" (
	"player_chest_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"chest_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"target_count_snapshot" integer NOT NULL,
	"current_count" integer DEFAULT 0 NOT NULL,
	"period_starts_at" timestamp with time zone NOT NULL,
	"period_ends_at" timestamp with time zone NOT NULL,
	"claim_deadline" timestamp with time zone NOT NULL,
	"reward_snapshot" jsonb,
	"unlocked_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	CONSTRAINT "player_mission_chests_count_check" CHECK ("player_mission_chests"."target_count_snapshot" > 0 AND "player_mission_chests"."current_count" BETWEEN 0 AND "player_mission_chests"."target_count_snapshot")
);
--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "activation_effective_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "claim_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "player_mission_progress" ADD COLUMN "reward_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "player_mission_progress" ADD COLUMN "period_starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "player_mission_progress" ADD COLUMN "period_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "player_mission_progress" ADD COLUMN "claim_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "player_mission_progress" ADD COLUMN "expired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mission_chest_claims" ADD CONSTRAINT "mission_chest_claims_player_chest_id_player_mission_chests_player_chest_id_fk" FOREIGN KEY ("player_chest_id") REFERENCES "public"."player_mission_chests"("player_chest_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_chest_claims" ADD CONSTRAINT "mission_chest_claims_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_chest_claims" ADD CONSTRAINT "mission_chest_claims_chest_id_mission_chests_chest_id_fk" FOREIGN KEY ("chest_id") REFERENCES "public"."mission_chests"("chest_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_chest_claims" ADD CONSTRAINT "mission_chest_claims_point_transaction_id_point_transactions_transaction_id_fk" FOREIGN KEY ("point_transaction_id") REFERENCES "public"."point_transactions"("transaction_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_chest_claims" ADD CONSTRAINT "mission_chest_claims_xp_transaction_id_xp_transactions_xp_transaction_id_fk" FOREIGN KEY ("xp_transaction_id") REFERENCES "public"."xp_transactions"("xp_transaction_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_chest_completions" ADD CONSTRAINT "mission_chest_completions_player_chest_id_player_mission_chests_player_chest_id_fk" FOREIGN KEY ("player_chest_id") REFERENCES "public"."player_mission_chests"("player_chest_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_chest_completions" ADD CONSTRAINT "mission_chest_completions_mission_id_missions_mission_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("mission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_chest_completions" ADD CONSTRAINT "mission_chest_completions_player_mission_progress_id_player_mission_progress_player_mission_progress_id_fk" FOREIGN KEY ("player_mission_progress_id") REFERENCES "public"."player_mission_progress"("player_mission_progress_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_chest_completions" ADD CONSTRAINT "mission_chest_completions_game_event_id_game_events_game_event_id_fk" FOREIGN KEY ("game_event_id") REFERENCES "public"."game_events"("game_event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_chest_completions" ADD CONSTRAINT "mission_chest_completions_eligibility_id_mission_chest_eligibility_eligibility_id_fk" FOREIGN KEY ("eligibility_id") REFERENCES "public"."mission_chest_eligibility"("eligibility_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_chest_eligibility" ADD CONSTRAINT "mission_chest_eligibility_chest_id_mission_chests_chest_id_fk" FOREIGN KEY ("chest_id") REFERENCES "public"."mission_chests"("chest_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_chest_eligibility" ADD CONSTRAINT "mission_chest_eligibility_mission_id_missions_mission_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("mission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_event_attempts" ADD CONSTRAINT "mission_event_attempts_game_event_id_game_events_game_event_id_fk" FOREIGN KEY ("game_event_id") REFERENCES "public"."game_events"("game_event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_processing_failures" ADD CONSTRAINT "mission_processing_failures_game_event_id_game_events_game_event_id_fk" FOREIGN KEY ("game_event_id") REFERENCES "public"."game_events"("game_event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_mission_chests" ADD CONSTRAINT "player_mission_chests_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_mission_chests" ADD CONSTRAINT "player_mission_chests_chest_id_mission_chests_chest_id_fk" FOREIGN KEY ("chest_id") REFERENCES "public"."mission_chests"("chest_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mission_chest_claims_period_unique" ON "mission_chest_claims" USING btree ("player_id","chest_id","period_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mission_chest_claims_key_unique" ON "mission_chest_claims" USING btree ("player_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mission_chest_claims_progress_unique" ON "mission_chest_claims" USING btree ("player_chest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mission_chest_completions_distinct_unique" ON "mission_chest_completions" USING btree ("player_chest_id","mission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mission_chest_eligibility_unique" ON "mission_chest_eligibility" USING btree ("chest_id","mission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mission_processing_failures_unique" ON "mission_processing_failures" USING btree ("game_event_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "player_mission_chests_period_unique" ON "player_mission_chests" USING btree ("player_id","chest_id","period_key");--> statement-breakpoint
CREATE INDEX "player_mission_chests_player_idx" ON "player_mission_chests" USING btree ("player_id");
--> statement-breakpoint
-- Application-owned lifecycle fields are frozen once earned. No historical snapshots are fabricated.
CREATE FUNCTION mission_earned_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.reward_snapshot IS NOT NULL AND
     (NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot OR
      NEW.period_starts_at IS DISTINCT FROM OLD.period_starts_at OR
      NEW.period_ends_at IS DISTINCT FROM OLD.period_ends_at OR
      NEW.claim_deadline IS DISTINCT FROM OLD.claim_deadline OR
      NEW.completed_at IS DISTINCT FROM OLD.completed_at OR
      NEW.target_count_snapshot IS DISTINCT FROM OLD.target_count_snapshot OR
      NEW.period_key IS DISTINCT FROM OLD.period_key OR
      NEW.player_id IS DISTINCT FROM OLD.player_id OR NEW.mission_id IS DISTINCT FROM OLD.mission_id) THEN
    RAISE EXCEPTION 'Earned mission snapshot is immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER mission_earned_snapshot_immutable BEFORE UPDATE ON player_mission_progress FOR EACH ROW EXECUTE FUNCTION mission_earned_snapshot_immutable();
--> statement-breakpoint
CREATE FUNCTION chest_earned_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.reward_snapshot IS NOT NULL AND
     (NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot OR
      NEW.period_starts_at IS DISTINCT FROM OLD.period_starts_at OR
      NEW.period_ends_at IS DISTINCT FROM OLD.period_ends_at OR
      NEW.claim_deadline IS DISTINCT FROM OLD.claim_deadline OR
      NEW.unlocked_at IS DISTINCT FROM OLD.unlocked_at OR
      NEW.target_count_snapshot IS DISTINCT FROM OLD.target_count_snapshot OR
      NEW.period_key IS DISTINCT FROM OLD.period_key OR
      NEW.player_id IS DISTINCT FROM OLD.player_id OR NEW.chest_id IS DISTINCT FROM OLD.chest_id) THEN
    RAISE EXCEPTION 'Earned chest snapshot is immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER chest_earned_snapshot_immutable BEFORE UPDATE ON player_mission_chests FOR EACH ROW EXECUTE FUNCTION chest_earned_snapshot_immutable();
--> statement-breakpoint
CREATE FUNCTION mission_activation_effective_time() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.active AND NOT OLD.active THEN NEW.activation_effective_at := greatest(now(), NEW.activation_effective_at); END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER mission_activation_effective_time BEFORE UPDATE ON missions FOR EACH ROW EXECUTE FUNCTION mission_activation_effective_time();
--> statement-breakpoint
CREATE TRIGGER chest_activation_effective_time BEFORE UPDATE ON mission_chests FOR EACH ROW EXECUTE FUNCTION mission_activation_effective_time();
--> statement-breakpoint
CREATE FUNCTION chest_eligibility_effective_time() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.active AND NOT OLD.active THEN NEW.effective_at := greatest(now(), NEW.effective_at); END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER chest_eligibility_effective_time BEFORE UPDATE ON mission_chest_eligibility FOR EACH ROW EXECUTE FUNCTION chest_eligibility_effective_time();
--> statement-breakpoint
CREATE FUNCTION chest_completion_provenance_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Chest completion provenance is immutable';
END $$;
--> statement-breakpoint
CREATE TRIGGER chest_completion_provenance_immutable BEFORE UPDATE OR DELETE ON mission_chest_completions FOR EACH ROW EXECUTE FUNCTION chest_completion_provenance_immutable();
