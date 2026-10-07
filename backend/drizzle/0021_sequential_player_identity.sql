-- Apply through the transactional Drizzle migrator; never as separate autocommit statements.
-- See docs/PLAYER_IDENTITY_SHELL_POLISH.md and the preflight SQL before manual rollout.
LOCK TABLE users IN SHARE MODE;
--> statement-breakpoint
LOCK TABLE players IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
LOCK TABLE inventory_consumptions IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE FUNCTION circzles_player_id_prefix(email text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  WITH normalized AS (SELECT regexp_replace(coalesce(email, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g') AS value)
  SELECT CASE WHEN value ~ '^[^@[:space:]]+@[^@[:space:]]+$'
    THEN coalesce(nullif(rtrim(left(lower(btrim(regexp_replace(split_part(value, '@', 1), '[^A-Za-z0-9]+', '_', 'g'), '_') COLLATE "C"), 64), '_'), ''), 'player')
    ELSE 'player' END FROM normalized;
$$;
--> statement-breakpoint
CREATE TEMP TABLE player_identity_backfill ON COMMIT DROP AS
SELECT p.player_id, p.user_id, p.public_player_id AS old_public_player_id,
       row_number() OVER (ORDER BY p.created_at ASC, p.player_id ASC) AS player_number,
       circzles_player_id_prefix(CASE WHEN u.email_verified_at IS NOT NULL THEN u.verified_email END) AS prefix
FROM players p LEFT JOIN users u ON u.user_id = p.user_id;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM players p LEFT JOIN users u ON u.user_id = p.user_id WHERE u.user_id IS NULL) THEN
    RAISE EXCEPTION 'Player identity migration blocked: missing user relation';
  END IF;
  IF EXISTS (SELECT 1 FROM players WHERE public_player_id LIKE '~cz-id-migration~%') THEN
    RAISE EXCEPTION 'Player identity migration blocked: reserved temporary ID namespace already in use';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE players ADD COLUMN player_number bigint;
--> statement-breakpoint
-- Two phases retain the public ID unique index, even if old IDs match proposed IDs.
UPDATE players SET public_player_id = '~cz-id-migration~' || player_id::text;
--> statement-breakpoint
UPDATE players p SET player_number = b.player_number,
  public_player_id = b.prefix || '_' || lpad(b.player_number::text, greatest(3, length(b.player_number::text)), '0')
FROM player_identity_backfill b WHERE p.player_id = b.player_id;
--> statement-breakpoint
-- Sole denormalized runtime reference: Rename Card idempotency/replay metadata.
-- Retain other metadata, amounts, timestamps, idempotency keys and UUID links.
UPDATE inventory_consumptions c SET metadata = jsonb_set(c.metadata, '{publicPlayerId}', to_jsonb(p.public_player_id))
FROM players p WHERE c.player_id = p.player_id AND c.metadata ? 'publicPlayerId';
--> statement-breakpoint
ALTER TABLE players ALTER COLUMN player_number SET NOT NULL;
--> statement-breakpoint
ALTER TABLE players ALTER COLUMN player_number ADD GENERATED ALWAYS AS IDENTITY
  (SEQUENCE NAME players_player_number_seq INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE);
--> statement-breakpoint
SELECT setval('players_player_number_seq', coalesce(max(player_number), 1), count(*) > 0) FROM players;
--> statement-breakpoint
CREATE UNIQUE INDEX players_player_number_unique ON players (player_number);
--> statement-breakpoint
ALTER TABLE players ADD CONSTRAINT players_player_number_positive CHECK (player_number > 0);
--> statement-breakpoint
ALTER TABLE players ALTER COLUMN public_player_id SET DEFAULT '';
--> statement-breakpoint
CREATE FUNCTION circzles_assign_player_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE email text;
BEGIN
  SELECT CASE WHEN email_verified_at IS NOT NULL THEN verified_email END INTO email FROM users WHERE user_id = NEW.user_id;
  NEW.public_player_id := circzles_player_id_prefix(email) || '_' || lpad(NEW.player_number::text, greatest(3, length(NEW.player_number::text)), '0');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER players_assign_identity BEFORE INSERT ON players
FOR EACH ROW EXECUTE FUNCTION circzles_assign_player_identity();
--> statement-breakpoint
CREATE FUNCTION circzles_keep_player_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.player_number IS DISTINCT FROM OLD.player_number OR NEW.public_player_id IS DISTINCT FROM OLD.public_player_id THEN
    RAISE EXCEPTION 'Issued player identity is immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER players_keep_identity BEFORE UPDATE OF player_number, public_player_id ON players
FOR EACH ROW EXECUTE FUNCTION circzles_keep_player_identity();
--> statement-breakpoint
DO $$ BEGIN
  IF (SELECT count(*) FROM players) <> (SELECT count(*) FROM player_identity_backfill)
    OR EXISTS (SELECT 1 FROM player_identity_backfill b LEFT JOIN players p ON p.player_id = b.player_id AND p.user_id = b.user_id
      WHERE p.player_id IS NULL OR p.player_number <> b.player_number
      OR p.public_player_id <> b.prefix || '_' || lpad(b.player_number::text, greatest(3, length(b.player_number::text)), '0')) THEN
    RAISE EXCEPTION 'Player identity migration failed reconciliation';
  END IF;
END $$;
