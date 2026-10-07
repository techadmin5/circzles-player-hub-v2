-- Read-only verification AFTER the operator's normal signup/email verification.
-- Never select password_hash, challenge tokens or session tokens.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
DO $$ BEGIN
  IF (SELECT count(*) FROM players) <> 1 OR NOT EXISTS (
    SELECT 1 FROM players p JOIN users u USING(user_id)
    WHERE u.verified_email='hazel@theqwertyink.com' AND u.email_verified_at IS NOT NULL
      AND p.player_number=1 AND p.public_player_id='hazel_001' AND p.player_id IS NOT NULL
      AND EXISTS(SELECT 1 FROM password_credentials pc WHERE pc.user_id=u.user_id)
  ) THEN RAISE EXCEPTION 'Hazel launch verification failed; do not reset a live sequence'; END IF;
END $$;
SELECT u.user_id, p.player_id, u.verified_email, p.player_number, p.public_player_id,
       p.player_id IS NOT NULL AS internal_uuid_valid,
       u.email_verified_at IS NOT NULL AS email_verified,
       EXISTS(SELECT 1 FROM password_credentials pc WHERE pc.user_id=u.user_id) AS password_credential_exists,
       (SELECT count(*) FROM players)=1 AS exactly_one_player
FROM players p JOIN users u USING(user_id) WHERE u.verified_email='hazel@theqwertyink.com';
ROLLBACK;
