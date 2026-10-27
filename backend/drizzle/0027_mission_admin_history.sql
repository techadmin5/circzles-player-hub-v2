CREATE TABLE "mission_admin_history" (
	"history_id" bigserial PRIMARY KEY NOT NULL,
	"mission_id" uuid NOT NULL,
	"actor_admin_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	CONSTRAINT "mission_admin_history_action_check" CHECK ("mission_admin_history"."action" IN ('DRAFT_CREATED', 'METADATA_UPDATED')),
	CONSTRAINT "mission_admin_history_snapshot_check" CHECK (jsonb_typeof("mission_admin_history"."after") = 'object' AND (("mission_admin_history"."action" = 'DRAFT_CREATED' AND "mission_admin_history"."before" IS NULL) OR ("mission_admin_history"."action" = 'METADATA_UPDATED' AND "mission_admin_history"."before" IS NOT NULL AND jsonb_typeof("mission_admin_history"."before") = 'object')))
);
--> statement-breakpoint
ALTER TABLE "mission_admin_history" ADD CONSTRAINT "mission_admin_history_mission_id_missions_mission_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("mission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_admin_history" ADD CONSTRAINT "mission_admin_history_actor_admin_user_id_admin_users_admin_user_id_fk" FOREIGN KEY ("actor_admin_user_id") REFERENCES "public"."admin_users"("admin_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mission_admin_history_mission_id_history_id_idx" ON "mission_admin_history" USING btree ("mission_id","history_id");--> statement-breakpoint
CREATE FUNCTION mission_admin_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Mission administrator history is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER mission_admin_history_immutable BEFORE UPDATE OR DELETE ON mission_admin_history FOR EACH ROW EXECUTE FUNCTION mission_admin_history_immutable();--> statement-breakpoint
CREATE TRIGGER mission_admin_history_no_truncate BEFORE TRUNCATE ON mission_admin_history FOR EACH STATEMENT EXECUTE FUNCTION mission_admin_history_immutable();
