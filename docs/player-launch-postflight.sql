-- Run before Hazel signup; does not allocate a sequence value.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
DO $$ DECLARE table_name text; remaining bigint; BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'coupon_redemptions','coupon_provider_mappings','reward_wheel_spins',
    'inventory_consumptions','player_equipment','submission_reviews','leaderboard_entries',
    'submission_reward_grants','mission_claims','store_purchases','inventory_grants',
    'coupon_ownerships','player_inventory_items','player_mission_progress','game_events',
    'submissions','player_puzzles','video_uploads','puzzle_claims','xp_transactions',
    'point_transactions','player_progression','wallets','auth_sessions','auth_identities',
    'password_credentials','auth_challenges','wix_identity_links','admin_users','players','users'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', table_name) INTO remaining;
    IF remaining <> 0 THEN RAISE EXCEPTION 'Remaining/orphaned rows in %', table_name; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM auth_handoff_exchanges WHERE user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Remaining owned handoff rows';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM players_player_number_seq WHERE last_value=1 AND is_called=false) THEN
    RAISE EXCEPTION 'Expected uncalled sequence value 1';
  END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='players'
      AND indexname IN ('players_public_player_id_unique','players_player_number_unique')
      AND indexdef LIKE 'CREATE UNIQUE INDEX%') <> 2 THEN
    RAISE EXCEPTION 'Missing public ID or number uniqueness';
  END IF;
END $$;
SELECT count(*) AS players_must_be_zero FROM players;
SELECT last_value, is_called, CASE WHEN is_called THEN last_value+1 ELSE last_value END AS next_player_number FROM players_player_number_seq;
SELECT count(*) AS temporary_ids_must_be_zero FROM players WHERE public_player_id LIKE '~cz-id-migration~%';
-- Compare each catalog/config count and fingerprint with the preflight manifest
-- using the CLI postflight command; it checks all non-reset public tables.
SELECT count(*) AS puzzles FROM puzzles;
SELECT count(*) AS progression_levels FROM progression_levels;
SELECT count(*) AS reward_definitions FROM reward_definitions;
SELECT count(*) AS missions FROM missions;
SELECT count(*) AS competition_settings FROM puzzle_competition_settings;
ROLLBACK;
