-- Read-only audit. All three queries must return ZERO rows before native auth rollout.
-- Resolve conflicts with verified ownership evidence; never merge/delete players automatically.
SELECT lower(btrim(verified_email)) AS normalized_email, array_agg(user_id) AS conflicting_users
FROM users WHERE verified_email IS NOT NULL
GROUP BY lower(btrim(verified_email)) HAVING count(*) > 1;

-- Users created before migration 0019 may have no trustworthy email on their internal identity.
-- Recover a verified email using an audited legacy identity export before deployment.
SELECT u.user_id, p.player_id, p.public_player_id, u.verified_email, u.email_verified_at
FROM users u LEFT JOIN players p USING (user_id)
WHERE u.status = 'ACTIVE' AND (u.verified_email IS NULL OR u.email_verified_at IS NULL);

SELECT u.user_id, p.public_player_id, w.source_site, w.wix_member_id
FROM users u JOIN players p USING (user_id) JOIN wix_identity_links w USING (user_id)
WHERE w.email_verified = true AND w.verified_email IS NOT NULL
  AND lower(btrim(w.verified_email)) IS DISTINCT FROM lower(btrim(u.verified_email));
