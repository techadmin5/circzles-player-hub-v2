CREATE TABLE "player_puzzles" (
	"player_puzzle_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"puzzle_id" uuid NOT NULL,
	"puzzle_claim_id" uuid,
	"legacy_wix_id" text,
	"source" text DEFAULT 'CODE_CLAIM' NOT NULL,
	"status" text DEFAULT 'OWNED' NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "puzzle_claim_prefixes" (
	"puzzle_claim_prefix_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"puzzle_id" uuid NOT NULL,
	"prefix" text NOT NULL,
	"normalized_prefix" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "puzzle_claims" (
	"puzzle_claim_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"puzzle_claim_prefix_id" uuid NOT NULL,
	"puzzle_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"serial_number" bigint NOT NULL,
	"normalized_code" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "puzzle_claims_serial_number_check" CHECK ("puzzle_claims"."serial_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "puzzle_designs" (
	"puzzle_design_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_wix_id" text,
	"name" text NOT NULL,
	"description" text,
	"artwork" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "puzzles" (
	"puzzle_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"puzzle_design_id" uuid NOT NULL,
	"legacy_wix_id" text,
	"name" text NOT NULL,
	"run_code" text,
	"piece_count" integer,
	"size_label" text,
	"level_id" integer NOT NULL,
	"image" text,
	"description" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "puzzles_level_id_check" CHECK ("puzzles"."level_id" > 0),
	CONSTRAINT "puzzles_piece_count_check" CHECK ("puzzles"."piece_count" is null or "puzzles"."piece_count" > 0)
);
--> statement-breakpoint
ALTER TABLE "player_puzzles" ADD CONSTRAINT "player_puzzles_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_puzzles" ADD CONSTRAINT "player_puzzles_puzzle_id_puzzles_puzzle_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("puzzle_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_puzzles" ADD CONSTRAINT "player_puzzles_puzzle_claim_id_puzzle_claims_puzzle_claim_id_fk" FOREIGN KEY ("puzzle_claim_id") REFERENCES "public"."puzzle_claims"("puzzle_claim_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puzzle_claim_prefixes" ADD CONSTRAINT "puzzle_claim_prefixes_puzzle_id_puzzles_puzzle_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("puzzle_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puzzle_claims" ADD CONSTRAINT "puzzle_claims_puzzle_claim_prefix_id_puzzle_claim_prefixes_puzzle_claim_prefix_id_fk" FOREIGN KEY ("puzzle_claim_prefix_id") REFERENCES "public"."puzzle_claim_prefixes"("puzzle_claim_prefix_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puzzle_claims" ADD CONSTRAINT "puzzle_claims_puzzle_id_puzzles_puzzle_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("puzzle_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puzzle_claims" ADD CONSTRAINT "puzzle_claims_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puzzles" ADD CONSTRAINT "puzzles_puzzle_design_id_puzzle_designs_puzzle_design_id_fk" FOREIGN KEY ("puzzle_design_id") REFERENCES "public"."puzzle_designs"("puzzle_design_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_puzzles_player_id_puzzle_id_active_unique" ON "player_puzzles" USING btree ("player_id","puzzle_id") WHERE "player_puzzles"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "player_puzzles_player_id_idx" ON "player_puzzles" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "player_puzzles_puzzle_id_idx" ON "player_puzzles" USING btree ("puzzle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "player_puzzles_puzzle_claim_id_unique" ON "player_puzzles" USING btree ("puzzle_claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "puzzle_claim_prefixes_normalized_prefix_active_unique" ON "puzzle_claim_prefixes" USING btree ("normalized_prefix") WHERE "puzzle_claim_prefixes"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "puzzle_claim_prefixes_puzzle_id_idx" ON "puzzle_claim_prefixes" USING btree ("puzzle_id");--> statement-breakpoint
CREATE INDEX "puzzle_claim_prefixes_active_idx" ON "puzzle_claim_prefixes" USING btree ("active");--> statement-breakpoint
CREATE UNIQUE INDEX "puzzle_claims_prefix_serial_unique" ON "puzzle_claims" USING btree ("puzzle_claim_prefix_id","serial_number");--> statement-breakpoint
CREATE UNIQUE INDEX "puzzle_claims_normalized_code_unique" ON "puzzle_claims" USING btree ("normalized_code");--> statement-breakpoint
CREATE INDEX "puzzle_claims_player_id_idx" ON "puzzle_claims" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "puzzle_claims_puzzle_id_idx" ON "puzzle_claims" USING btree ("puzzle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "puzzle_designs_legacy_wix_id_unique" ON "puzzle_designs" USING btree ("legacy_wix_id");--> statement-breakpoint
CREATE INDEX "puzzle_designs_status_idx" ON "puzzle_designs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "puzzles_legacy_wix_id_unique" ON "puzzles" USING btree ("legacy_wix_id");--> statement-breakpoint
CREATE INDEX "puzzles_puzzle_design_id_idx" ON "puzzles" USING btree ("puzzle_design_id");--> statement-breakpoint
CREATE INDEX "puzzles_level_id_idx" ON "puzzles" USING btree ("level_id");--> statement-breakpoint
CREATE INDEX "puzzles_status_idx" ON "puzzles" USING btree ("status");