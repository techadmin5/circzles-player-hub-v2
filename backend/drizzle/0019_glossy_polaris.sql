CREATE TABLE "auth_handoff_exchanges" (
	"auth_handoff_exchange_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id_hash" text NOT NULL,
	"source_site" text NOT NULL,
	"user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_handoff_exchanges_source_site_check" CHECK ("auth_handoff_exchanges"."source_site" in ('CIRCZLES_COM', 'CIRCZLES_IN'))
);
--> statement-breakpoint
DROP INDEX "wix_identity_links_user_id_unique";--> statement-breakpoint
DROP INDEX "wix_identity_links_wix_member_id_unique";--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "verified_email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wix_identity_links" ADD COLUMN "source_site" text DEFAULT 'CIRCZLES_COM' NOT NULL;--> statement-breakpoint
ALTER TABLE "wix_identity_links" ADD COLUMN "identity_provider" text DEFAULT 'WIX' NOT NULL;--> statement-breakpoint
ALTER TABLE "wix_identity_links" ADD COLUMN "verified_email" text;--> statement-breakpoint
ALTER TABLE "wix_identity_links" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "wix_identity_links" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "wix_identity_links" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "wix_identity_links" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "wix_identity_links" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wix_identity_links" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_handoff_exchanges" ADD CONSTRAINT "auth_handoff_exchanges_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_handoff_exchanges_token_id_hash_unique" ON "auth_handoff_exchanges" USING btree ("token_id_hash");--> statement-breakpoint
CREATE INDEX "auth_handoff_exchanges_expires_at_idx" ON "auth_handoff_exchanges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_verified_email_unique" ON "users" USING btree ("verified_email");--> statement-breakpoint
CREATE UNIQUE INDEX "wix_identity_links_source_member_unique" ON "wix_identity_links" USING btree ("source_site","wix_member_id");--> statement-breakpoint
CREATE INDEX "wix_identity_links_user_id_idx" ON "wix_identity_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wix_identity_links_verified_email_idx" ON "wix_identity_links" USING btree ("verified_email");--> statement-breakpoint
ALTER TABLE "wix_identity_links" ADD CONSTRAINT "wix_identity_links_source_site_check" CHECK ("wix_identity_links"."source_site" in ('CIRCZLES_COM', 'CIRCZLES_IN'));--> statement-breakpoint
ALTER TABLE "wix_identity_links" ADD CONSTRAINT "wix_identity_links_provider_check" CHECK ("wix_identity_links"."identity_provider" in ('WIX', 'EMAIL', 'GOOGLE', 'FACEBOOK'));