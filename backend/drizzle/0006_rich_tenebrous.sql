CREATE TABLE "submission_reward_grants" (
	"submission_reward_grant_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"puzzle_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"reward_enabled_snapshot" boolean NOT NULL,
	"synapse_reward" integer NOT NULL,
	"xp_reward" integer NOT NULL,
	"point_transaction_id" uuid,
	"xp_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_reward_grants_synapse_reward_check" CHECK ("submission_reward_grants"."synapse_reward" >= 0),
	CONSTRAINT "submission_reward_grants_xp_reward_check" CHECK ("submission_reward_grants"."xp_reward" >= 0)
);
--> statement-breakpoint
ALTER TABLE "submission_reward_grants" ADD CONSTRAINT "submission_reward_grants_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_reward_grants" ADD CONSTRAINT "submission_reward_grants_puzzle_id_puzzles_puzzle_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("puzzle_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_reward_grants" ADD CONSTRAINT "submission_reward_grants_submission_id_submissions_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("submission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_reward_grants" ADD CONSTRAINT "submission_reward_grants_point_transaction_id_point_transactions_transaction_id_fk" FOREIGN KEY ("point_transaction_id") REFERENCES "public"."point_transactions"("transaction_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_reward_grants" ADD CONSTRAINT "submission_reward_grants_xp_transaction_id_xp_transactions_xp_transaction_id_fk" FOREIGN KEY ("xp_transaction_id") REFERENCES "public"."xp_transactions"("xp_transaction_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "submission_reward_grants_player_id_puzzle_id_unique" ON "submission_reward_grants" USING btree ("player_id","puzzle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_reward_grants_submission_id_unique" ON "submission_reward_grants" USING btree ("submission_id");