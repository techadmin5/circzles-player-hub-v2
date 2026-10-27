CREATE TABLE "mission_approval_revocations" (
	"revocation_id" bigserial PRIMARY KEY NOT NULL,
	"approval_id" bigint NOT NULL,
	"actor_admin_user_id" uuid NOT NULL,
	"revoked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mission_approval_revocations_approval_id_unique" UNIQUE("approval_id")
);
--> statement-breakpoint
CREATE TABLE "mission_approvals" (
	"approval_id" bigserial PRIMARY KEY NOT NULL,
	"mission_id" uuid NOT NULL,
	"category" text NOT NULL,
	"configuration_revision" timestamp with time zone NOT NULL,
	"configuration_digest" text NOT NULL,
	"approver_admin_user_id" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"xp" integer NOT NULL,
	"synapse_points" integer NOT NULL,
	CONSTRAINT "mission_approvals_category_check" CHECK ("mission_approvals"."category" IN ('PRODUCT', 'REWARD_BUDGET')),
	CONSTRAINT "mission_approvals_digest_check" CHECK ("mission_approvals"."configuration_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "mission_approvals_amounts_check" CHECK ("mission_approvals"."xp" >= 0 AND "mission_approvals"."synapse_points" >= 0 AND ("mission_approvals"."xp" > 0 OR "mission_approvals"."synapse_points" > 0))
);
--> statement-breakpoint
ALTER TABLE "mission_admin_history" DROP CONSTRAINT "mission_admin_history_action_check";--> statement-breakpoint
ALTER TABLE "mission_admin_history" DROP CONSTRAINT "mission_admin_history_snapshot_check";--> statement-breakpoint
ALTER TABLE "mission_approval_revocations" ADD CONSTRAINT "mission_approval_revocations_approval_id_mission_approvals_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."mission_approvals"("approval_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_approval_revocations" ADD CONSTRAINT "mission_approval_revocations_actor_admin_user_id_admin_users_admin_user_id_fk" FOREIGN KEY ("actor_admin_user_id") REFERENCES "public"."admin_users"("admin_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_approvals" ADD CONSTRAINT "mission_approvals_mission_id_missions_mission_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("mission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_approvals" ADD CONSTRAINT "mission_approvals_approver_admin_user_id_admin_users_admin_user_id_fk" FOREIGN KEY ("approver_admin_user_id") REFERENCES "public"."admin_users"("admin_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mission_approvals_mission_category_id_idx" ON "mission_approvals" USING btree ("mission_id","category","approval_id");--> statement-breakpoint
ALTER TABLE "mission_admin_history" ADD CONSTRAINT "mission_admin_history_action_check" CHECK ("mission_admin_history"."action" IN ('DRAFT_CREATED', 'METADATA_UPDATED', 'RULE_CONFIGURED', 'SCHEDULE_CONFIGURED', 'REWARDS_CONFIGURED', 'APPROVAL_GRANTED', 'APPROVAL_REVOKED'));--> statement-breakpoint
ALTER TABLE "mission_admin_history" ADD CONSTRAINT "mission_admin_history_snapshot_check" CHECK (jsonb_typeof("mission_admin_history"."after") = 'object' AND (("mission_admin_history"."action" = 'DRAFT_CREATED' AND "mission_admin_history"."before" IS NULL) OR ("mission_admin_history"."action" IN ('METADATA_UPDATED', 'RULE_CONFIGURED', 'SCHEDULE_CONFIGURED', 'REWARDS_CONFIGURED', 'APPROVAL_GRANTED', 'APPROVAL_REVOKED') AND "mission_admin_history"."before" IS NOT NULL AND jsonb_typeof("mission_admin_history"."before") = 'object')));
--> statement-breakpoint
CREATE FUNCTION mission_approval_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Mission approvals and revocations are append-only'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER mission_approvals_immutable BEFORE UPDATE OR DELETE ON mission_approvals FOR EACH ROW EXECUTE FUNCTION mission_approval_immutable();
--> statement-breakpoint
CREATE TRIGGER mission_approvals_no_truncate BEFORE TRUNCATE ON mission_approvals FOR EACH STATEMENT EXECUTE FUNCTION mission_approval_immutable();
--> statement-breakpoint
CREATE TRIGGER mission_approval_revocations_immutable BEFORE UPDATE OR DELETE ON mission_approval_revocations FOR EACH ROW EXECUTE FUNCTION mission_approval_immutable();
--> statement-breakpoint
CREATE TRIGGER mission_approval_revocations_no_truncate BEFORE TRUNCATE ON mission_approval_revocations FOR EACH STATEMENT EXECUTE FUNCTION mission_approval_immutable();
