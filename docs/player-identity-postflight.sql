-- Run after manual migration while account/player writes are still paused.
SELECT count(*) AS total_after, count(DISTINCT player_id) AS distinct_internal_uuids,
  count(DISTINCT player_number) AS distinct_numbers, count(DISTINCT public_player_id) AS distinct_public_ids
FROM players;
SELECT count(*) AS missing_or_invalid_numbers FROM players WHERE player_number IS NULL OR player_number<=0;
SELECT count(*) AS missing_user_relations FROM players p LEFT JOIN users u ON p.user_id=u.user_id WHERE u.user_id IS NULL;
SELECT count(*) AS temporary_ids_remaining FROM players WHERE public_player_id LIKE '~cz-id-migration~%';
SELECT count(*) AS stale_replay_ids FROM inventory_consumptions c JOIN players p ON p.player_id=c.player_id
WHERE c.metadata ? 'publicPlayerId' AND c.metadata->>'publicPlayerId' IS DISTINCT FROM p.public_player_id;
-- Do not call nextval() during audit: it consumes a number. With writes paused this predicts the next value.
SELECT last_value, is_called, CASE WHEN is_called THEN last_value+1 ELSE last_value END AS next_number FROM players_player_number_seq;
SELECT player_id,user_id,player_number,public_player_id FROM players ORDER BY player_number;
