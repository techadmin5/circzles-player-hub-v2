import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import * as s from "../src/db/schema.js";
import type { Database } from "../src/db/client.js";
import { createPlayer } from "../src/domain/identity.js";
import { DrizzleNativeAuthRepository } from "../src/domain/nativeAuthRepository.js";
import { NativeAuthService } from "../src/domain/nativeAuth.js";
import { DevelopmentAuthMailer } from "../src/domain/authEmail.js";
import { assertLaunchPostflight, captureResetPreflight, resetTestPlayersAndMigrate, resetOrder } from "../src/operations/playerLaunchReset.js";

let pg: PGlite;
let db: Database;
async function historical(target: PGlite) {
  const migrations = readMigrationFiles({ migrationsFolder: fileURLToPath(new URL("../drizzle/", import.meta.url)) });
  await target.exec("CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations(id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)");
  for (const migration of migrations.slice(0, 21)) {
    for (const statement of migration.sql) await target.exec(statement.replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
    await target.query("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES($1,$2)", [migration.hash, migration.folderMillis]);
  }
}
beforeAll(async () => {
  pg = new PGlite();
  await historical(pg);
  const fixture = drizzle(pg, { schema: s });
  const users = await fixture.insert(s.users).values(Array.from({ length: 12 }, (_, i) => ({ verifiedEmail: `test${i}@example.test`, emailVerifiedAt: new Date() }))).returning();
  // Raw insert: the schema now has player_number but the pre-launch database deliberately does not.
  const ids = [] as string[];
  for (const [i, user] of users.entries()) ids.push((await pg.query<{ player_id: string }>("INSERT INTO players(user_id,public_player_id,display_name) VALUES($1,$2,'Test') RETURNING player_id", [user.userId, `CZ-TEST${i}`])).rows[0].player_id);
  const playerId = ids[0], userId = users[0].userId;
  const [design] = await fixture.insert(s.puzzleDesigns).values({ name: "Preserved design" }).returning();
  const [puzzle] = await fixture.insert(s.puzzles).values({ puzzleDesignId: design.puzzleDesignId, name: "Preserved puzzle", levelId: 1 }).returning();
  // Deliberately pre-0025 fixture: use the historical column set.
  await pg.query("INSERT INTO puzzle_competition_settings(puzzle_id,category,display_order) VALUES($1,'MAIN_LEVEL',0)", [puzzle.puzzleId]);
  const [prefix] = await fixture.insert(s.puzzleClaimPrefixes).values({ puzzleId: puzzle.puzzleId, prefix: "TEST", normalizedPrefix: "TEST" }).returning();
  const [claim] = await fixture.insert(s.puzzleClaims).values({ puzzleClaimPrefixId: prefix.puzzleClaimPrefixId, puzzleId: puzzle.puzzleId, playerId, serialNumber: 1n, normalizedCode: "TEST1" }).returning();
  const [owned] = await fixture.insert(s.playerPuzzles).values({ playerId, puzzleId: puzzle.puzzleId, puzzleClaimId: claim.puzzleClaimId }).returning();
  const [video] = await fixture.insert(s.videoUploads).values({ playerId, storageProvider: "TEST", publicId: "test-video", mimeType: "video/mp4", declaredSizeBytes: 10, expiresAt: new Date(Date.now()+60_000) }).returning();
  const [submission] = await fixture.insert(s.submissions).values({ playerId, puzzleId: puzzle.puzzleId, playerPuzzleId: owned.playerPuzzleId, videoUploadId: video.videoUploadId, levelId: 1, completionTimeMs: 1000 }).returning();
  const [admin] = await fixture.insert(s.adminUsers).values({ userId, role: "REVIEWER" }).returning();
  await fixture.insert(s.submissionReviews).values({ submissionId: submission.submissionId, reviewerAdminUserId: admin.adminUserId, decision: "APPROVED", idempotencyKey: "review" });
  await fixture.insert(s.leaderboardEntries).values({ playerId, puzzleId: puzzle.puzzleId, bestSubmissionId: submission.submissionId, bestCompletionTimeMs: 1000, bestApprovedAt: new Date(), bestSubmittedAt: new Date() });
  const [point] = await fixture.insert(s.pointTransactions).values({ playerId, amount: 1, direction: "CREDIT", reason: "TEST", sourceType: "TEST", balanceAfter: 1 }).returning();
  const [xp] = await fixture.insert(s.xpTransactions).values({ playerId, amount: 1, reason: "TEST", sourceType: "TEST", totalXpAfter: 1 }).returning();
  await fixture.insert(s.submissionRewardGrants).values({ playerId, puzzleId: puzzle.puzzleId, submissionId: submission.submissionId, rewardEnabledSnapshot: true, synapseReward: 1, xpReward: 1, pointTransactionId: point.transactionId, xpTransactionId: xp.xpTransactionId });
  await fixture.insert(s.progressionLevels).values({ progressionLevel: 1, rankName: "Peasant", xpRequired: 0 });
  await fixture.insert(s.playerProgression).values({ playerId, progressionLevel: 1, rankName: "Peasant", totalXp: 1 });
  await fixture.insert(s.wallets).values({ playerId, balance: 1 });
  const [event] = await fixture.insert(s.gameEvents).values({ playerId, eventType: "TEST", sourceType: "TEST", sourceId: "TEST", idempotencyKey: "event" }).returning();
  const [mission] = await fixture.insert(s.missions).values({ title: "Preserved", description: "Test", category: "TEST", periodType: "ONCE" }).returning();
  await fixture.insert(s.missionRules).values({ missionId: mission.missionId, eventType: "TEST", targetCount: 1, puzzleId: puzzle.puzzleId });
  await fixture.insert(s.missionRewards).values({ missionId: mission.missionId, rewardType: "XP", amount: 1 });
  const [progress] = await fixture.insert(s.playerMissionProgress).values({ playerId, missionId: mission.missionId, periodKey: "TEST", targetCountSnapshot: 1, lastGameEventId: event.gameEventId }).returning();
  await fixture.insert(s.missionClaims).values({ playerId, missionId: mission.missionId, playerMissionProgressId: progress.playerMissionProgressId, periodKey: "TEST", idempotencyKey: "claim", pointTransactionId: point.transactionId, xpTransactionId: xp.xpTransactionId });
  const [reward] = await fixture.insert(s.rewardDefinitions).values({ code: "TEST", rewardType: "FRAME", name: "Preserved", description: "Test" }).returning();
  const [listing] = await fixture.insert(s.storeListings).values({ rewardDefinitionId: reward.rewardDefinitionId, priceSynapsePoints: 1 }).returning();
  await fixture.insert(s.storePurchases).values({ playerId, storeListingId: listing.storeListingId, rewardDefinitionId: reward.rewardDefinitionId, priceSynapsePointsSnapshot: 1, rewardTypeSnapshot: "FRAME", rewardCodeSnapshot: "TEST", rewardNameSnapshot: "TEST", pointTransactionId: point.transactionId, balanceAfter: 1, idempotencyKey: "purchase" });
  const [grant] = await fixture.insert(s.inventoryGrants).values({ playerId, rewardDefinitionId: reward.rewardDefinitionId, sourceType: "TEST", sourceId: "TEST", quantity: 1, idempotencyKey: "grant" }).returning();
  const [item] = await fixture.insert(s.playerInventoryItems).values({ playerId, rewardDefinitionId: reward.rewardDefinitionId, quantity: 1 }).returning();
  await fixture.insert(s.inventoryConsumptions).values({ playerId, playerInventoryItemId: item.playerInventoryItemId, rewardDefinitionId: reward.rewardDefinitionId, quantity: 1, quantityAfter: 0, reason: "TEST", idempotencyKey: "consume" });
  await fixture.insert(s.playerEquipment).values({ playerId, slot: "FRAME", playerInventoryItemId: item.playerInventoryItemId });
  const [coupon] = await fixture.insert(s.couponOwnerships).values({ playerId, rewardDefinitionId: reward.rewardDefinitionId, couponCode: "TESTCOUPON", sourceType: "TEST", sourceId: "TEST", issuanceOrdinal: 1, idempotencyKey: "coupon" }).returning();
  await fixture.insert(s.couponProviderMappings).values({ couponOwnershipId: coupon.couponOwnershipId, storefrontTarget: "SHOPIFY_COGZART", provider: "SHOPIFY" });
  await fixture.insert(s.couponRedemptions).values({ couponOwnershipId: coupon.couponOwnershipId, storefrontTarget: "SHOPIFY_COGZART", sourceRedemptionId: "TEST", idempotencyKey: "redeem", redeemedAt: new Date() });
  const [wheel] = await fixture.insert(s.rewardWheels).values({ code: "TEST", name: "Preserved" }).returning();
  const [segment] = await fixture.insert(s.rewardWheelSegments).values({ rewardWheelId: wheel.rewardWheelId, position: 0, displayLabel: "Preserved", weight: 1, rewardDefinitionId: reward.rewardDefinitionId, rewardQuantity: 1 }).returning();
  const [tier] = await fixture.insert(s.rewardWheelSpinTiers).values({ rewardWheelId: wheel.rewardWheelId, spinNumber: 1, costSynapsePoints: 0 }).returning();
  await fixture.insert(s.rewardWheelSpins).values({ playerId, rewardWheelId: wheel.rewardWheelId, rewardWheelSegmentId: segment.rewardWheelSegmentId, rewardWheelSpinTierId: tier.rewardWheelSpinTierId, rewardDefinitionId: reward.rewardDefinitionId, wheelCodeSnapshot: "TEST", wheelNameSnapshot: "TEST", segmentPositionSnapshot: 0, segmentLabelSnapshot: "TEST", spinCostSynapsePointsSnapshot: 0, cooldownSecondsSnapshot: 0, rewardQuantitySnapshot: 1, rewardTypeSnapshot: "FRAME", rewardCodeSnapshot: "TEST", rewardNameSnapshot: "TEST", resultingSynapsePointBalance: 1, rewardInventoryGrantId: grant.inventoryGrantId, idempotencyKey: "spin" });
  await fixture.insert(s.authSessions).values({ userId, tokenHash: "test-session", expiresAt: new Date() });
  await fixture.insert(s.authIdentities).values({ userId, provider: "GOOGLE", providerSubject: "TEST", providerEmail: users[0].verifiedEmail! });
  await fixture.insert(s.passwordCredentials).values({ userId, passwordHash: "DISPOSABLE_TEST_HASH" });
  await fixture.insert(s.authChallenges).values({ email: users[0].verifiedEmail!, purpose: "VERIFY_EMAIL", tokenHash: "TEST", expiresAt: new Date() });
  await fixture.insert(s.wixIdentityLinks).values({ userId, wixMemberId: "TEST" });
  await fixture.insert(s.authHandoffExchanges).values([{ userId, tokenIdHash: "owned", sourceSite: "CIRCZLES_COM", expiresAt: new Date() }, { tokenIdHash: "unbound", sourceSite: "CIRCZLES_COM", expiresAt: new Date() }]);
  await pg.exec("CREATE TABLE global_config(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), value text); INSERT INTO global_config(value) VALUES('Preserved')");
  db = fixture as unknown as Database;
}, 60_000);
beforeEach(async () => { await pg.exec("BEGIN"); });
afterEach(async () => { await pg.exec("ROLLBACK"); });
afterAll(async () => { await pg.close(); });

it("resets only the reviewed 12 identities, preserves all master UUIDs/data and starts at uncalled 1", async () => {
  const manifest = await captureResetPreflight(pg);
  expect(manifest.identities).toHaveLength(12);
  expect(manifest.challenges).toHaveLength(1);
  expect(manifest.dependencies).toHaveLength(resetOrder.length);
  expect(manifest.dependencies.every((row) => Number(row.count) > 0)).toBe(true);
  expect(JSON.stringify(manifest)).not.toContain("DISPOSABLE_TEST_HASH");
  await resetTestPlayersAndMigrate(pg, manifest);
  await assertLaunchPostflight(pg, manifest);
  expect((await pg.query("SELECT user_id FROM auth_handoff_exchanges")).rows).toEqual([{ user_id: null }]);
});

it("does not recycle failed allocations and concurrent creates remain unique", async () => {
  await resetTestPlayersAndMigrate(pg, await captureResetPreflight(pg));
  await pg.exec(await readFile(new URL("../drizzle/0022_player_profile_avatar.sql", import.meta.url), "utf8"));
  const [user] = await db.insert(s.users).values({ verifiedEmail: "gap@example.test", emailVerifiedAt: new Date() }).returning();
  await pg.exec("SAVEPOINT failed_insert");
  await createPlayer(db as unknown as Parameters<typeof createPlayer>[0], user.userId);
  await pg.exec("ROLLBACK TO SAVEPOINT failed_insert");
  const next = await createPlayer(db as unknown as Parameters<typeof createPlayer>[0], user.userId);
  expect(next.playerNumber).toBe(2n);
  const users = await db.insert(s.users).values(Array.from({ length: 8 }, (_, i) => ({ verifiedEmail: `same@domain${i}.test`, emailVerifiedAt: new Date() }))).returning();
  const allocated = await Promise.all(users.map((row) => createPlayer(db as unknown as Parameters<typeof createPlayer>[0], row.userId)));
  expect(new Set(allocated.map((row) => row.playerNumber)).size).toBe(8);
  expect(new Set(allocated.map((row) => row.publicPlayerId)).size).toBe(8);
});

it.each(["allowlist", "extra user", "dependency", "catalog", "pending signup", "unreviewed FK", "already applied", "sequence exists"])("fails closed for %s changes", async (change) => {
  const reviewed = await captureResetPreflight(pg);
  if (change === "allowlist") reviewed.identities[0].player_id = crypto.randomUUID();
  if (change === "extra user") await db.insert(s.users).values({ verifiedEmail: "unexpected@example.test" });
  if (change === "dependency") await pg.exec("UPDATE wallets SET balance=2");
  if (change === "catalog") await pg.exec("UPDATE puzzles SET name='Changed'");
  if (change === "pending signup") await pg.exec("INSERT INTO auth_challenges(email,purpose,token_hash,expires_at) VALUES('unexpected@example.test','VERIFY_EMAIL','unexpected',now())");
  if (change === "unreviewed FK") await pg.exec("CREATE TABLE unknown_player_data(id uuid PRIMARY KEY, player_id uuid REFERENCES players(player_id))");
  if (change === "already applied") await pg.exec("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES('TEST',1791358780592)");
  if (change === "sequence exists") await pg.exec("CREATE SEQUENCE players_player_number_seq");
  await expect(resetTestPlayersAndMigrate(pg, reviewed)).rejects.toThrow();
  expect((await pg.query<{ count: string }>("SELECT count(*)::text AS count FROM players")).rows[0].count).toBe("12");
});

it("rolls deletion, schema and journal back together if final protected-data reconciliation fails", async () => {
  const reviewed = await captureResetPreflight(pg);
  await pg.exec("SAVEPOINT reset_attempt");
  const failingClient = { query: async (text: string, values?: unknown[]) => {
    if (text.startsWith("INSERT INTO drizzle.__drizzle_migrations")) await pg.exec("UPDATE global_config SET value='Unexpected'");
    return pg.query<Record<string, unknown>>(text, values);
  } };
  await expect(resetTestPlayersAndMigrate(failingClient, reviewed)).rejects.toThrow(/Protected/);
  await pg.exec("ROLLBACK TO SAVEPOINT reset_attempt");
  expect(await captureResetPreflight(pg)).toEqual(reviewed);
});

it("normal native signup/verification gives Hazel 001 then a second player 002, with hashed credentials", async () => {
  // Separate database: the normal repository owns its own transaction boundaries.
  const nativePg = new PGlite();
  try {
    await historical(nativePg);
    await nativePg.exec("INSERT INTO users(verified_email,email_verified_at) SELECT 'test'||n||'@example.test',now() FROM generate_series(1,12) n; INSERT INTO players(user_id,public_player_id,display_name) SELECT user_id,'TEST-'||user_id::text,'Test' FROM users");
    await nativePg.exec(await readFile(new URL("../../docs/player-launch-preflight.sql", import.meta.url), "utf8"));
    await nativePg.exec("BEGIN");
    await resetTestPlayersAndMigrate(nativePg, await captureResetPreflight(nativePg));
    await nativePg.exec("COMMIT");
    await nativePg.exec(await readFile(new URL("../../docs/player-launch-postflight.sql", import.meta.url), "utf8"));
    await nativePg.exec(await readFile(new URL("../drizzle/0022_player_profile_avatar.sql", import.meta.url), "utf8"));
    const nativeDb = drizzle(nativePg, { schema: s }) as unknown as Database;
    const mailer = new DevelopmentAuthMailer();
    const service = new NativeAuthService(new DrizzleNativeAuthRepository(nativeDb), mailer);
    // Ephemeral test input only: operators choose their own private password through the UI.
    await service.signup({ email: "hazel@theqwertyink.com", password: crypto.randomUUID(), displayName: "Hazel" });
    expect((await nativePg.query<{ count: string }>("SELECT count(*)::text AS count FROM players")).rows[0].count).toBe("0");
    const hazel = await service.verify(mailer.messages.at(-1)!.token);
    expect(hazel.player.publicPlayerId).toBe("hazel_001");
    const verified = (await nativePg.query<{ number: string; verified: boolean; credential: boolean }>("SELECT p.player_number::text AS number,u.email_verified_at IS NOT NULL AS verified,pc.password_hash LIKE '$argon2id$%' AS credential FROM players p JOIN users u USING(user_id) JOIN password_credentials pc USING(user_id)")).rows[0];
    expect(verified).toEqual({ number: "1", verified: true, credential: true });
    await nativePg.exec(await readFile(new URL("../../docs/player-launch-hazel-verification.sql", import.meta.url), "utf8"));
    await service.signup({ email: "john.doe@example.test", password: crypto.randomUUID(), displayName: "John" });
    expect((await service.verify(mailer.messages.at(-1)!.token)).player.publicPlayerId).toBe("john_doe_002");
  } finally { await nativePg.close(); }
}, 30_000);
