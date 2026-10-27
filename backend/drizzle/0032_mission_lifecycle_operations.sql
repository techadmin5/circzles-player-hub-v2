CREATE TABLE "mission_lifecycle_operations" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"mission_id" uuid NOT NULL,
	"actor_admin_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mission_lifecycle_operations_action_check" CHECK (action IN ('ACTIVATE', 'DEACTIVATE')),
	CONSTRAINT "mission_lifecycle_operations_payload_check" CHECK (jsonb_typeof(request) = 'object' AND jsonb_typeof(result) = 'object')
);
--> statement-breakpoint
ALTER TABLE "mission_admin_history" DROP CONSTRAINT "mission_admin_history_action_check";--> statement-breakpoint
ALTER TABLE "mission_admin_history" DROP CONSTRAINT "mission_admin_history_snapshot_check";--> statement-breakpoint
ALTER TABLE "mission_lifecycle_operations" ADD CONSTRAINT "mission_lifecycle_operations_mission_id_missions_mission_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("mission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_lifecycle_operations" ADD CONSTRAINT "mission_lifecycle_operations_actor_admin_user_id_admin_users_admin_user_id_fk" FOREIGN KEY ("actor_admin_user_id") REFERENCES "public"."admin_users"("admin_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mission_lifecycle_operations_mission_key_idx" ON "mission_lifecycle_operations" USING btree ("mission_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "mission_admin_history" ADD CONSTRAINT "mission_admin_history_action_check" CHECK ("mission_admin_history"."action" IN ('DRAFT_CREATED', 'METADATA_UPDATED', 'RULE_CONFIGURED', 'SCHEDULE_CONFIGURED', 'REWARDS_CONFIGURED', 'APPROVAL_GRANTED', 'APPROVAL_REVOKED', 'MISSION_ACTIVATED', 'MISSION_DEACTIVATED'));--> statement-breakpoint
ALTER TABLE "mission_admin_history" ADD CONSTRAINT "mission_admin_history_snapshot_check" CHECK (jsonb_typeof("mission_admin_history"."after") = 'object' AND (("mission_admin_history"."action" = 'DRAFT_CREATED' AND "mission_admin_history"."before" IS NULL) OR ("mission_admin_history"."action" IN ('METADATA_UPDATED', 'RULE_CONFIGURED', 'SCHEDULE_CONFIGURED', 'REWARDS_CONFIGURED', 'APPROVAL_GRANTED', 'APPROVAL_REVOKED', 'MISSION_ACTIVATED', 'MISSION_DEACTIVATED') AND "mission_admin_history"."before" IS NOT NULL AND jsonb_typeof("mission_admin_history"."before") = 'object')));
-- Explicit lifecycle receipts are append-only, like administrator history and approvals.

--> statement-breakpoint
CREATE TRIGGER mission_lifecycle_operations_immutable BEFORE UPDATE OR DELETE ON mission_lifecycle_operations FOR EACH ROW EXECUTE FUNCTION mission_approval_immutable();
--> statement-breakpoint
CREATE TRIGGER mission_lifecycle_operations_no_truncate BEFORE TRUNCATE ON mission_lifecycle_operations FOR EACH STATEMENT EXECUTE FUNCTION mission_approval_immutable();
