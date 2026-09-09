CREATE TABLE "game_events" (
	"game_event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_player_id_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_events_player_id_idempotency_key_unique" ON "game_events" USING btree ("player_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "game_events_player_id_created_at_idx" ON "game_events" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE INDEX "game_events_event_type_created_at_idx" ON "game_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "game_events_unprocessed_created_at_idx" ON "game_events" USING btree ("created_at") WHERE "game_events"."processed_at" is null;