-- READ-ONLY summary. The operator CLI additionally saves exact allowlists, row
-- fingerprints, dependency counts, all protected tables and the full FK graph.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
DO $$ BEGIN
  IF (SELECT count(*) FROM players) <> 12 OR (SELECT count(*) FROM users) <> 12
    OR EXISTS(SELECT 1 FROM users u FULL JOIN players p ON p.user_id=u.user_id WHERE u.user_id IS NULL OR p.player_id IS NULL) THEN
    RAISE EXCEPTION 'Expected exactly 12 paired test users/players; inspect unexpected identities';
  END IF;
  IF to_regclass('public.players_player_number_seq') IS NOT NULL
    OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='players' AND column_name='player_number') THEN
    RAISE EXCEPTION 'Player sequence/number already exists';
  END IF;
  IF (SELECT count(*) FROM drizzle.__drizzle_migrations) <> 21
    OR (SELECT max(created_at) FROM drizzle.__drizzle_migrations) <> 1791269664453 THEN
    RAISE EXCEPTION 'Expected Drizzle history through 0020 only; use CLI for exact history check';
  END IF;
END $$;
SELECT u.user_id, p.player_id, p.public_player_id, u.verified_email
FROM users u JOIN players p USING(user_id) ORDER BY u.user_id, p.player_id;
-- Exact challenge IDs are separately allowlisted, including pending signup rows
-- with NULL user_id; no deletion based solely on matching an email.
SELECT id, user_id, email, purpose FROM auth_challenges ORDER BY id;
SELECT count(*) AS live_google_states_must_be_zero FROM google_auth_states WHERE expires_at > now();
-- Every dependency and protected catalog/config table is counted before deletion.
-- "target" marks a table with scoped DELETEs, not permission to delete all its rows.
DO $$ DECLARE report record; rows_before bigint; BEGIN
  FOR report IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', report.tablename) INTO rows_before;
    RAISE NOTICE 'table=% count=% target=%', report.tablename, rows_before, report.tablename=ANY(ARRAY[
      'coupon_redemptions','coupon_provider_mappings','reward_wheel_spins',
      'inventory_consumptions','player_equipment','submission_reviews','leaderboard_entries',
      'submission_reward_grants','mission_claims','store_purchases','inventory_grants',
      'coupon_ownerships','player_inventory_items','player_mission_progress','game_events',
      'submissions','player_puzzles','video_uploads','puzzle_claims','xp_transactions',
      'point_transactions','player_progression','wallets','auth_sessions','auth_identities',
      'password_credentials','auth_challenges','auth_handoff_exchanges','wix_identity_links',
      'admin_users','players','users'
    ]);
  END LOOP;
END $$;
SELECT c.table_schema, c.table_name, c.column_name FROM information_schema.columns c
WHERE c.column_name IN ('user_id','player_id') ORDER BY 1,2,3;
-- The CLI manifest additionally stores durable row fingerprints for drift checks.
SELECT ns.nspname AS schema, src.relname AS child, dst.relname AS parent, pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c JOIN pg_class src ON src.oid=c.conrelid
JOIN pg_namespace ns ON ns.oid=src.relnamespace JOIN pg_class dst ON dst.oid=c.confrelid
WHERE c.contype='f' ORDER BY 1,2,3,4;
ROLLBACK;
