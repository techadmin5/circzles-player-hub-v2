import { afterAll, beforeAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile, readdir } from "node:fs/promises";
import * as s from "../src/db/schema.js";
import type { Database } from "../src/db/client.js";
import { MissionProcessorRunner } from "../src/domain/missionProcessorRunner.js";
import { DrizzleMissionRepository } from "../src/domain/missions.js";

let pg: PGlite, db: Database;
beforeAll(async () => {
  pg = new PGlite();
  for (const name of (await readdir(new URL("../drizzle/", import.meta.url))).filter(name => name.endsWith(".sql") && name.slice(0,4) <= "0025").sort()) await pg.exec((await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  db = drizzle(pg, { schema: s }) as unknown as Database;
}, 60000);
afterAll(async () => { await pg.close(); });
it("controls-only build and disabled worker require no 0026 schema", async () => {
  expect((await pg.query("SELECT column_name FROM information_schema.columns WHERE table_name='missions' AND column_name='activation_effective_at'")).rows).toHaveLength(0);
  const runner = new MissionProcessorRunner({ processBatch: () => { throw new Error("disabled worker touched database"); } }, 1000, 50, () => {}, false);
  runner.start(); expect(await runner.tick()).toBe(false); await runner.stop();
  // The shared runner remains independent from whichever domain engine is deployed.
  // M1 engine reads need 0026 after rollout; do not invoke that engine in this fixture.
  expect(runner.getState().status).toBe("stopped");
  if (!("activationEffectiveAt" in s.missions)) expect(await new DrizzleMissionRepository(db).listForPlayer(crypto.randomUUID(), new Date())).toEqual([]);
});
