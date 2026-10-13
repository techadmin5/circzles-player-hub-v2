import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, type Database } from "../src/db/client.js";
import * as s from "../src/db/schema.js";
import * as c from "../src/db/missionChestSchema.js";
import { DrizzleMissionRepository, DrizzleMissionClaimRepository } from "../src/domain/missions.js";
import { MissionChestService } from "../src/domain/missionChests.js";
import { freezeRewards } from "../src/domain/missionLifecycle.js";
import { DrizzleGameStateRepository } from "../src/domain/gameState.js";

// NEVER falls back to DATABASE_URL or loads production .env credentials.
const url = process.env.MISSIONS_TEST_DATABASE_URL;
function guardedUrl() {
  const parsed = new URL(url!);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.pathname !== '/circzles_m1_test' || parsed.username !== 'circzles_test' || process.env.MISSIONS_POSTGRES_DISPOSABLE !== 'YES_LOCAL_DISPOSABLE') throw new Error('Requires explicitly attested local disposable circzles_m1_test database / circzles_test role');
  return parsed;
}
describe.skipIf(!url)("isolated PostgreSQL 18 multi-connection mission verification", () => {
  let first: ReturnType<typeof createDb>, second: ReturnType<typeof createDb>, db: Database, playerId: string, migrated = false;
  const folder = fileURLToPath(new URL('../drizzle/', import.meta.url));
  const origin = new Date('2025-01-01Z'), now = new Date('2026-01-01T12:00:00Z');
  const rewards = freezeRewards([{ rewardType: 'XP', amount: 20 }, { rewardType: 'SYNAPSE_POINTS', amount: 25 }]);
  beforeAll(async () => {
    const target = guardedUrl(); target.searchParams.set('application_name', 'circzles_m1_test_a'); first = createDb(target.toString(), () => {});
    target.searchParams.set('application_name', 'circzles_m1_test_b'); second = createDb(target.toString(), () => {}); db = first.db;
    const version = (await first.pool.query("SELECT current_setting('server_version_num')::int AS version")).rows[0].version;
    if (version < 180000 || version >= 190000) throw new Error('PostgreSQL 18 required');
    if ((await first.pool.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema IN ('public','drizzle')")).rows[0].count !== 0) throw new Error('Database must be empty; this suite never resets an existing database');
    const a = await first.pool.connect(), b = await second.pool.connect();
    try { expect((await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid).not.toBe((await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid); } finally { a.release(); b.release(); }
    await temporaryMigrations(false, async prepared => migrate(db, { migrationsFolder: prepared }));
  }, 60000);
  afterAll(async () => { await Promise.all([first?.pool.end(), second?.pool.end()]); });
  beforeEach(async () => {
    if (!migrated) return;
    await db.update(s.missions).set({ active: false }); await db.update(c.missionChests).set({ active: false }); await db.update(s.gameEvents).set({ processedAt: new Date() });
    const [user] = await db.insert(s.users).values({ verifiedEmail: `${crypto.randomUUID()}@test.invalid`, emailVerifiedAt: now }).returning();
    const [player] = await db.insert(s.players).values({ userId: user.userId, displayName: 'Isolated test' }).returning(); playerId = player.playerId;
  });
  async function temporaryMigrations(fail: boolean, run: (path: string) => Promise<void>) {
    const temporary = await mkdtemp(resolve(tmpdir(), 'circzles-m1-migrations-'));
    try {
      const journal = JSON.parse(await readFile(resolve(folder, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ tag: string; idx: number }> };
      if (!fail) journal.entries = journal.entries.filter(row => row.idx < 26);
      await mkdir(resolve(temporary, 'meta')); await writeFile(resolve(temporary, 'meta/_journal.json'), JSON.stringify(journal));
      for (const entry of journal.entries) await copyFile(resolve(folder, `${entry.tag}.sql`), resolve(temporary, `${entry.tag}.sql`));
      if (fail) { const path = resolve(temporary, '0026_missions_lifecycle_chests.sql'); await writeFile(path, `${await readFile(path, 'utf8')}\n--> statement-breakpoint\nSELECT 1/0;`); }
      await run(temporary);
    } finally { if (!resolve(temporary).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe temporary path'); await rm(temporary, { recursive: true }); }
  }
  async function mission(targetCount = 1) {
    const [m] = await db.insert(s.missions).values({ title: 'Test', description: 'Test', category: 'DAILY', periodType: 'DAILY', activationEffectiveAt: origin }).returning();
    await db.insert(s.missionRules).values({ missionId: m.missionId, eventType: 'puzzle.added', targetCount, conditions: { testMission: m.missionId } });
    await db.insert(s.missionRewards).values(rewards.rewards.map(r => ({ missionId: m.missionId, rewardType: r.type, amount: r.amount }))); return m;
  }
  async function source(m: typeof s.missions.$inferSelect) { const [e] = await db.insert(s.gameEvents).values({ playerId, eventType: 'puzzle.added', sourceType: 'PUZZLE_CLAIM', sourceId: crypto.randomUUID(), payload: { testMission: m.missionId }, idempotencyKey: crypto.randomUUID(), createdAt: now }).returning(); return e; }
  const engine = (other = false) => new DrizzleMissionRepository(other ? second.db : db);
  const claim = (missionId: string, key: string, other = false) => new DrizzleMissionClaimRepository(other ? second.db : db).claim({ playerId, missionId, periodKey: '2026-01-01', now, idempotencyKey: key });
  async function ledgers(count = 1) { expect(await db.select().from(s.pointTransactions).where(eq(s.pointTransactions.playerId, playerId))).toHaveLength(count); expect(await db.select().from(s.xpTransactions).where(eq(s.xpTransactions.playerId, playerId))).toHaveLength(count); }

  it('rolls back failed 0026 DDL and journal, then retries through the actual migrator', async () => {
    await expect(temporaryMigrations(true, prepared => migrate(db, { migrationsFolder: prepared }))).rejects.toThrow();
    expect((await first.pool.query("SELECT to_regclass('public.mission_chests') AS name")).rows[0].name).toBeNull();
    expect((await first.pool.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).rows[0].count).toBe(26);
    expect((await first.pool.query("SELECT count(*)::int AS count FROM pg_proc WHERE proname='mission_earned_snapshot_immutable'")).rows[0].count).toBe(0);
    await migrate(db, { migrationsFolder: folder }); migrated = true;
    expect((await first.pool.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).rows[0].count).toBe(27);
    await new DrizzleGameStateRepository(db).seedProgressionLevels([{ progressionLevel: 1, rankName: 'Test', xpRequired: 0, rewards: [] }]);
  });
  it('concurrent workers cannot process one event twice', async () => {
    const m = await mission(2); await source(m); await Promise.all([engine().processBatch(100), engine(true).processBatch(100)]);
    expect((await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.missionId, m.missionId)))[0].currentCount).toBe(1); await ledgers(0);
  });
  it.each([true, false])('concurrent claims with same key=%s pay once', async same => {
    const m = await mission(); await source(m); await engine().processBatch(100); const key = crypto.randomUUID();
    const outcomes = await Promise.allSettled([claim(m.missionId, key), claim(m.missionId, same ? key : crypto.randomUUID(), true)]);
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(same ? 2 : 1); await ledgers();
  });
  it('completion versus claim race remains retryable and pays once', async () => {
    const m = await mission(); await source(m); const key = crypto.randomUUID();
    await Promise.allSettled([engine().processBatch(100), claim(m.missionId, key, true)]);
    expect((await claim(m.missionId, key, true)).awarded.xp).toBe(20); await ledgers();
  });
  it('definition-locked configuration edits cannot change already earned payouts', async () => {
    const m = await mission(); await source(m);
    await Promise.all([engine().processBatch(100), second.db.transaction(async tx => { await tx.select().from(s.missions).where(eq(s.missions.missionId, m.missionId)).for('update'); await tx.update(s.missionRewards).set({ amount: 999 }).where(eq(s.missionRewards.missionId, m.missionId)); })]);
    const [progress] = await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.missionId, m.missionId));
    await db.update(s.missionRewards).set({ amount: 123 }).where(eq(s.missionRewards.missionId, m.missionId));
    const result = await claim(m.missionId, crypto.randomUUID(), true); expect(result.awarded.xp).toBe(progress.rewardSnapshot!.rewards.find(r => r.type === 'XP')!.amount); await ledgers();
  });
  it('chest claims are idempotent across independent connections and fresh keys', async () => {
    const m = await mission(); const [box] = await db.insert(c.missionChests).values({ title: 'Test', periodType: 'DAILY', targetCount: 1, rewards, active: true, activationEffectiveAt: origin }).returning(); await db.insert(c.missionChestEligibility).values({ chestId: box.chestId, missionId: m.missionId, active: true, effectiveAt: origin }); await source(m); await engine().processBatch(100);
    const key = crypto.randomUUID(), input = { playerId, chestId: box.chestId, periodKey: '2026-01-01', now, idempotencyKey: key };
    const [a,b] = await Promise.all([new MissionChestService(db).claim(input), new MissionChestService(second.db).claim(input)]); expect(a.chestClaimId).toBe(b.chestClaimId);
    await expect(new MissionChestService(second.db).claim({ ...input, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: 'CHEST_ALREADY_CLAIMED' }); await ledgers();
  });
  it('poison retries and quarantine survive independent-worker restart', async () => {
    const bad = await mission(), healthy = await mission(); const event = await source(bad);
    await first.pool.query(`CREATE FUNCTION test_poison() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.mission_id='${bad.missionId}' THEN RAISE EXCEPTION 'isolated test'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_poison BEFORE INSERT ON player_mission_progress FOR EACH ROW EXECUTE FUNCTION test_poison();`);
    try {
      for (let attempt = 0; attempt < 5; attempt++) { await expect(engine(attempt % 2 === 1).processBatch(100)).rejects.toMatchObject({ code: 'MISSION_PROCESSOR_RETRY' }); await db.update(c.missionEventAttempts).set({ nextAttemptAt: origin }).where(eq(c.missionEventAttempts.gameEventId, event.gameEventId)); }
      expect((await db.select().from(c.missionEventAttempts).where(eq(c.missionEventAttempts.gameEventId, event.gameEventId)))[0].quarantinedAt).not.toBeNull(); await source(healthy); await engine(true).processBatch(100); expect(await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.missionId, healthy.missionId))).toHaveLength(1);
    } finally { await first.pool.query('DROP TRIGGER test_poison ON player_mission_progress; DROP FUNCTION test_poison();'); }
  });
  it('interrupted worker transaction rolls back and can be retried after restart', async () => {
    const m = await mission(); const event = await source(m);
    await first.pool.query("CREATE FUNCTION test_worker_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(10); RETURN NEW; END $$; CREATE TRIGGER test_worker_delay BEFORE INSERT ON player_mission_progress FOR EACH ROW EXECUTE FUNCTION test_worker_delay();");
    try {
      const interrupted = engine().processBatch(100); const failure = expect(interrupted).rejects.toMatchObject({ code: 'MISSION_PROCESSOR_RETRY' });
      let pid: number | undefined;
      for (let i=0;i<100 && !pid;i++) { pid = (await second.pool.query("SELECT pid FROM pg_stat_activity WHERE application_name='circzles_m1_test_a' AND state='active' AND query LIKE 'insert into \"player_mission_progress\"%' LIMIT 1")).rows[0]?.pid; if (!pid) await new Promise(resolve => setTimeout(resolve, 20)); }
      expect(pid).toBeDefined(); await second.pool.query('SELECT pg_terminate_backend($1)', [pid]); await failure;
    } finally { await second.pool.query('DROP TRIGGER test_worker_delay ON player_mission_progress; DROP FUNCTION test_worker_delay();'); }
    expect(await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.missionId, m.missionId))).toHaveLength(0);
    await db.update(c.missionEventAttempts).set({ nextAttemptAt: origin }).where(eq(c.missionEventAttempts.gameEventId, event.gameEventId)); await engine(true).processBatch(100);
    expect((await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.missionId, m.missionId)))[0].currentCount).toBe(1);
  }, 20000);
});
