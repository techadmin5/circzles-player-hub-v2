import { MissionCapacityService } from "../src/domain/missionCapacityExceptions.js";
import { missionCapacityExceptions } from "../src/db/missionAdminSchema.js";
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
import { localMissionPostgresUrl } from "./helpers/localMissionPostgres.js";

// NEVER falls back to DATABASE_URL or loads production .env credentials.
const url = process.env.MISSIONS_TEST_DATABASE_URL;
function guardedUrl() {
  return localMissionPostgresUrl(url, process.env.MISSIONS_TEST_DATABASE_NAME, process.env.MISSIONS_POSTGRES_DISPOSABLE);
}
describe.skipIf(!url)("isolated PostgreSQL 18 multi-connection mission verification", () => {
  let first: ReturnType<typeof createDb>, second: ReturnType<typeof createDb>, db: Database, playerId: string, migrated = false;
  const folder = fileURLToPath(new URL('../drizzle/', import.meta.url));
  const origin = new Date('2025-01-01Z'), now = new Date('2026-01-01T12:00:00Z');
  const rewards = freezeRewards([{ rewardType: 'XP', amount: 20 }, { rewardType: 'SYNAPSE_POINTS', amount: 25 }]);
  beforeAll(async () => {
    const target = guardedUrl(); target.searchParams.set('application_name', 'circzles_m1_test_a'); first = createDb(target.toString(), () => {});
    target.searchParams.set('application_name', 'circzles_m1_test_b'); second = createDb(target.toString(), () => {}); db = first.db;
    for (const connection of [first, second]) {
      const identity = (await connection.pool.query("SELECT current_database() AS database, current_user AS role, session_user AS session_role, host(inet_server_addr()) AS address, inet_server_port() AS port, current_setting('server_version_num')::int AS version")).rows[0];
      if (identity.database !== process.env.MISSIONS_TEST_DATABASE_NAME || identity.role !== 'circzles_test' || identity.session_role !== 'circzles_test' || identity.address !== '127.0.0.1' || identity.port !== 5432 || identity.version !== 180006) throw new Error('Connected identity must match the exact disposable database, role and loopback PostgreSQL 18.6 server before any writes.');
    }
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
    const expectedMigrationCount = (JSON.parse(await readFile(resolve(folder, 'meta/_journal.json'), 'utf8')) as { entries: unknown[] }).entries.length;
    expect((await first.pool.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).rows[0].count).toBe(expectedMigrationCount);
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
      for (let i=0;i<100 && !pid;i++) { pid = (await second.pool.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND application_name='circzles_m1_test_a' AND state='active' AND query LIKE 'insert into \"player_mission_progress\"%' LIMIT 1")).rows[0]?.pid; if (!pid) await new Promise(resolve => setTimeout(resolve, 20)); }
      expect(pid).toBeDefined(); await second.pool.query('SELECT pg_terminate_backend($1)', [pid]); await failure;
    } finally { await second.pool.query('DROP TRIGGER test_worker_delay ON player_mission_progress; DROP FUNCTION test_worker_delay();'); }
    expect(await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.missionId, m.missionId))).toHaveLength(0);
    await db.update(c.missionEventAttempts).set({ nextAttemptAt: origin }).where(eq(c.missionEventAttempts.gameEventId, event.gameEventId)); await engine(true).processBatch(100);
    expect((await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.missionId, m.missionId)))[0].currentCount).toBe(1);
  }, 20000);

  // Reward fixtures are earned snapshots on inactive synthetic definitions.
  // No application server, worker timer, external identity or payout is involved.
  const spMaximum = 2147483647, xpMaximum = Number.MAX_SAFE_INTEGER;
  async function balances(sp: number, xp: number) {
    await db.insert(s.wallets).values({ playerId, balance: sp });
    await db.insert(s.playerProgression).values({ playerId, totalXp: xp, progressionLevel: 1, rankName: 'Test' });
  }
  async function earned(xp: number, sp: number) {
    const [definition] = await db.insert(s.missions).values({ title: 'Synthetic boundary', description: '', category: 'DAILY', periodType: 'DAILY', active: false }).returning();
    const snapshot = freezeRewards([...(xp ? [{ rewardType: 'XP', amount: xp }] : []), ...(sp ? [{ rewardType: 'SYNAPSE_POINTS', amount: sp }] : [])]);
    await db.insert(s.playerMissionProgress).values({ playerId, missionId: definition.missionId, periodKey: '2026-01-01', targetCountSnapshot: 1, currentCount: 1, status: 'CLAIMABLE', rewardSnapshot: snapshot, completedAt: now, claimDeadline: new Date('2026-01-03Z') });
    return definition;
  }
  async function boundaryState() {
    return Promise.all([
      first.pool.query('SELECT balance,updated_at FROM wallets WHERE player_id=$1', [playerId]).then(result => result.rows),
      first.pool.query('SELECT total_xp::text,progression_level,rank_name,updated_at FROM player_progression WHERE player_id=$1', [playerId]).then(result => result.rows),
      ...[s.pointTransactions, s.xpTransactions, s.gameEvents, s.playerMissionProgress, s.missionClaims].map(table => db.select().from(table).where(eq(table.playerId, playerId))),
    ]);
  }
  // Hold the wallet until both independent claim transactions demonstrably wait
  // on PostgreSQL locks. Promise.all alone would not establish lock contention.
  async function contested(a: () => Promise<unknown>, b: () => Promise<unknown>) {
    const blocker = await first.pool.connect();
    let outcomes: Promise<PromiseSettledResult<unknown>[]> | undefined, waiting = 0;
    try {
      await blocker.query('BEGIN');
      const blockerPid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await blocker.query('SELECT wallet_id FROM wallets WHERE player_id=$1 FOR UPDATE', [playerId]);
      outcomes = Promise.allSettled([a(), b()]);
      for (let attempt = 0; attempt < 150 && waiting < 2; attempt++) {
        waiting = (await second.pool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND application_name IN ('circzles_m1_test_a','circzles_m1_test_b') AND pid<>$1 AND wait_event_type='Lock'", [blockerPid])).rows[0].count;
        if (waiting < 2) await new Promise(resolve => setTimeout(resolve, 20));
      }
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
    const result = await outcomes!;
    expect(waiting).toBe(2);
    return result;
  }
  it.each(['SP', 'XP'])('accepts an exact %s boundary snapshot, replays once and rejects one additional unit atomically', async currency => {
    await balances(currency === 'SP' ? spMaximum - 1 : 0, currency === 'XP' ? xpMaximum - 1 : 0);
    const definition = await earned(1, 1), key = crypto.randomUUID();
    const firstClaim = await claim(definition.missionId, key);
    expect(firstClaim.awarded).toMatchObject({ xp: 1, synapsePoints: 1 });
    const after = await boundaryState();
    expect((await claim(definition.missionId, key, true)).missionClaimId).toBe(firstClaim.missionClaimId);
    expect(await boundaryState()).toEqual(after);
    const next = await earned(1, 1), before = await boundaryState();
    await expect(claim(next.missionId, crypto.randomUUID(), true)).rejects.toMatchObject({ code: 'MISSION_CAPACITY_PENDING' });
    expect(await boundaryState()).toEqual(before); await ledgers(1);
    const totals = (await first.pool.query('SELECT w.balance,p.total_xp::text AS xp FROM wallets w JOIN player_progression p USING(player_id) WHERE w.player_id=$1', [playerId])).rows[0];
    expect(currency === 'SP' ? totals.balance : totals.xp).toBe(currency === 'SP' ? spMaximum : String(xpMaximum));
  });
  it.each(['SP', 'XP'])('serializes competing %s boundary claims over real locks with no partial or duplicate awards', async currency => {
    await balances(currency === 'SP' ? spMaximum - 1 : 0, currency === 'XP' ? xpMaximum - 1 : 0);
    const [one, two] = await Promise.all([earned(1, 1), earned(1, 1)]);
    const result = await contested(() => claim(one.missionId, crypto.randomUUID()), () => claim(two.missionId, crypto.randomUUID(), true));
    expect(result.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(result.find(row => row.status === 'rejected')).toMatchObject({ reason: { code: 'MISSION_CAPACITY_PENDING' } });
    await ledgers(1);
    expect(await db.select().from(s.missionClaims).where(eq(s.missionClaims.playerId, playerId))).toHaveLength(1);
    expect((await db.select().from(s.playerMissionProgress).where(eq(s.playerMissionProgress.playerId, playerId))).map(row => row.status).sort()).toEqual(['CLAIMABLE', 'CLAIMED']);
  });
  it('concurrent duplicate frozen claims at both ceilings return one receipt without duplicate idempotency grants', async () => {
    await balances(spMaximum - 1, xpMaximum - 1);
    const definition = await earned(1, 1), key = crypto.randomUUID();
    // Same progress row serializes the second caller before it reaches the wallet.
    const results = await Promise.all([claim(definition.missionId, key), claim(definition.missionId, key, true)]);
    expect(results[0].missionClaimId).toBe(results[1].missionClaimId);
    expect(results.filter(row => row.idempotent)).toHaveLength(1); await ledgers(1);
  });
  it('XP failure rolls back preceding SP writes and requires exact SUPER_ADMIN recovery', async () => {
    await balances(0, xpMaximum);
    const definition = await earned(1, 1), key = crypto.randomUUID(), before = await boundaryState();
    await expect(claim(definition.missionId, key, true)).rejects.toMatchObject({ code: 'MISSION_CAPACITY_PENDING' });
    expect(await boundaryState()).toEqual(before); await ledgers(0);
    await db.update(s.playerProgression).set({ totalXp: xpMaximum - 1 }).where(eq(s.playerProgression.playerId, playerId)); // Synthetic capacity only.
    await db.insert(s.missionRewards).values({ missionId: definition.missionId, rewardType: 'XP', amount: 999 });
    const [user] = await db.insert(s.users).values({verifiedEmail:crypto.randomUUID()+"@test.invalid"}).returning();
    const [admin] = await db.insert(s.adminUsers).values({userId:user.userId,role:"SUPER_ADMIN"}).returning();
    const [exception] = await db.select().from(missionCapacityExceptions).where(eq(missionCapacityExceptions.playerId,playerId));
    const capacity = new MissionCapacityService(db), row = await capacity.detail(exception.exceptionId,admin.adminUserId);
    await capacity.recover(exception.exceptionId,{expectedEventId:row.revision,digest:row.digest,reason:"Synthetic exact recovery",idempotencyKey:crypto.randomUUID()},admin.adminUserId);
    expect((await claim(definition.missionId, key, true)).awarded).toMatchObject({ xp: 1, synapsePoints: 1 });
    await ledgers(1);
  });
  it.each(['9007199254740992', '9007199254740993', '9223372036854775807'])('rejects unsafe stored XP %s exactly without rounding, SP leakage or snapshot changes', async total => {
    await balances(0, 0); await first.pool.query('UPDATE player_progression SET total_xp=$1::bigint WHERE player_id=$2', [total, playerId]);
    const definition = await earned(1, 1), before = await boundaryState();
    await expect(claim(definition.missionId, crypto.randomUUID(), true)).rejects.toMatchObject({ code: 'XP_TOTAL_UNSAFE' });
    expect(await boundaryState()).toEqual(before); await ledgers(0);
    expect((await first.pool.query('SELECT total_xp::text AS xp FROM player_progression WHERE player_id=$1', [playerId])).rows[0].xp).toBe(total);
  });
});
