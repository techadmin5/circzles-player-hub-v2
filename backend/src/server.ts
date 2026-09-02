import { loadEnv } from "./config/env.js";
import { createDb } from "./db/client.js";
import { DrizzleIdentityRepository, IdentityService } from "./domain/identity.js";
import { buildApp } from "./http/app.js";

const env = loadEnv();
const { pool, db } = createDb(env.DATABASE_URL);
const identity = new IdentityService(new DrizzleIdentityRepository(db), env.SESSION_SECRET);
const app = buildApp({
  env,
  identity,
  checkDb: async () => {
    await pool.query("select 1");
  },
});

const address = await app.listen({ port: env.PORT, host: "0.0.0.0" });
app.log.info({ address }, "CircZles backend started");

process.on("SIGINT", async () => {
  await app.close();
  await pool.end();
  process.exit(0);
});
