CREATE TABLE "mission_capacity_events" (
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
	CONSTRAINT "mission_capacity_events_state_check" CHECK (("mission_capacity_events"."action" = 'OPENED' AND "mission_capacity_events"."actor_admin_user_id" IS NULL AND "mission_capacity_events"."key" IS NULL AND "mission_capacity_events"."claim_id" IS NULL AND "mission_capacity_events"."request" IS NULL) OR ("mission_capacity_events"."action" IN ('RECOVERY_BLOCKED','RECOVERED') AND "mission_capacity_events"."actor_admin_user_id" IS NOT NULL AND "mission_capacity_events"."key" IS NOT NULL AND "mission_capacity_events"."request" IS NOT NULL AND ("mission_capacity_events"."action" = 'RECOVERY_BLOCKED' AND "mission_capacity_events"."claim_id" IS NULL OR "mission_capacity_events"."action" = 'RECOVERED' AND "mission_capacity_events"."claim_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "mission_capacity_exceptions" (
	"exception_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"progress_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"mission_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"original_key" text NOT NULL,
	"arrived_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claim_deadline" timestamp with time zone,
	"reward_snapshot" jsonb NOT NULL,
	"digest" text NOT NULL,
	"xp" integer NOT NULL,
	"synapse_points" integer NOT NULL,
	CONSTRAINT "mission_capacity_exceptions_progress_id_unique" UNIQUE("progress_id"),
	CONSTRAINT "mission_capacity_digest_check" CHECK ("mission_capacity_exceptions"."digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "mission_capacity_timely_check" CHECK ("mission_capacity_exceptions"."claim_deadline" IS NULL OR "mission_capacity_exceptions"."arrived_at" < "mission_capacity_exceptions"."claim_deadline"),
	CONSTRAINT "mission_capacity_amounts_check" CHECK ("mission_capacity_exceptions"."xp" >= 0 AND "mission_capacity_exceptions"."synapse_points" >= 0 AND ("mission_capacity_exceptions"."xp" > 0 OR "mission_capacity_exceptions"."synapse_points" > 0))
);
--> statement-breakpoint
CREATE TABLE "mission_capacity_requests" (
	"request_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exception_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mission_capacity_events" ADD CONSTRAINT "mission_capacity_events_exception_id_mission_capacity_exceptions_exception_id_fk" FOREIGN KEY ("exception_id") REFERENCES "public"."mission_capacity_exceptions"("exception_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_capacity_events" ADD CONSTRAINT "mission_capacity_events_actor_admin_user_id_admin_users_admin_user_id_fk" FOREIGN KEY ("actor_admin_user_id") REFERENCES "public"."admin_users"("admin_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_capacity_events" ADD CONSTRAINT "mission_capacity_events_claim_id_mission_claims_mission_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."mission_claims"("mission_claim_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_capacity_exceptions" ADD CONSTRAINT "mission_capacity_exceptions_progress_id_player_mission_progress_player_mission_progress_id_fk" FOREIGN KEY ("progress_id") REFERENCES "public"."player_mission_progress"("player_mission_progress_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_capacity_exceptions" ADD CONSTRAINT "mission_capacity_exceptions_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_capacity_exceptions" ADD CONSTRAINT "mission_capacity_exceptions_mission_id_missions_mission_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("mission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_capacity_requests" ADD CONSTRAINT "mission_capacity_requests_exception_id_mission_capacity_exceptions_exception_id_fk" FOREIGN KEY ("exception_id") REFERENCES "public"."mission_capacity_exceptions"("exception_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_capacity_requests" ADD CONSTRAINT "mission_capacity_requests_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mission_capacity_events_exception_key_idx" ON "mission_capacity_events" USING btree ("exception_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "mission_capacity_requests_player_key_idx" ON "mission_capacity_requests" USING btree ("player_id","key");
--> statement-breakpoint
CREATE TRIGGER mission_capacity_exceptions_immutable BEFORE UPDATE OR DELETE ON mission_capacity_exceptions FOR EACH ROW EXECUTE FUNCTION mission_approval_immutable();
--> statement-breakpoint
CREATE TRIGGER mission_capacity_exceptions_no_truncate BEFORE TRUNCATE ON mission_capacity_exceptions FOR EACH STATEMENT EXECUTE FUNCTION mission_approval_immutable();

--> statement-breakpoint
CREATE TRIGGER mission_capacity_requests_immutable BEFORE UPDATE OR DELETE ON mission_capacity_requests FOR EACH ROW EXECUTE FUNCTION mission_approval_immutable();
--> statement-breakpoint
CREATE TRIGGER mission_capacity_requests_no_truncate BEFORE TRUNCATE ON mission_capacity_requests FOR EACH STATEMENT EXECUTE FUNCTION mission_approval_immutable();

--> statement-breakpoint
CREATE TRIGGER mission_capacity_events_immutable BEFORE UPDATE OR DELETE ON mission_capacity_events FOR EACH ROW EXECUTE FUNCTION mission_approval_immutable();
--> statement-breakpoint
CREATE TRIGGER mission_capacity_events_no_truncate BEFORE TRUNCATE ON mission_capacity_events FOR EACH STATEMENT EXECUTE FUNCTION mission_approval_immutable();
