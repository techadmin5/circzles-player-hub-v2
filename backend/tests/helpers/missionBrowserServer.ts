import { MissionChestService } from "../../src/domain/missionChests.js";
import { missionChestProductPolicy } from "../../src/config/missionChestProduct.js";
// Explicit local browser-QA entry point. Never imported by server.ts or package startup.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { createDb } from "../../src/db/client.js";
import * as s from "../../src/db/schema.js";
import { buildApp, type AppDeps } from "../../src/http/app.js";
import { IdentityService, DrizzleIdentityRepository } from "../../src/domain/identity.js";
import { AdminAuthorizationService, DrizzleAdminAuthorizationRepository } from "../../src/domain/adminAuth.js";
import { AdminMissionService } from "../../src/domain/adminMissions.js";
import { GameStateService, DrizzleGameStateRepository, debitPointsInTransaction } from "../../src/domain/gameState.js";
import { DrizzleMissionRepository, PlayerMissionService, MissionClaimService, DrizzleMissionClaimRepository } from "../../src/domain/missions.js";
import { PuzzleOwnershipService, DrizzlePuzzleRepository } from "../../src/domain/puzzles.js";
import { NativeAuthService } from "../../src/domain/nativeAuth.js";
import { DrizzleNativeAuthRepository } from "../../src/domain/nativeAuthRepository.js";
import { GoogleAuthService } from "../../src/domain/googleAuth.js";
import { hashPassword } from "../../src/domain/authSecurity.js";
import { PlayerProfileService } from "../../src/domain/playerProfile.js";
import { localMissionPostgresUrl } from "./localMissionPostgres.js";

const action = process.argv[2];
if (!["serve", "process", "spend", "chest-spend", "report", "chest-setup"].includes(action)) throw new Error("Use an explicit browser-QA action");
const target = localMissionPostgresUrl(process.env.MISSION_BROWSER_DATABASE_URL, process.env.MISSION_BROWSER_DATABASE_NAME, process.env.MISSIONS_POSTGRES_DISPOSABLE);
const directory = process.env.MISSION_BROWSER_ARTIFACT_DIRECTORY;
if (!directory || resolve(directory) !== `/home/techadmin/.local/share/circzles-postgres-tests/browser_${process.env.MISSION_BROWSER_DATABASE_NAME}`) throw new Error("An exact database-specific protected browser-QA directory is required");
const manifest = JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8")) as { database: string };
if (manifest.database !== process.env.MISSION_BROWSER_DATABASE_NAME) throw new Error("STOP: browser-QA manifest/database mismatch");
const connection = createDb(target.toString(), () => {}), db = connection.db;
const identity = (await connection.pool.query("SELECT current_database() AS database,current_user AS role,session_user AS session_role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::int AS version")).rows[0];
if (identity.database !== process.env.MISSION_BROWSER_DATABASE_NAME || identity.role !== "circzles_test" || identity.session_role !== "circzles_test" || identity.host !== "127.0.0.1" || identity.port !== 5432 || identity.version !== 180006) throw new Error("STOP: local PostgreSQL identity mismatch before writes");
const accountsPath = resolve(directory, "synthetic-accounts.json");
type Account = { email: string; password: string; playerId: string };
type Accounts = Record<"admin" | "player" | "capacity" | "other", Account>;
if (action !== "serve") {
  if ((await connection.pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count !== 36 || (await connection.pool.query("SELECT count(*)::int AS count FROM users WHERE verified_email NOT LIKE '%@test.invalid'")).rows[0].count !== 0) throw new Error("STOP: not a synthetic browser-QA database");
  const accounts = JSON.parse(await readFile(accountsPath, "utf8")) as Accounts;
  if(action === "chest-setup"){
    const [admin]=await db.select().from(s.adminUsers).innerJoin(s.players,eq(s.players.userId,s.adminUsers.userId)).where(eq(s.players.playerId,accounts.admin.playerId));
    if(!admin||admin.admin_users.role!=="SUPER_ADMIN")throw new Error("Synthetic administrator missing");
    if((await db.select().from(s.missions)).length)throw new Error("Chest setup runs once on a fresh synthetic browser database");
    const service=new AdminMissionService(db),actor=admin.admin_users.adminUserId;
    for(const category of ["DAILY","WEEKLY"] as const)for(let i=1;i<=(category==="DAILY"?5:6);i++){
      let m=await service.createDraft({title:`QA ${category} mission ${i}`,description:"Synthetic browser chest journey",category,displayOrder:i},actor);
      m=await service.updateRule(m.missionId,{eventType:"puzzle.added",targetCount:1,sourceType:"PUZZLE_CLAIM",puzzleId:null,levelId:null,conditions:{},active:true,expectedUpdatedAt:m.updatedAt},actor);
      m=await service.updateSchedule(m.missionId,{startsAt:null,endsAt:null,claimDeadline:null,expectedUpdatedAt:m.updatedAt},actor);
      m=await service.updateRewards(m.missionId,{xp:1,synapsePoints:null,expectedUpdatedAt:m.updatedAt},actor);
      for(const approval of ["PRODUCT","REWARD_BUDGET"] as const){const c=await service.approvalContract(m.missionId);await service.changeApproval(m.missionId,approval,{expectedUpdatedAt:c.binding.approvedConfigurationRevision,configurationDigest:c.binding.configurationDigest,expectedApprovalId:null,expectedRevocationId:null},actor);}
      const c=await service.approvalContract(m.missionId);await service.changeLifecycle(m.missionId,"ACTIVATE",{expectedUpdatedAt:c.binding.approvedConfigurationRevision,configurationDigest:c.binding.configurationDigest,idempotencyKey:crypto.randomUUID()},actor);
    }
    console.info("Eleven explicitly approved 1-XP synthetic missions configured through application services; chests remain uncreated");
  } else if (action === "process") {
    const processor = new DrizzleMissionRepository(db); let processed = 0;
    for (let n = 0; n < 20; n++) { const count = await processor.processBatch(100); processed += count; if (!count) break; }
    console.info(JSON.stringify({ processed }));
  } else if (action === "spend" || action === "chest-spend") {
    const [owner] = await db.select().from(s.players).innerJoin(s.users, eq(s.users.userId, s.players.userId)).where(eq(s.players.playerId, accounts.capacity.playerId));
    if (owner?.users.verifiedEmail !== accounts.capacity.email) throw new Error("STOP: synthetic capacity player mismatch");
    await db.transaction(tx => debitPointsInTransaction(tx, { playerId: accounts.capacity.playerId, amount: action === "chest-spend" ? missionChestProductPolicy.periods.DAILY.synapsePoints : 10, sourceType: "SYNTHETIC_BROWSER_QA", reason: "Explicit synthetic ledger-backed spend", idempotencyKey: action === "chest-spend" ? "browser-qa-chest-spend-once" : "browser-qa-spend-once" }));
    console.info("Synthetic ledger-backed spend recorded");
  } else {
    console.info(JSON.stringify({ identity, players: (await connection.pool.query("SELECT p.display_name,w.balance,x.total_xp,x.progression_level,(SELECT count(*) FROM mission_claims c WHERE c.player_id=p.player_id) AS claims,(SELECT count(*) FROM xp_transactions t WHERE t.player_id=p.player_id) AS xp_ledgers,(SELECT count(*) FROM point_transactions t WHERE t.player_id=p.player_id AND direction='CREDIT') AS sp_credits,(SELECT count(*) FROM point_transactions t WHERE t.player_id=p.player_id AND direction='DEBIT') AS sp_debits FROM players p JOIN wallets w USING(player_id) JOIN player_progression x USING(player_id) ORDER BY display_name")).rows, missions: (await connection.pool.query("SELECT title,active,(SELECT count(*) FROM mission_admin_history h WHERE h.mission_id=m.mission_id) AS audits FROM missions m")).rows, exceptions: (await connection.pool.query("SELECT action,count(*)::int FROM mission_capacity_events GROUP BY action ORDER BY action")).rows }));
  }
  await connection.pool.end();
} else {
  if ((await connection.pool.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema IN ('public','drizzle')")).rows[0].count !== 0) throw new Error("STOP: browser-QA requires a fresh empty database; never reset an existing database");
  const folder = fileURLToPath(new URL("../../drizzle/", import.meta.url));
  const journal = JSON.parse(await readFile(resolve(folder, "meta/_journal.json"), "utf8")) as { entries: { idx: number }[] };
  if (journal.entries.length !== 36 || journal.entries.at(-1)?.idx !== 35) throw new Error("STOP: only migrations 0000-0035 are authorized");
  await migrate(db, { migrationsFolder: folder });
  await db.insert(s.progressionLevels).values([{ progressionLevel: 1, rankName: "Synthetic", xpRequired: 0, rewards: [] }, { progressionLevel: 2, rankName: "Synthetic II", xpRequired: 5, rewards: [] }]);
  const state = new GameStateService(new DrizzleGameStateRepository(db));
  const accounts = {} as Accounts;
  for (const key of ["admin", "player", "capacity", "other"] as const) {
    const email = `browser-${key}@test.invalid`, password = randomBytes(24).toString("base64url");
    const [user] = await db.insert(s.users).values({ verifiedEmail: email, emailVerifiedAt: new Date() }).returning();
    const [player] = await db.insert(s.players).values({ userId: user.userId, displayName: `Synthetic ${key}` }).returning();
    await db.insert(s.passwordCredentials).values({ userId: user.userId, passwordHash: await hashPassword(password) });
    if (key === "admin") await db.insert(s.adminUsers).values({ userId: user.userId, role: "SUPER_ADMIN" });
    await state.ensurePlayerGameState(player.playerId);
    if (key === "capacity") await db.update(s.wallets).set({ balance: 2147483647 }).where(eq(s.wallets.playerId, player.playerId)); // Initial synthetic fixture, never recovery logic.
    accounts[key] = { email, password, playerId: player.playerId };
  }
  await writeFile(accountsPath, JSON.stringify(accounts), { mode: 0o600 });
  const puzzles = new PuzzleOwnershipService(new DrizzlePuzzleRepository(db));
  await puzzles.seedDevelopmentCatalog([{ designLegacyWixId: "BROWSER-QA-DESIGN", designName: "Synthetic browser CircZles", designDescription: "Local QA only", designArtwork: "/puzzles/placeholder.svg", puzzleLegacyWixId: "BROWSER-QA-PUZZLE", puzzleName: "Synthetic browser CircZles", runCode: "R1", pieceCount: 121, sizeLabel: "8", levelId: 1, image: "/puzzles/placeholder.svg", description: "Local synthetic puzzle", prefix: "QA-M1-R1" }]);
  function unused<K extends keyof AppDeps>(name: K): AppDeps[K] { return new Proxy({}, { get() { throw new Error(`Disabled browser-QA service: ${name}`); } }) as AppDeps[K]; }
  const sessionSecret = randomBytes(48).toString("base64url"), nativeRepo = new DrizzleNativeAuthRepository(db);
  const app = buildApp({ env: { NODE_ENV: "test", PORT: 4107, DATABASE_URL: target.toString(), FRONTEND_ORIGIN: "http://127.0.0.1:3107", SESSION_SECRET: sessionSecret, COOKIE_SECURE: false, SESSION_COOKIE_SAME_SITE: "lax", AUTH_SESSION_DIAGNOSTICS: false, MISSION_PROCESSOR_ENABLED: false, MISSION_CLAIMS_ENABLED: true, MISSION_PROCESSOR_INTERVAL_MS: 5000, MISSION_PROCESSOR_BATCH_SIZE: 50, BACKEND_SHUTDOWN_TIMEOUT_MS: 25000 },
    identity: new IdentityService(new DrizzleIdentityRepository(db), sessionSecret), gameState: state, puzzles,
    adminAuth: new AdminAuthorizationService(new DrizzleAdminAuthorizationRepository(db), sessionSecret), adminMissions: new AdminMissionService(db),
    missionChests: new MissionChestService(db), missions: new PlayerMissionService(new DrizzleMissionRepository(db)), missionClaims: new MissionClaimService(new DrizzleMissionClaimRepository(db)),
    nativeAuth: new NativeAuthService(nativeRepo, { send: async () => { throw new Error("Outgoing mail disabled in browser QA"); } }), googleAuth: new GoogleAuthService(nativeRepo, null),
    playerProfile: new PlayerProfileService(db, { upload: async () => { throw new Error("Cloudinary/avatar uploads disabled in browser QA"); } }),
    submissions: unused("submissions"), adminSubmissions: unused("adminSubmissions"), leaderboards: unused("leaderboards"), submissionReviews: unused("submissionReviews"), publicProfiles: unused("publicProfiles"), rewardCatalog: unused("rewardCatalog"), storePurchases: unused("storePurchases"), inventory: unused("inventory"), coupons: unused("coupons"), playerIdentityActions: unused("playerIdentityActions"), rewardWheel: unused("rewardWheel"), checkDb: async () => { await connection.pool.query("SELECT 1"); },
  });
  const close = async () => { await app.close(); await connection.pool.end(); };
  process.once("SIGTERM", () => { void close(); }); process.once("SIGINT", () => { void close(); });
  await app.listen({ host: "127.0.0.1", port: 4107 });
  console.info("LOCAL_BROWSER_QA_READY: loopback only, workers/integrations disabled, synthetic database migrated 0000-0035");
}
