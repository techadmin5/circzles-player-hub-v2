import { expect } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { mkdtemp,mkdir,readFile,writeFile,copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { createDb } from "../../src/db/client.js";
import * as s from "../../src/db/schema.js";

// Called only AFTER the enclosing suite verifies a new, empty literal-loopback
// PostgreSQL database. No target selection, dotenv, reset, deletion or worker.
export async function verifyMissionsReleaseUpgrade(connection:ReturnType<typeof createDb>,folder:string){
 const db=connection.db,journal=JSON.parse(await readFile(resolve(folder,"meta/_journal.json"),"utf8")) as {entries:{idx:number;tag:string}[]};
 if(journal.entries.length!==36||journal.entries.at(-1)?.idx!==35)throw new Error("Release verification permits exactly migrations 0000-0035");
 async function copyMigrations(baseline:boolean,fault=false){
  const dir=await mkdtemp(resolve(tmpdir(),"circzles-release-migrations-"));await mkdir(resolve(dir,"meta"));
  const entries=baseline?journal.entries.slice(0,26):journal.entries;
  await writeFile(resolve(dir,"meta/_journal.json"),JSON.stringify({...journal,entries}));
  for(const e of entries)await copyFile(resolve(folder,`${e.tag}.sql`),resolve(dir,`${e.tag}.sql`));
  if(fault){const path=resolve(dir,"0035_chest_capacity_recovery.sql");await writeFile(path,(await readFile(path,"utf8"))+"\n--> statement-breakpoint\nSELECT 1/0;\n");}
  return dir; // Owned synthetic evidence intentionally retained, not reset.
 }
 await migrate(db,{migrationsFolder:await copyMigrations(true)});
 expect((await connection.pool.query("SELECT count(*)::int n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(26);
 const [user]=await db.insert(s.users).values({verifiedEmail:"release-preservation@test.invalid",emailVerifiedAt:new Date()}).returning();
 const [player]=await db.insert(s.players).values({userId:user.userId,displayName:"Synthetic protected benchmark"}).returning();
 const [admin]=await db.insert(s.adminUsers).values({userId:user.userId,role:"SUPER_ADMIN"}).returning();
 await db.insert(s.progressionLevels).values({progressionLevel:1,rankName:"Synthetic",xpRequired:0,rewards:[]});
 await db.insert(s.wallets).values({playerId:player.playerId,balance:100});
 await db.insert(s.playerProgression).values({playerId:player.playerId,totalXp:50,progressionLevel:1,rankName:"Synthetic"});
 const [points]=await db.insert(s.pointTransactions).values({playerId:player.playerId,amount:100,direction:"CREDIT",reason:"Synthetic pre-upgrade preservation fixture",sourceType:"SYNTHETIC_PRESERVATION",balanceAfter:100,idempotencyKey:"preservation-sp"}).returning();
 const [xp]=await db.insert(s.xpTransactions).values({playerId:player.playerId,amount:50,reason:"Synthetic pre-upgrade preservation fixture",sourceType:"SYNTHETIC_PRESERVATION",totalXpAfter:50,idempotencyKey:"preservation-xp"}).returning();
 const [design]=await db.insert(s.puzzleDesigns).values({name:"Synthetic Lion preservation fixture"}).returning();
 const [puzzle]=await db.insert(s.puzzles).values({puzzleDesignId:design.puzzleDesignId,name:"Synthetic Lion",levelId:1,sizeLabel:"12",pieceCount:121}).returning();
 const [prefix]=await db.insert(s.puzzleClaimPrefixes).values({puzzleId:puzzle.puzzleId,prefix:"QA-PRESERVE-R1",normalizedPrefix:"QA-PRESERVE-R1"}).returning();
 const [claim]=await db.insert(s.puzzleClaims).values({puzzleClaimPrefixId:prefix.puzzleClaimPrefixId,puzzleId:puzzle.puzzleId,playerId:player.playerId,serialNumber:1n,normalizedCode:"QA-PRESERVE-R1-0001"}).returning();
 const [owned]=await db.insert(s.playerPuzzles).values({playerId:player.playerId,puzzleId:puzzle.puzzleId,puzzleClaimId:claim.puzzleClaimId}).returning();
 const [video]=await db.insert(s.videoUploads).values({playerId:player.playerId,storageProvider:"LOCAL_SYNTHETIC",publicId:crypto.randomUUID(),mimeType:"video/mp4",declaredSizeBytes:1,verifiedSizeBytes:1,durationMs:195000,status:"COMPLETE",expiresAt:new Date("2099-01-01Z")}).returning();
 const [submission]=await db.insert(s.submissions).values({playerId:player.playerId,playerPuzzleId:owned.playerPuzzleId,puzzleId:puzzle.puzzleId,levelId:1,completionTimeMs:195000,videoUploadId:video.videoUploadId,status:"APPROVED"}).returning();
 await db.insert(s.submissionReviews).values({submissionId:submission.submissionId,reviewerAdminUserId:admin.adminUserId,decision:"APPROVED",idempotencyKey:crypto.randomUUID()});
 await db.insert(s.submissionRewardGrants).values({playerId:player.playerId,puzzleId:puzzle.puzzleId,submissionId:submission.submissionId,rewardEnabledSnapshot:true,xpReward:50,synapseReward:100,pointTransactionId:points.transactionId,xpTransactionId:xp.xpTransactionId});
 await db.insert(s.leaderboardEntries).values({playerId:player.playerId,puzzleId:puzzle.puzzleId,bestSubmissionId:submission.submissionId,bestCompletionTimeMs:195000,bestApprovedAt:new Date(),bestSubmittedAt:new Date()});
 // Latest ORM mission inserts include post-0025 columns, so seed the baseline
 // contract explicitly. No historical snapshot or payout is fabricated.
 const legacy=(await connection.pool.query("INSERT INTO missions(title,description,category,period_type,active) VALUES('Synthetic inactive legacy mission','','DAILY','DAILY',false) RETURNING mission_id")).rows[0].mission_id;
 await connection.pool.query("INSERT INTO player_mission_progress(player_id,mission_id,period_key,status,current_count,target_count_snapshot,completed_at) VALUES($1,$2,'2020-02-10','CLAIMABLE',1,1,'2020-02-10T12:00:00Z')",[player.playerId,legacy]);
 const tables=["users","players","admin_users","wallets","player_progression","point_transactions","xp_transactions","puzzles","puzzle_claim_prefixes","puzzle_claims","player_puzzles","video_uploads","submissions","submission_reviews","submission_reward_grants","leaderboard_entries"];
 async function preserved(){const out:Record<string,unknown>={};for(const table of tables)out[table]=(await connection.pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) data FROM ${table} t`)).rows[0].data;return out;}
 const before=await preserved();
 await expect(migrate(db,{migrationsFolder:await copyMigrations(false,true)})).rejects.toThrow();
 expect((await connection.pool.query("SELECT count(*)::int n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(26);
 expect((await connection.pool.query("SELECT to_regclass('public.mission_chests') AS name")).rows[0].name).toBeNull();expect(await preserved()).toEqual(before);
 await migrate(db,{migrationsFolder:folder});expect(await preserved()).toEqual(before);
 const rows=(await connection.pool.query("SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at")).rows;
 const expected=readMigrationFiles({migrationsFolder:folder});expect(rows.map(r=>({hash:r.hash,at:Number(r.created_at)}))).toEqual(expected.map(r=>({hash:r.hash,at:r.folderMillis})));
 const old=(await connection.pool.query("SELECT active,reward_snapshot FROM missions m JOIN player_mission_progress p USING(mission_id) WHERE mission_id=$1",[legacy])).rows[0];expect(old).toEqual({active:false,reward_snapshot:null});
 console.info("RELEASE_UPGRADE_EVIDENCE",JSON.stringify({baseline:26,final:rows.length,preservedTables:tables.length,syntheticBenchmarkMs:195000,failedPendingBatchRolledBack:true}));
}
