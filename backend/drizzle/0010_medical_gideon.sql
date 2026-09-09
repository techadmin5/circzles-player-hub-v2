CREATE TABLE "mission_claims" (
	"mission_claim_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"mission_id" uuid NOT NULL,
	"player_mission_progress_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"synapse_reward_snapshot" integer DEFAULT 0 NOT NULL,
	"xp_reward_snapshot" integer DEFAULT 0 NOT NULL,
	"point_transaction_id" uuid,
	"xp_transaction_id" uuid,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mission_claims_synapse_reward_snapshot_check" CHECK ("mission_claims"."synapse_reward_snapshot" >= 0),
	CONSTRAINT "mission_claims_xp_reward_snapshot_check" CHECK ("mission_claims"."xp_reward_snapshot" >= 0)
);
--> statement-breakpoint
ALTER TABLE "mission_claims" ADD CONSTRAINT "mission_claims_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_claims" ADD CONSTRAINT "mission_claims_mission_id_missions_mission_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("mission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_claims" ADD CONSTRAINT "mission_claims_player_mission_progress_id_player_mission_progress_player_mission_progress_id_fk" FOREIGN KEY ("player_mission_progress_id") REFERENCES "public"."player_mission_progress"("player_mission_progress_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_claims" ADD CONSTRAINT "mission_claims_point_transaction_id_point_transactions_transaction_id_fk" FOREIGN KEY ("point_transaction_id") REFERENCES "public"."point_transactions"("transaction_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_claims" ADD CONSTRAINT "mission_claims_xp_transaction_id_xp_transactions_xp_transaction_id_fk" FOREIGN KEY ("xp_transaction_id") REFERENCES "public"."xp_transactions"("xp_transaction_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mission_claims_player_mission_progress_id_unique" ON "mission_claims" USING btree ("player_mission_progress_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mission_claims_player_mission_period_unique" ON "mission_claims" USING btree ("player_id","mission_id","period_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mission_claims_player_id_idempotency_key_unique" ON "mission_claims" USING btree ("player_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "mission_claims_player_id_created_at_idx" ON "mission_claims" USING btree ("player_id","created_at");