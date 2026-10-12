import { and, eq, lt, sql } from "drizzle-orm";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Database } from "../db/client.js";
import type { VideoStorage } from "../storage/videoStorage.js";
import { videoUploads, submissions } from "../db/schema.js";
import { DrizzleSubmissionRepository } from "../domain/submissions.js";
// Explicit operational task, never run at startup. Dry run unless --apply is supplied.
export async function cleanupAbandonedVideos(db: Database, storage: VideoStorage, apply = false, now = new Date()) {
  const expiredBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const candidates = await db.select().from(videoUploads).where(and(eq(videoUploads.storageProvider, "CLOUDINARY"), lt(videoUploads.expiresAt, expiredBefore), sql`coalesce(${videoUploads.failureCode}, '') <> 'ABANDONED_REMOVED'`, sql`NOT EXISTS (SELECT 1 FROM ${submissions} WHERE ${submissions.videoUploadId} = ${videoUploads.videoUploadId})`)).limit(100);
  const owned = candidates.filter(row => row.publicId.startsWith(`circzles/submissions/${row.playerId}/`));
  let removed = 0;
  if (apply) {
    const repo = new DrizzleSubmissionRepository(db, storage);
    // abandon rechecks association under the submission/catalog lock for every asset.
    for (const row of owned) { await repo.abandonVideoUpload(row.playerId, row.videoUploadId); removed++; }
  }
  return { candidates: owned.length, removed, applied: apply };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { loadEnv } = await import("../config/env.js");
  const { createDb } = await import("../db/client.js");
  const { CloudinaryVideoStorage } = await import("../storage/videoStorage.js");
  const env = loadEnv(), { db, pool } = createDb(env.DATABASE_URL);
  try { console.log(JSON.stringify(await cleanupAbandonedVideos(db, new CloudinaryVideoStorage({ cloudName: env.CLOUDINARY_CLOUD_NAME, apiKey: env.CLOUDINARY_API_KEY, apiSecret: env.CLOUDINARY_API_SECRET }), process.argv.includes("--apply")))); }
  finally { await pool.end(); }
}
