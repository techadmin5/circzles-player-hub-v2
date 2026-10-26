CREATE TABLE "chest_capacity_events" (
	"event_id" bigserial PRIMARY KEY NOT NULL,
	"exception_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_admin_user_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_code" text,
	"reason" text NOT NULL,
	"key" uuid,
	"request" jsonb,
	"claim_id" uuid,
	CONSTRAINT "chest_capacity_events_state_check" CHECK (("chest_capacity_events"."action" = 'OPENED' AND "chest_capacity_events"."actor_admin_user_id" IS NULL AND "chest_capacity_events"."key" IS NULL AND "chest_capacity_events"."claim_id" IS NULL AND "chest_capacity_events"."request" IS NULL) OR ("chest_capacity_events"."action" IN ('RECOVERY_BLOCKED','RECOVERED') AND "chest_capacity_events"."actor_admin_user_id" IS NOT NULL AND "chest_capacity_events"."key" IS NOT NULL AND "chest_capacity_events"."request" IS NOT NULL AND ("chest_capacity_events"."action" = 'RECOVERY_BLOCKED' AND "chest_capacity_events"."claim_id" IS NULL OR "chest_capacity_events"."action" = 'RECOVERED' AND "chest_capacity_events"."claim_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "chest_capacity_exceptions" (
	"exception_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"progress_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"chest_id" uuid NOT NULL,
	"period_type" text NOT NULL,
	"period_key" text NOT NULL,
	"original_key" text NOT NULL,
	"arrived_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claim_deadline" timestamp with time zone,
	"reward_snapshot" jsonb NOT NULL,
	"digest" text NOT NULL,
	"xp" integer NOT NULL,
	"synapse_points" integer NOT NULL,
	CONSTRAINT "chest_capacity_exceptions_progress_id_unique" UNIQUE("progress_id"),
	CONSTRAINT "chest_capacity_digest_check" CHECK ("chest_capacity_exceptions"."digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "chest_capacity_timely_check" CHECK ("chest_capacity_exceptions"."claim_deadline" IS NULL OR "chest_capacity_exceptions"."arrived_at" < "chest_capacity_exceptions"."claim_deadline"),
	CONSTRAINT "chest_capacity_amounts_check" CHECK ("chest_capacity_exceptions"."xp" >= 0 AND "chest_capacity_exceptions"."synapse_points" >= 0 AND ("chest_capacity_exceptions"."xp" > 0 OR "chest_capacity_exceptions"."synapse_points" > 0))
);
--> statement-breakpoint
CREATE TABLE "chest_capacity_requests" (
	"request_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exception_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chest_capacity_events" ADD CONSTRAINT "chest_capacity_events_exception_id_chest_capacity_exceptions_exception_id_fk" FOREIGN KEY ("exception_id") REFERENCES "public"."chest_capacity_exceptions"("exception_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chest_capacity_events" ADD CONSTRAINT "chest_capacity_events_actor_admin_user_id_admin_users_admin_user_id_fk" FOREIGN KEY ("actor_admin_user_id") REFERENCES "public"."admin_users"("admin_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chest_capacity_events" ADD CONSTRAINT "chest_capacity_events_claim_id_mission_chest_claims_chest_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."mission_chest_claims"("chest_claim_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chest_capacity_exceptions" ADD CONSTRAINT "chest_capacity_exceptions_progress_id_player_mission_chests_player_chest_id_fk" FOREIGN KEY ("progress_id") REFERENCES "public"."player_mission_chests"("player_chest_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chest_capacity_exceptions" ADD CONSTRAINT "chest_capacity_exceptions_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chest_capacity_exceptions" ADD CONSTRAINT "chest_capacity_exceptions_chest_id_mission_chests_chest_id_fk" FOREIGN KEY ("chest_id") REFERENCES "public"."mission_chests"("chest_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chest_capacity_requests" ADD CONSTRAINT "chest_capacity_requests_exception_id_chest_capacity_exceptions_exception_id_fk" FOREIGN KEY ("exception_id") REFERENCES "public"."chest_capacity_exceptions"("exception_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chest_capacity_requests" ADD CONSTRAINT "chest_capacity_requests_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chest_capacity_events_exception_key_idx" ON "chest_capacity_events" USING btree ("exception_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "chest_capacity_player_period_unique" ON "chest_capacity_exceptions" USING btree ("player_id","period_type","period_key");--> statement-breakpoint
CREATE UNIQUE INDEX "chest_capacity_requests_player_key_idx" ON "chest_capacity_requests" USING btree ("player_id","key");--> statement-breakpoint

--> statement-breakpoint
CREATE TRIGGER chest_capacity_exceptions_immutable BEFORE UPDATE OR DELETE ON chest_capacity_exceptions FOR EACH ROW EXECUTE FUNCTION mission_approval_immutable();
--> statement-breakpoint
CREATE TRIGGER chest_capacity_exceptions_no_truncate BEFORE TRUNCATE ON chest_capacity_exceptions FOR EACH STATEMENT EXECUTE FUNCTION mission_approval_immutable();

--> statement-breakpoint
CREATE TRIGGER chest_capacity_requests_immutable BEFORE UPDATE OR DELETE ON chest_capacity_requests FOR EACH ROW EXECUTE FUNCTION mission_approval_immutable();
--> statement-breakpoint
CREATE TRIGGER chest_capacity_requests_no_truncate BEFORE TRUNCATE ON chest_capacity_requests FOR EACH STATEMENT EXECUTE FUNCTION mission_approval_immutable();

--> statement-breakpoint
CREATE TRIGGER chest_capacity_events_immutable BEFORE UPDATE OR DELETE ON chest_capacity_events FOR EACH ROW EXECUTE FUNCTION mission_approval_immutable();
--> statement-breakpoint
CREATE TRIGGER chest_capacity_events_no_truncate BEFORE TRUNCATE ON chest_capacity_events FOR EACH STATEMENT EXECUTE FUNCTION mission_approval_immutable();
