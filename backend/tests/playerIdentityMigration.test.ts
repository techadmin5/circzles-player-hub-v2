import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "../src/db/schema.js";
import type { Database } from "../src/db/client.js";
import { createPlayer } from "../src/domain/identity.js";
import { generatePublicPlayerId, sanitizePlayerEmailPrefix } from "../src/domain/playerId.js";

let pg: PGlite;
let db: Database;
const playerIds = [1, 2, 3, 4].map((number) => `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`);
const userIds = [1, 2, 3, 4].map((number) => `20000000-0000-4000-8000-${String(number).padStart(12, "0")}`);
const samples = [
  ["Hazel@gmail.com", 1n, "hazel_001"], ["john.doe@gmail.com", 2n, "john_doe_002"],
  ["john+work@gmail.com", 9n, "john_work_009"], ["name@gmail.com", 299n, "name_299"],
  ["name@gmail.com", 999n, "name_999"], ["name@gmail.com", 1000n, "name_1000"],
  ["name@gmail.com", 10000n, "name_10000"], ["  __John++work--@example.com  ", 85n, "john_work_085"],
  ["☃@example.com", 1n, "player_001"], ["@example.com", 1n, "player_001"],
  ["not-an-email", 1n, "player_001"], ["a@@example.com", 1n, "player_001"],
  [null, 1n, "player_001"], ["___@example.com", 1n, "player_001"],
  ["\tHazel@gmail.com\n", 1n, "hazel_001"], ["with space@example.test", 1n, "player_001"],
] as const;

beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter((file) => file.endsWith(".sql") && !file.startsWith("0021_")).sort()) {
    await pg.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  }
  // Intentionally insert out of creation order and make an old ID collide with a proposed ID.
  await pg.query(`INSERT INTO users(user_id,verified_email,email_verified_at,status) VALUES
    ($1,'hazel@gmail.com',now(),'ACTIVE'),($2,'john.doe@gmail.com',now(),'ACTIVE'),
    ($3,NULL,NULL,'SUSPENDED'),($4,'unproved@example.test',NULL,'DELETED')`, userIds);
  for (const index of [2, 1, 3, 0]) {
    await pg.query("INSERT INTO players(player_id,user_id,public_player_id,display_name,created_at) VALUES($1,$2,$3,'Player',$4)",
      [playerIds[index], userIds[index], index === 2 ? "hazel_001" : `CZ-OLD00${index}`, index < 2 ? "2020-01-01T00:00:00Z" : "2021-01-01T00:00:00Z"]);
  }
  await pg.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,'session-hash',now()+interval '1 day')", [userIds[0]]);
  await pg.query("INSERT INTO wallets(player_id,balance) VALUES($1,123)", [playerIds[0]]);
  // Minimal genuine Rename Card records to prove the denormalized ID changes consistently.
  const reward = (await pg.query<{ reward_definition_id: string }>("INSERT INTO reward_definitions(code,reward_type,name,description) VALUES('TEST_RENAME','RENAME_CARD','Rename','Test fixture') RETURNING reward_definition_id")).rows[0];
  const item = (await pg.query<{ player_inventory_item_id: string }>("INSERT INTO player_inventory_items(player_id,reward_definition_id,quantity) VALUES($1,$2,1) RETURNING player_inventory_item_id", [playerIds[0], reward.reward_definition_id])).rows[0];
  await pg.query("INSERT INTO inventory_consumptions(player_id,player_inventory_item_id,reward_definition_id,quantity,quantity_after,reason,idempotency_key,metadata) VALUES($1,$2,$3,1,0,'DISPLAY_NAME_CHANGE','rename-replay',$4)",
    [playerIds[0], item.player_inventory_item_id, reward.reward_definition_id, { publicPlayerId: "CZ-OLD000", displayName: "New name", previousDisplayName: "Player", inventoryItemId: item.player_inventory_item_id }]);
  // Create genuine gameplay/history references before migration, then compare every row.
  const fixtureDb = drizzle(pg, { schema });
  const [design] = await fixtureDb.insert(schema.puzzleDesigns).values({ name: "Migration puzzle" }).returning();
  const [puzzle] = await fixtureDb.insert(schema.puzzles).values({ puzzleDesignId: design.puzzleDesignId, name: "Migration puzzle", levelId: 1 }).returning();
  const [owned] = await fixtureDb.insert(schema.playerPuzzles).values({ playerId: playerIds[0], puzzleId: puzzle.puzzleId }).returning();
  const [video] = await fixtureDb.insert(schema.videoUploads).values({ playerId: playerIds[0], storageProvider: "TEST", publicId: "migration-video", mimeType: "video/mp4", declaredSizeBytes: 100, expiresAt: new Date(Date.now()+60_000) }).returning();
  const [submission] = await fixtureDb.insert(schema.submissions).values({ playerId: playerIds[0], playerPuzzleId: owned.playerPuzzleId, puzzleId: puzzle.puzzleId, levelId: 1, videoUploadId: video.videoUploadId, completionTimeMs: 1000, status: "APPROVED" }).returning();
  await fixtureDb.insert(schema.leaderboardEntries).values({ playerId: playerIds[0], puzzleId: puzzle.puzzleId, bestSubmissionId: submission.submissionId, bestCompletionTimeMs: 1000, bestApprovedAt: new Date(), bestSubmittedAt: submission.submittedAt });
  await fixtureDb.insert(schema.progressionLevels).values({ progressionLevel: 1, rankName: "Peasant", xpRequired: 0 });
  await fixtureDb.insert(schema.playerProgression).values({ playerId: playerIds[0], progressionLevel: 1, rankName: "Peasant", totalXp: 150 });
  await fixtureDb.insert(schema.gameEvents).values({ playerId: playerIds[0], eventType: "player.display_name.changed", sourceType: "TEST", sourceId: "migration-event", idempotencyKey: "migration-event", payload: { previousDisplayName: "Player", displayName: "New name" } });
  const preservedTables = ["users", "wallets", "auth_sessions", "player_puzzles", "video_uploads", "submissions", "leaderboard_entries", "player_progression", "player_inventory_items", "game_events"];
  const preservedRows = new Map<string, unknown>();
  for (const table of preservedTables) preservedRows.set(table, (await pg.query(`SELECT * FROM ${table}`)).rows);
  const snapshot = await pg.query("SELECT player_id,user_id,display_name,created_at,updated_at FROM players ORDER BY player_id");
  const wallets = (await pg.query("SELECT * FROM wallets")).rows;
  const sessions = (await pg.query("SELECT * FROM auth_sessions")).rows;
  const consumption = (await pg.query<{ metadata: Record<string, unknown> }>("SELECT * FROM inventory_consumptions")).rows[0];
  await pg.exec(await readFile(new URL("../../docs/player-identity-preflight.sql", import.meta.url), "utf8"));
  await pg.exec("BEGIN");
  await pg.exec(await readFile(new URL("../drizzle/0021_sequential_player_identity.sql", import.meta.url), "utf8"));
  await pg.exec("COMMIT");
  expect((await pg.query("SELECT player_id,user_id,display_name,created_at,updated_at FROM players ORDER BY player_id")).rows).toEqual(snapshot.rows);
  expect((await pg.query("SELECT * FROM wallets")).rows).toEqual(wallets);
  expect((await pg.query("SELECT * FROM auth_sessions")).rows).toEqual(sessions);
  expect((await pg.query("SELECT * FROM inventory_consumptions")).rows[0]).toEqual({ ...consumption, metadata: { ...consumption.metadata, publicPlayerId: "hazel_001" } });
  for (const table of preservedTables) expect((await pg.query(`SELECT * FROM ${table}`)).rows).toEqual(preservedRows.get(table));
  await pg.exec(await readFile(new URL("../../docs/player-identity-postflight.sql", import.meta.url), "utf8"));
  db = drizzle(pg, { schema }) as unknown as Database;
}, 60_000);
afterAll(async () => { await pg?.close(); });

describe("permanent sequential player identity", () => {
  it.each(["empty", "reserved namespace"])("handles %s migration transaction safely", async (scenario) => {
    const isolated = new PGlite();
    try {
      for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter((file) => file.endsWith(".sql") && !file.startsWith("0021_")).sort()) {
        await isolated.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
      }
      const migration = await readFile(new URL("../drizzle/0021_sequential_player_identity.sql", import.meta.url), "utf8");
      if (scenario === "reserved namespace") {
        await isolated.exec("INSERT INTO users(user_id) VALUES('20000000-0000-4000-8000-000000000001'); INSERT INTO players(user_id,public_player_id,display_name) VALUES('20000000-0000-4000-8000-000000000001','~cz-id-migration~existing','Legacy')");
        const before = (await isolated.query("SELECT * FROM players")).rows;
        await isolated.exec("BEGIN");
        await expect(isolated.exec(migration)).rejects.toThrow(/reserved temporary ID namespace/);
        await isolated.exec("ROLLBACK");
        expect((await isolated.query("SELECT * FROM players")).rows).toEqual(before);
        expect((await isolated.query("SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='player_number'")).rows).toHaveLength(0);
      } else {
        await isolated.exec("BEGIN"); await isolated.exec(migration); await isolated.exec("COMMIT");
        await isolated.exec("INSERT INTO users(user_id) VALUES('20000000-0000-4000-8000-000000000001'); INSERT INTO players(user_id,display_name) VALUES('20000000-0000-4000-8000-000000000001','Legacy')");
        expect((await isolated.query("SELECT player_number::text AS number,public_player_id FROM players")).rows).toEqual([{ number: "1", public_player_id: "player_001" }]);
      }
    } finally { await isolated.close(); }
  }, 60_000);
  it.each(samples)("formats %s at number %s as %s", (email, number, expected) => expect(generatePublicPlayerId(email, number)).toBe(expected));
  it("rejects invalid numeric allocations and caps only the email prefix", () => {
    expect(() => generatePublicPlayerId("a@example.test", 0n)).toThrow();
    expect(() => generatePublicPlayerId("a@example.test", 9223372036854775808n)).toThrow();
    expect(sanitizePlayerEmailPrefix("a".repeat(100) + "@example.test")).toHaveLength(64);
    expect(generatePublicPlayerId("a@example.test", 9223372036854775807n)).toBe("a_9223372036854775807");
  });
  it("backfills by created_at then UUID, including suspended and deleted legacy players", async () => {
    const rows = (await pg.query("SELECT player_id, player_number::text AS number, public_player_id FROM players ORDER BY player_number")).rows;
    expect(rows).toEqual(playerIds.map((id, index) => ({ player_id: id, number: String(index + 1), public_player_id: ["hazel_001", "john_doe_002", "player_003", "player_004"][index] })));
    expect((await pg.query<{ id: string }>("SELECT metadata->>'publicPlayerId' AS id FROM inventory_consumptions")).rows[0].id).toBe("hazel_001");
  });
  it("keeps SQL and TypeScript sanitization identical", async () => {
    for (const [email] of samples) expect((await pg.query<{ prefix: string }>("SELECT circzles_player_id_prefix($1) AS prefix", [email])).rows[0].prefix).toBe(sanitizePlayerEmailPrefix(email));
  });
  it("allocates above the migrated maximum and ignores caller-selected public IDs", async () => {
    const user = (await db.insert(schema.users).values({ verifiedEmail: "shaun@gmail.com", emailVerifiedAt: new Date() }).returning())[0];
    const player = await db.transaction((tx) => createPlayer(tx, user.userId, "Unrelated Display Name"));
    expect(player.playerNumber).toBe(5n); expect(player.publicPlayerId).toBe("shaun_005");
    const [otherUser] = await db.insert(schema.users).values({ verifiedEmail: "other@example.test", emailVerifiedAt: new Date() }).returning();
    const [assigned] = await db.insert(schema.players).values({ userId: otherUser.userId, displayName: "Other", publicPlayerId: "arbitrary_999" }).returning();
    expect(assigned.publicPlayerId).toBe(generatePublicPlayerId("other@example.test", assigned.playerNumber));
  });
  it("handles concurrent allocations with unique numbers and public IDs", async () => {
    const users = await db.insert(schema.users).values(Array.from({ length: 20 }, (_, index) => ({ verifiedEmail: `same.local@domain${index}.test`, emailVerifiedAt: new Date() }))).returning();
    const allocations = await Promise.all(users.map((user) => db.transaction((tx) => createPlayer(tx, user.userId))));
    expect(new Set(allocations.map((player) => player.playerNumber.toString())).size).toBe(20);
    expect(new Set(allocations.map((player) => player.publicPlayerId)).size).toBe(20);
    for (const player of allocations) expect(player.publicPlayerId).toMatch(/^same_local_[0-9]{3,}$/);
  });
  it("does not recycle a rolled-back number or one belonging to a deleted player", async () => {
    const user = (await db.insert(schema.users).values({ verifiedEmail: "removed@example.test", emailVerifiedAt: new Date() }).returning())[0];
    const removed = await db.transaction((tx) => createPlayer(tx, user.userId));
    await db.execute(sql`DELETE FROM players WHERE player_id=${removed.playerId}`);
    let rolledBack = 0n;
    await expect(db.transaction(async (tx) => { rolledBack = (await createPlayer(tx, user.userId)).playerNumber; throw new Error("rollback"); })).rejects.toThrow("rollback");
    const next = await db.transaction((tx) => createPlayer(tx, user.userId));
    expect(next.playerNumber).toBeGreaterThan(rolledBack); expect(next.playerNumber).toBeGreaterThan(removed.playerNumber);
  });
  it("keeps both IDs permanent when display name or email changes", async () => {
    await pg.query("UPDATE players SET display_name='Changed' WHERE player_id=$1", [playerIds[0]]);
    await pg.query("UPDATE users SET verified_email='different@example.test' WHERE user_id=$1", [userIds[0]]);
    expect((await pg.query<{ public_player_id: string }>("SELECT public_player_id FROM players WHERE player_id=$1", [playerIds[0]])).rows[0].public_player_id).toBe("hazel_001");
    await expect(pg.query("UPDATE players SET public_player_id='changed_001' WHERE player_id=$1", [playerIds[0]])).rejects.toThrow(/immutable/);
    await expect(pg.query("UPDATE players SET player_number=999 WHERE player_id=$1", [playerIds[0]])).rejects.toThrow(/DEFAULT|immutable/);
    await expect(pg.query("UPDATE players SET player_number=DEFAULT WHERE player_id=$1", [playerIds[0]])).rejects.toThrow(/immutable/);
    await expect(pg.query("INSERT INTO players(user_id,player_number,display_name) VALUES($1,999,'Override')", [userIds[0]])).rejects.toThrow(/non-DEFAULT|identity/);
  });
});
