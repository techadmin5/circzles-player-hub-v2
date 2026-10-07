-- Run on the intended database before the reviewed manual migration.
-- Only a session-local temporary table is created; ROLLBACK leaves no persistent changes.
BEGIN;
CREATE TEMP TABLE proposed_player_identities ON COMMIT DROP AS
WITH normalized_users AS (
  SELECT *, regexp_replace(coalesce(verified_email,''),'^[[:space:]]+|[[:space:]]+$','','g') AS normalized_email FROM users
), ordered AS (
  SELECT p.player_id, p.user_id, p.public_player_id AS old_public_player_id,
    row_number() OVER (ORDER BY p.created_at ASC, p.player_id ASC) AS player_number,
    CASE WHEN u.email_verified_at IS NOT NULL AND u.normalized_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'
      THEN coalesce(nullif(rtrim(left(lower(btrim(regexp_replace(split_part(u.normalized_email,'@',1),'[^A-Za-z0-9]+','_','g'),'_') COLLATE "C"),64),'_'),''),'player')
      ELSE 'player' END AS prefix
  FROM players p LEFT JOIN normalized_users u ON u.user_id=p.user_id
)
SELECT *, prefix || '_' || lpad(player_number::text,greatest(3,length(player_number::text)),'0') AS proposed_public_player_id FROM ordered;

-- Both duplicate-group counts must be zero.
SELECT count(*) AS duplicate_proposed_numbers FROM (SELECT player_number FROM proposed_player_identities GROUP BY player_number HAVING count(*)>1) d;
SELECT count(*) AS duplicate_proposed_public_ids FROM (SELECT proposed_public_player_id FROM proposed_player_identities GROUP BY proposed_public_player_id HAVING count(*)>1) d;
SELECT count(*) AS missing_user_relations FROM players p LEFT JOIN users u ON p.user_id=u.user_id WHERE u.user_id IS NULL;
SELECT count(*) AS temporary_namespace_conflicts FROM players WHERE public_player_id LIKE '~cz-id-migration~%';

-- Explicitly review legacy/unusable/unverified email owners; migration uses player_<number>.
SELECT p.player_id,p.public_player_id,u.status,u.verified_email,u.email_verified_at
FROM players p LEFT JOIN users u ON p.user_id=u.user_id
WHERE u.email_verified_at IS NULL OR regexp_replace(coalesce(u.verified_email,''),'^[[:space:]]+|[[:space:]]+$','','g') !~ '^[^@[:space:]]+@[^@[:space:]]+$';
SELECT player_id,old_public_player_id,proposed_public_player_id FROM proposed_player_identities WHERE prefix='player' ORDER BY player_number;

-- Save this count and mapping outside the database for postflight comparison/recovery.
SELECT (SELECT count(*) FROM players) AS total_before, count(*) AS total_proposed FROM proposed_player_identities;
SELECT player_id,user_id,old_public_player_id,player_number,proposed_public_player_id FROM proposed_player_identities ORDER BY player_number;
SELECT count(*) AS copied_public_id_metadata FROM inventory_consumptions WHERE metadata ? 'publicPlayerId';
ROLLBACK;
