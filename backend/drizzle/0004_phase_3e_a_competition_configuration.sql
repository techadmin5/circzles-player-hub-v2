CREATE TYPE "public"."puzzle_competition_category" AS ENUM('MAIN_LEVEL', 'SIDE_QUEST');--> statement-breakpoint
CREATE TABLE "puzzle_competition_settings" (
	"puzzle_competition_setting_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"puzzle_id" uuid NOT NULL,
	"category" "puzzle_competition_category" NOT NULL,
	"leaderboard_enabled" boolean DEFAULT false NOT NULL,
	"display_order" integer NOT NULL,
	"reward_enabled" boolean DEFAULT false NOT NULL,
	"synapse_reward" integer DEFAULT 0 NOT NULL,
	"xp_reward" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "puzzle_competition_settings_display_order_check" CHECK ("puzzle_competition_settings"."display_order" >= 0),
	CONSTRAINT "puzzle_competition_settings_synapse_reward_check" CHECK ("puzzle_competition_settings"."synapse_reward" >= 0),
	CONSTRAINT "puzzle_competition_settings_xp_reward_check" CHECK ("puzzle_competition_settings"."xp_reward" >= 0)
);
--> statement-breakpoint
ALTER TABLE "puzzles" ALTER COLUMN "level_id" SET DATA TYPE numeric(4, 1);--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "level_id" SET DATA TYPE numeric(4, 1);--> statement-breakpoint
ALTER TABLE "puzzle_competition_settings" ADD CONSTRAINT "puzzle_competition_settings_puzzle_id_puzzles_puzzle_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("puzzle_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "puzzle_competition_settings_puzzle_id_unique" ON "puzzle_competition_settings" USING btree ("puzzle_id");--> statement-breakpoint
CREATE INDEX "puzzle_competition_settings_navigation_idx" ON "puzzle_competition_settings" USING btree ("active","leaderboard_enabled","category","display_order");