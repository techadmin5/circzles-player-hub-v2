CREATE TYPE "public"."admin_role" AS ENUM('SUPER_ADMIN', 'REVIEWER');--> statement-breakpoint
CREATE TYPE "public"."submission_review_decision" AS ENUM('APPROVED', 'REJECTED', 'RESUBMISSION_REQUIRED');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"admin_user_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "admin_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_reviews" (
	"submission_review_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"reviewer_admin_user_id" uuid NOT NULL,
	"decision" "submission_review_decision" NOT NULL,
	"review_note" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_reviews" ADD CONSTRAINT "submission_reviews_submission_id_submissions_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("submission_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_reviews" ADD CONSTRAINT "submission_reviews_reviewer_admin_user_id_admin_users_admin_user_id_fk" FOREIGN KEY ("reviewer_admin_user_id") REFERENCES "public"."admin_users"("admin_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_user_id_unique" ON "admin_users" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_users_active_role_idx" ON "admin_users" USING btree ("active","role");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_reviews_reviewer_id_idempotency_key_unique" ON "submission_reviews" USING btree ("reviewer_admin_user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "submission_reviews_submission_created_at_idx" ON "submission_reviews" USING btree ("submission_id","created_at");--> statement-breakpoint
CREATE INDEX "submission_reviews_reviewer_created_at_idx" ON "submission_reviews" USING btree ("reviewer_admin_user_id","created_at");