CREATE TABLE "mission_chest_admin_events" (
	"event_id" bigserial PRIMARY KEY NOT NULL,
	"chest_id" uuid NOT NULL,
	"actor_admin_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"revision" timestamp with time zone NOT NULL,
	"digest" text NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"operation_key" uuid,
	"request" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mission_chest_admin_action_check" CHECK ("mission_chest_admin_events"."action" IN ('CREATE','CONFIGURE','APPROVE_PRODUCT','APPROVE_REWARD_BUDGET','REVOKE_PRODUCT','REVOKE_REWARD_BUDGET','ACTIVATE','DEACTIVATE')),
	CONSTRAINT "mission_chest_admin_digest_check" CHECK ("mission_chest_admin_events"."digest" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "mission_chests" ALTER COLUMN "rewards" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mission_chest_claims" ADD COLUMN "period_type" text;--> statement-breakpoint
UPDATE mission_chest_claims c SET period_type=m.period_type FROM mission_chests m WHERE m.chest_id=c.chest_id;--> statement-breakpoint
ALTER TABLE mission_chest_claims ALTER COLUMN period_type SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mission_chest_eligibility" ADD COLUMN "selected" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "mission_chests" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "mission_chest_admin_events" ADD CONSTRAINT "mission_chest_admin_events_chest_id_mission_chests_chest_id_fk" FOREIGN KEY ("chest_id") REFERENCES "public"."mission_chests"("chest_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_chest_admin_events" ADD CONSTRAINT "mission_chest_admin_events_actor_admin_user_id_admin_users_admin_user_id_fk" FOREIGN KEY ("actor_admin_user_id") REFERENCES "public"."admin_users"("admin_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mission_chest_admin_operation_unique" ON "mission_chest_admin_events" USING btree ("chest_id","operation_key");--> statement-breakpoint
CREATE INDEX "mission_chest_admin_history_idx" ON "mission_chest_admin_events" USING btree ("chest_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mission_chest_claims_player_period_unique" ON "mission_chest_claims" USING btree ("player_id","period_type","period_key");--> statement-breakpoint
ALTER TABLE "mission_chest_claims" ADD CONSTRAINT "mission_chest_claims_period_type_check" CHECK ("mission_chest_claims"."period_type" IN ('DAILY','WEEKLY'));
--> statement-breakpoint
CREATE TRIGGER mission_chest_admin_events_immutable BEFORE UPDATE OR DELETE ON mission_chest_admin_events FOR EACH ROW EXECUTE FUNCTION mission_approval_immutable();
--> statement-breakpoint
CREATE TRIGGER mission_chest_admin_events_no_truncate BEFORE TRUNCATE ON mission_chest_admin_events FOR EACH STATEMENT EXECUTE FUNCTION mission_approval_immutable();
