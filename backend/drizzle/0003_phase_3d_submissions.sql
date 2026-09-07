CREATE TYPE "public"."submission_status" AS ENUM('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'RESUBMISSION_REQUIRED');--> statement-breakpoint
CREATE TYPE "public"."video_upload_status" AS ENUM('SIGNED', 'COMPLETE', 'FAILED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "submissions" (
	"submission_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"player_puzzle_id" uuid NOT NULL,
	"puzzle_id" uuid NOT NULL,
	"level_id" integer NOT NULL,
	"completion_time_ms" integer NOT NULL,
	"video_upload_id" uuid NOT NULL,
	"status" "submission_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"legacy_wix_id" text,
	"idempotency_key" text,
	CONSTRAINT "submissions_completion_time_ms_check" CHECK ("submissions"."completion_time_ms" > 0),
	CONSTRAINT "submissions_level_id_check" CHECK ("submissions"."level_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "video_uploads" (
	"video_upload_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"storage_provider" text NOT NULL,
	"public_id" text NOT NULL,
	"original_filename" text,
	"mime_type" text NOT NULL,
	"declared_size_bytes" bigint NOT NULL,
	"verified_size_bytes" bigint,
	"duration_ms" integer,
	"status" "video_upload_status" DEFAULT 'SIGNED' NOT NULL,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "video_uploads_declared_size_bytes_check" CHECK ("video_uploads"."declared_size_bytes" > 0),
	CONSTRAINT "video_uploads_verified_size_bytes_check" CHECK ("video_uploads"."verified_size_bytes" is null or "video_uploads"."verified_size_bytes" > 0),
	CONSTRAINT "video_uploads_duration_ms_check" CHECK ("video_uploads"."duration_ms" is null or "video_uploads"."duration_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_player_puzzle_id_player_puzzles_player_puzzle_id_fk" FOREIGN KEY ("player_puzzle_id") REFERENCES "public"."player_puzzles"("player_puzzle_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_puzzle_id_puzzles_puzzle_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("puzzle_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_video_upload_id_video_uploads_video_upload_id_fk" FOREIGN KEY ("video_upload_id") REFERENCES "public"."video_uploads"("video_upload_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_uploads" ADD CONSTRAINT "video_uploads_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_video_upload_id_unique" ON "submissions" USING btree ("video_upload_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_player_id_idempotency_key_unique" ON "submissions" USING btree ("player_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "submissions_player_status_idx" ON "submissions" USING btree ("player_id","status");--> statement-breakpoint
CREATE INDEX "submissions_puzzle_status_idx" ON "submissions" USING btree ("puzzle_id","status");--> statement-breakpoint
CREATE INDEX "submissions_level_status_idx" ON "submissions" USING btree ("level_id","status");--> statement-breakpoint
CREATE INDEX "submissions_player_puzzle_id_idx" ON "submissions" USING btree ("player_puzzle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "video_uploads_public_id_unique" ON "video_uploads" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "video_uploads_player_status_idx" ON "video_uploads" USING btree ("player_id","status");--> statement-breakpoint
CREATE INDEX "video_uploads_expires_at_idx" ON "video_uploads" USING btree ("expires_at");