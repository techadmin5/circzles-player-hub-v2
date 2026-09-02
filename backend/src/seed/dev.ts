import { loadEnv } from "../config/env.js";
import { createDb } from "../db/client.js";
import { DrizzleIdentityRepository, IdentityService } from "../domain/identity.js";

const env = loadEnv();

if (env.NODE_ENV === "production") {
  throw new Error("Refusing to run development seed in production.");
}

const { pool, db } = createDb(env.DATABASE_URL);
const identity = new IdentityService(new DrizzleIdentityRepository(db), env.SESSION_SECRET);

const account = await identity.findOrCreateWixIdentity({
  wixMemberId: "dev-wix-member-smokey",
  displayName: "Smokey_OP",
  publicPlayerId: "CZ-8F42KD",
});

console.log(`Seeded development player ${account.player.displayName} (${account.player.publicPlayerId})`);
await pool.end();
