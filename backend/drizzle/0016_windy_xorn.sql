CREATE TABLE "reward_wheel_spin_tiers" (
	"reward_wheel_spin_tier_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reward_wheel_id" uuid NOT NULL,
	"spin_number" integer NOT NULL,
	"cost_synapse_points" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_wheel_spin_tiers_spin_number_check" CHECK ("reward_wheel_spin_tiers"."spin_number" > 0),
	CONSTRAINT "reward_wheel_spin_tiers_cost_check" CHECK ("reward_wheel_spin_tiers"."cost_synapse_points" >= 0)
);
--> statement-breakpoint
ALTER TABLE "reward_wheel_spins" ADD COLUMN "reward_wheel_spin_tier_id" uuid;--> statement-breakpoint
ALTER TABLE "reward_wheel_spins" ADD COLUMN "spin_number_snapshot" integer;--> statement-breakpoint
ALTER TABLE "reward_wheel_spins" ADD COLUMN "cycle_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reward_wheel_spins" ADD COLUMN "cycle_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reward_wheels" ADD COLUMN "cycle_seconds" integer DEFAULT 86400 NOT NULL;--> statement-breakpoint
ALTER TABLE "reward_wheel_spin_tiers" ADD CONSTRAINT "reward_wheel_spin_tiers_reward_wheel_id_reward_wheels_reward_wheel_id_fk" FOREIGN KEY ("reward_wheel_id") REFERENCES "public"."reward_wheels"("reward_wheel_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reward_wheel_spin_tiers_wheel_id_spin_number_unique" ON "reward_wheel_spin_tiers" USING btree ("reward_wheel_id","spin_number");--> statement-breakpoint
CREATE INDEX "reward_wheel_spin_tiers_wheel_id_active_spin_number_idx" ON "reward_wheel_spin_tiers" USING btree ("reward_wheel_id","active","spin_number");--> statement-breakpoint
ALTER TABLE "reward_wheel_spins" ADD CONSTRAINT "reward_wheel_spins_reward_wheel_spin_tier_id_reward_wheel_spin_tiers_reward_wheel_spin_tier_id_fk" FOREIGN KEY ("reward_wheel_spin_tier_id") REFERENCES "public"."reward_wheel_spin_tiers"("reward_wheel_spin_tier_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_wheel_spins" ADD CONSTRAINT "reward_wheel_spins_spin_number_snapshot_check" CHECK ("reward_wheel_spins"."spin_number_snapshot" is null or "reward_wheel_spins"."spin_number_snapshot" > 0);--> statement-breakpoint
ALTER TABLE "reward_wheel_spins" ADD CONSTRAINT "reward_wheel_spins_cycle_window_check" CHECK (("reward_wheel_spins"."cycle_started_at" is null and "reward_wheel_spins"."cycle_ends_at" is null) or ("reward_wheel_spins"."cycle_started_at" is not null and "reward_wheel_spins"."cycle_ends_at" > "reward_wheel_spins"."cycle_started_at"));--> statement-breakpoint
ALTER TABLE "reward_wheels" ADD CONSTRAINT "reward_wheels_cycle_seconds_check" CHECK ("reward_wheels"."cycle_seconds" > 0);