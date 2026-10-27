import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { createSyntheticPgliteTemplate } from "./helpers/syntheticPglite.js";

let fresh: Awaited<ReturnType<typeof createSyntheticPgliteTemplate>>;
const instances: Awaited<ReturnType<typeof fresh>>[] = [];
beforeAll(async () => {
  fresh = await createSyntheticPgliteTemplate(async database => {
    for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => file.endsWith(".sql")).sort()) {
      await database.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
    }
  });
}, 60_000);
afterAll(async () => { for (const database of instances) if (!database.closed) await database.close(); });
async function open() { const database = await fresh(); instances.push(database); return database; }

it("clones are in memory, independently writable in parallel and disposable without cleanup SQL", async () => {
  const [first, second] = await Promise.all([open(), open()]);
  for (const database of [first, second]) expect(database.dataDir === undefined || database.dataDir === "memory://").toBe(true);
  await Promise.all([first.exec("INSERT INTO users(verified_email) VALUES ('first@example.test')"), second.exec("INSERT INTO users(verified_email) VALUES ('second@example.test')")]);
  expect((await first.query("SELECT verified_email FROM users")).rows).toEqual([{ verified_email: "first@example.test" }]);
  expect((await second.query("SELECT verified_email FROM users")).rows).toEqual([{ verified_email: "second@example.test" }]);
  await first.close();
  const replacement = await open();
  expect((await replacement.query("SELECT * FROM users")).rows).toEqual([]);
  expect((await second.query("SELECT verified_email FROM users")).rows).toEqual([{ verified_email: "second@example.test" }]);
});

it("clones retain audit update/delete/truncate guards, foreign keys and action constraints", async () => {
  const database = await open();
  await database.exec(`
    INSERT INTO users(user_id) VALUES ('10000000-0000-4000-8000-000000000001');
    INSERT INTO admin_users(admin_user_id,user_id,role) VALUES ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','SUPER_ADMIN');
    INSERT INTO missions(mission_id,title,description,category,period_type,active) VALUES ('10000000-0000-4000-8000-000000000003','Synthetic audit','', 'DAILY','DAILY',false);
    INSERT INTO mission_admin_history(mission_id,actor_admin_user_id,action,"after") VALUES ('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','DRAFT_CREATED','{}');
  `);
  const before = (await database.query("SELECT * FROM mission_admin_history")).rows;
  for (const statement of ["UPDATE mission_admin_history SET occurred_at=now()", "DELETE FROM mission_admin_history", "TRUNCATE mission_admin_history", "TRUNCATE users, auth_challenges, auth_rate_limits, google_auth_states CASCADE"]) {
    await expect(database.exec(statement)).rejects.toThrow("Mission administrator history is append-only");
    expect((await database.query("SELECT * FROM mission_admin_history")).rows).toEqual(before);
  }
  for (const statement of ["DELETE FROM missions", "DELETE FROM admin_users"]) await expect(database.exec(statement)).rejects.toThrow(/foreign key constraint/);
  await expect(database.exec(`INSERT INTO mission_admin_history(mission_id,actor_admin_user_id,action,"after") VALUES ('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','FORGED_APPROVAL','{}')`)).rejects.toThrow(/check constraint/);
  await database.close();
  const replacement = await open();
  expect((await replacement.query("SELECT * FROM mission_admin_history")).rows).toEqual([]);
  await expect(replacement.exec("TRUNCATE users CASCADE")).rejects.toThrow("Mission administrator history is append-only");
});

it.each(["postgresql://not-a-test.example.invalid/live", "/persistent/database", { dataDir: "/persistent/database" }])("rejects a database target instead of an initializer: %j", async target => {
  await expect(createSyntheticPgliteTemplate(target as unknown as Parameters<typeof createSyntheticPgliteTemplate>[0])).rejects.toThrow("never a database target");
});
