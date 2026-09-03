CREATE TYPE "public"."point_transaction_direction" AS ENUM('CREDIT', 'DEBIT', 'CORRECTION');--> statement-breakpoint
CREATE TABLE "player_progression" (
	"player_progression_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"total_xp" bigint DEFAULT 0 NOT NULL,
	"progression_level" integer NOT NULL,
	"rank_name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_progression_total_xp_check" CHECK ("player_progression"."total_xp" >= 0)
);
--> statement-breakpoint
CREATE TABLE "point_transactions" (
	"transaction_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"direction" "point_transaction_direction" NOT NULL,
	"reason" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"balance_after" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_transactions_amount_check" CHECK ("point_transactions"."amount" > 0),
	CONSTRAINT "point_transactions_balance_after_check" CHECK ("point_transactions"."balance_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "progression_levels" (
	"progression_level_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"progression_level" integer NOT NULL,
	"rank_name" text NOT NULL,
	"xp_required" bigint NOT NULL,
	"rewards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "progression_levels_xp_required_check" CHECK ("progression_levels"."xp_required" >= 0)
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"wallet_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_balance_check" CHECK ("wallets"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "xp_transactions" (
	"xp_transaction_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"total_xp_after" bigint NOT NULL,
	"idempotency_key" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_transactions_amount_check" CHECK ("xp_transactions"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "player_progression" ADD CONSTRAINT "player_progression_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_transactions" ADD CONSTRAINT "point_transactions_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_progression_player_id_unique" ON "player_progression" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "point_transactions_idempotency_key_unique" ON "point_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "point_transactions_player_created_at_idx" ON "point_transactions" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE INDEX "point_transactions_source_idx" ON "point_transactions" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "progression_levels_level_unique" ON "progression_levels" USING btree ("progression_level");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_player_id_unique" ON "wallets" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "xp_transactions_idempotency_key_unique" ON "xp_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "xp_transactions_player_created_at_idx" ON "xp_transactions" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE INDEX "xp_transactions_source_idx" ON "xp_transactions" USING btree ("source_type","source_id");
--> statement-breakpoint
INSERT INTO "progression_levels" ("progression_level", "rank_name", "xp_required", "rewards", "active")
VALUES
  (1, 'Peasant', 0, '[]'::jsonb, true),
  (5, 'Farmer', 1200, '[]'::jsonb, true),
  (10, 'Squire', 3600, '[]'::jsonb, true),
  (15, 'Knight', 7600, '[]'::jsonb, true),
  (20, 'Apprentice', 12800, '[]'::jsonb, true),
  (30, 'Nobleman', 24000, '[]'::jsonb, true),
  (40, 'Master', 42000, '[]'::jsonb, true),
  (55, 'Hero', 72000, '[]'::jsonb, true),
  (75, 'Conqueror', 120000, '[]'::jsonb, true)
ON CONFLICT ("progression_level") DO UPDATE SET
  "rank_name" = EXCLUDED."rank_name",
  "xp_required" = EXCLUDED."xp_required",
  "rewards" = EXCLUDED."rewards",
  "active" = EXCLUDED."active",
  "updated_at" = now();
