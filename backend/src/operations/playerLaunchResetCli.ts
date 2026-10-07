import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import { assertLaunchPostflight, captureResetPreflight, resetTestPlayersAndMigrate, type ResetManifest } from "./playerLaunchReset.js";

// Deliberately no dotenv import, application startup hook, or npm migration hook.
async function main() {
  const [mode, manifestPath, ...flags] = process.argv.slice(2);
  if (!["preflight", "apply", "postflight"].includes(mode) || !manifestPath || !process.env.DATABASE_URL) throw new Error("Usage: explicitly set DATABASE_URL, then tsx src/operations/playerLaunchResetCli.ts preflight|apply|postflight /absolute/path/reviewed-manifest.json");
  if (mode === "apply" && !["--backup-confirmed", "--writes-paused", "--reviewed-test-identities"].every((flag) => flags.includes(flag))) throw new Error("Apply requires --backup-confirmed --writes-paused --reviewed-test-identities");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query("SET LOCAL statement_timeout='120s'");
    if (mode === "preflight") {
      const manifest = await captureResetPreflight(client);
      await client.query("ROLLBACK");
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      process.stdout.write("Preflight saved. Review exact identity/challenge allowlists, dependency counts and protected-table fingerprints before apply. No database changes.\n");
    } else {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ResetManifest;
      if (mode === "apply") {
        await resetTestPlayersAndMigrate(client, manifest);
        await client.query("COMMIT");
        process.stdout.write("Reviewed test identities reset; 0021 and journal committed atomically. Next player number is 1.\n");
      } else {
        await assertLaunchPostflight(client, manifest);
        await client.query("ROLLBACK");
        process.stdout.write("Launch postflight passed: empty player data, next number 1, unique IDs and protected data intact.\n");
      }
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); await pool.end(); }
}

main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Reset operation failed"}\n`); process.exitCode = 1; });
