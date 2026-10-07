ALTER TABLE "players" ADD COLUMN "avatar_source" text DEFAULT 'DEFAULT' NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "custom_avatar_url" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "custom_avatar_public_id" text;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_avatar_source_valid" CHECK ("players"."avatar_source" in ('DEFAULT', 'CUSTOM_UPLOAD', 'INVENTORY_AVATAR'));--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_custom_avatar_valid" CHECK (("players"."custom_avatar_url" is null) = ("players"."custom_avatar_public_id" is null) and ("players"."avatar_source" <> 'CUSTOM_UPLOAD' or "players"."custom_avatar_url" is not null));
--> statement-breakpoint
-- Preserve explicit inventory selections, never reinterpret identity-provider photos.
UPDATE players p SET avatar_source='INVENTORY_AVATAR'
WHERE EXISTS (SELECT 1 FROM player_equipment e
  JOIN player_inventory_items i ON i.player_inventory_item_id=e.player_inventory_item_id AND i.player_id=p.player_id
  JOIN reward_definitions r ON r.reward_definition_id=i.reward_definition_id
  WHERE e.player_id=p.player_id AND e.slot='AVATAR' AND i.quantity>0 AND r.reward_type='AVATAR');
