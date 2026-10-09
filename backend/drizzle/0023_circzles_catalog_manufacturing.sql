CREATE TYPE "public"."catalog_product_type" AS ENUM('CIRCZLES', 'ACCESSORY');--> statement-breakpoint
CREATE TYPE "public"."catalog_status" AS ENUM('DRAFT', 'ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "catalog_variants" (
	"catalog_variant_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"puzzle_design_id" uuid NOT NULL,
	"puzzle_id" uuid,
	"display_name" text NOT NULL,
	"brand" text NOT NULL,
	"product_type" "catalog_product_type" NOT NULL,
	"size_label" text,
	"piece_count" integer,
	"level_id" numeric(4, 1),
	"image" text,
	"description" text,
	"marketing_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "catalog_status" DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_variants_puzzle_id_unique" UNIQUE("puzzle_id"),
	CONSTRAINT "catalog_variant_level_positive" CHECK ("catalog_variants"."level_id" IS NULL OR "catalog_variants"."level_id" > 0),
	CONSTRAINT "catalog_variant_piece_positive" CHECK ("catalog_variants"."piece_count" IS NULL OR "catalog_variants"."piece_count" > 0),
	CONSTRAINT "catalog_variant_playable_active" CHECK ("catalog_variants"."status" <> 'ACTIVE' OR "catalog_variants"."product_type" <> 'CIRCZLES' OR ("catalog_variants"."puzzle_id" IS NOT NULL AND "catalog_variants"."level_id" IS NOT NULL AND "catalog_variants"."level_id" > 0)),
	CONSTRAINT "catalog_variant_accessory_not_playable" CHECK ("catalog_variants"."product_type" <> 'ACCESSORY' OR "catalog_variants"."puzzle_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "manufacturing_batch_ranges" (
	"manufacturing_batch_range_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manufacturing_batch_id" uuid NOT NULL,
	"serial_start" bigint NOT NULL,
	"serial_end" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manufacturing_range_bounds" CHECK ("manufacturing_batch_ranges"."serial_start" > 0 AND "manufacturing_batch_ranges"."serial_end" >= "manufacturing_batch_ranges"."serial_start")
);
--> statement-breakpoint
CREATE TABLE "manufacturing_batches" (
	"manufacturing_batch_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_variant_id" uuid NOT NULL,
	"puzzle_id" uuid,
	"puzzle_claim_prefix_id" uuid,
	"brand" text NOT NULL,
	"product_type" "catalog_product_type" NOT NULL,
	"number_identifier" text NOT NULL,
	"manufacturing_code" text NOT NULL,
	"sku_prefix" text NOT NULL,
	"first_full_sku" text,
	"serial_start" bigint NOT NULL,
	"serial_end" bigint NOT NULL,
	"units_manufactured" bigint NOT NULL,
	"status" "catalog_status" DEFAULT 'DRAFT' NOT NULL,
	"import_key" text,
	"source_fingerprint" text,
	"source_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manufacturing_batches_puzzle_claim_prefix_id_unique" UNIQUE("puzzle_claim_prefix_id"),
	CONSTRAINT "manufacturing_batches_sku_prefix_unique" UNIQUE("sku_prefix"),
	CONSTRAINT "manufacturing_batches_import_key_unique" UNIQUE("import_key"),
	CONSTRAINT "manufacturing_batch_bounds" CHECK ("manufacturing_batches"."serial_start" > 0 AND "manufacturing_batches"."serial_end" >= "manufacturing_batches"."serial_start" AND "manufacturing_batches"."units_manufactured" > 0),
	CONSTRAINT "manufacturing_batch_playable_active" CHECK ("manufacturing_batches"."status" <> 'ACTIVE' OR "manufacturing_batches"."product_type" <> 'CIRCZLES' OR ("manufacturing_batches"."puzzle_id" IS NOT NULL AND "manufacturing_batches"."puzzle_claim_prefix_id" IS NOT NULL)),
	CONSTRAINT "manufacturing_batch_accessory_not_playable" CHECK ("manufacturing_batches"."product_type" <> 'ACCESSORY' OR ("manufacturing_batches"."puzzle_id" IS NULL AND "manufacturing_batches"."puzzle_claim_prefix_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "catalog_variants" ADD CONSTRAINT "catalog_variants_puzzle_design_id_puzzle_designs_puzzle_design_id_fk" FOREIGN KEY ("puzzle_design_id") REFERENCES "public"."puzzle_designs"("puzzle_design_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_variants" ADD CONSTRAINT "catalog_variants_puzzle_id_puzzles_puzzle_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("puzzle_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_batch_ranges" ADD CONSTRAINT "manufacturing_batch_ranges_manufacturing_batch_id_manufacturing_batches_manufacturing_batch_id_fk" FOREIGN KEY ("manufacturing_batch_id") REFERENCES "public"."manufacturing_batches"("manufacturing_batch_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_batches" ADD CONSTRAINT "manufacturing_batches_catalog_variant_id_catalog_variants_catalog_variant_id_fk" FOREIGN KEY ("catalog_variant_id") REFERENCES "public"."catalog_variants"("catalog_variant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_batches" ADD CONSTRAINT "manufacturing_batches_puzzle_id_puzzles_puzzle_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("puzzle_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_batches" ADD CONSTRAINT "manufacturing_batches_puzzle_claim_prefix_id_puzzle_claim_prefixes_puzzle_claim_prefix_id_fk" FOREIGN KEY ("puzzle_claim_prefix_id") REFERENCES "public"."puzzle_claim_prefixes"("puzzle_claim_prefix_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "manufacturing_range_unique" ON "manufacturing_batch_ranges" USING btree ("manufacturing_batch_id","serial_start","serial_end");--> statement-breakpoint
CREATE INDEX "manufacturing_batch_variant_idx" ON "manufacturing_batches" USING btree ("catalog_variant_id");
--> statement-breakpoint
-- Preserve canonical playable IDs; old prefixes intentionally have no invented ranges.
INSERT INTO catalog_variants (puzzle_id, puzzle_design_id, display_name, brand, product_type, size_label, piece_count, level_id, image, description, status)
SELECT puzzle_id, puzzle_design_id, name, 'CircZles', 'CIRCZLES', size_label, piece_count, level_id, image, description,
 CASE WHEN status = 'ACTIVE' AND deleted_at IS NULL THEN 'ACTIVE'::catalog_status ELSE 'ARCHIVED'::catalog_status END
FROM puzzles;
