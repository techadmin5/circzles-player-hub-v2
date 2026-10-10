CREATE TABLE "puzzle_design_aliases" (
	"normalized_alias" text PRIMARY KEY NOT NULL,
	"display_alias" text NOT NULL,
	"puzzle_design_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_alias_not_empty" CHECK (length("puzzle_design_aliases"."normalized_alias") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "puzzle_design_aliases" ADD CONSTRAINT "puzzle_design_aliases_puzzle_design_id_puzzle_designs_puzzle_design_id_fk" FOREIGN KEY ("puzzle_design_id") REFERENCES "public"."puzzle_designs"("puzzle_design_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "puzzle_design_aliases_design_idx" ON "puzzle_design_aliases" USING btree ("puzzle_design_id");