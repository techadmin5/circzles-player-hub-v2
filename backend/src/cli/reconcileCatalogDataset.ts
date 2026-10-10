// Operator-only; no dotenv, startup hook, migration or implicit apply.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createDb } from "../db/client.js";
import { CatalogDatasetRepair } from "../domain/catalogDatasetRepair.js";

export function repairArguments(args: string[]) {
  if (args[0] !== "--plan" || !args[1] || (args.length !== 2 && !(args.length === 5 && args[2] === "--apply" && args[3] === "--expected-preview" && /^[a-f0-9]{64}$/.test(args[4])))) throw new Error("Usage: REPAIR_DATABASE_URL=<operator connection> tsx src/cli/reconcileCatalogDataset.ts --plan <verified.json> [--apply --expected-preview <sha256>]");
  return { path: args[1], apply: args.length === 5, expectedPreview: args[4] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let pool: ReturnType<typeof createDb>["pool"] | undefined;
  try {
    const args = repairArguments(process.argv.slice(2));
    if (!process.env.REPAIR_DATABASE_URL) throw new Error("An explicit operator REPAIR_DATABASE_URL is required; DATABASE_URL is deliberately not used.");
    const connection = createDb(process.env.REPAIR_DATABASE_URL); pool = connection.pool;
    console.info(JSON.stringify(await new CatalogDatasetRepair(connection.db).reconcile(JSON.parse(await readFile(args.path, "utf8")), args), null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : "Catalog repair failed."); process.exitCode = 1; }
  finally { await pool?.end(); }
}
