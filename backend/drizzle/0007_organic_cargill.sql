CREATE TABLE "leaderboard_entries" (
	"leaderboard_entry_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"puzzle_id" uuid NOT NULL,
	"best_submission_id" uuid NOT NULL,
	"best_completion_time_ms" integer NOT NULL,
	"best_approved_at" timestamp with time zone NOT NULL,
	"best_submitted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaderboard_entries_best_completion_time_ms_check" CHECK ("leaderboard_entries"."best_completion_time_ms" > 0)
);
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_puzzle_id_puzzles_puzzle_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("puzzle_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_best_submission_id_submissions_submission_id_fk" FOREIGN KEY ("best_submission_id") REFERENCES "public"."submissions"("submission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_entries_player_id_puzzle_id_unique" ON "leaderboard_entries" USING btree ("player_id","puzzle_id");--> statement-breakpoint
CREATE INDEX "leaderboard_entries_puzzle_ranking_idx" ON "leaderboard_entries" USING btree ("puzzle_id","best_completion_time_ms","best_approved_at","best_submitted_at","best_submission_id");--> statement-breakpoint
CREATE INDEX "leaderboard_entries_player_id_idx" ON "leaderboard_entries" USING btree ("player_id");