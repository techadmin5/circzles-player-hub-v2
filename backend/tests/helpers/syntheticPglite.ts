import { PGlite } from "@electric-sql/pglite";

// Test-only factory. No URL, connection, data-directory or existing database is
// accepted: both the template and every clone are owned in-memory instances.
// Reset means disposing of a clone, never running destructive cleanup SQL.
export async function createSyntheticPgliteTemplate(initialize: (database: PGlite) => Promise<void>) {
  if (typeof initialize !== "function") throw new TypeError("Synthetic database initialization requires a callback, never a database target.");
  const template = new PGlite();
  let snapshot: Blob;
  try {
    await template.waitReady;
    await initialize(template);
    snapshot = await template.dumpDataDir();
  } finally {
    await template.close();
  }
  return async () => {
    const database = new PGlite({ loadDataDir: snapshot });
    try {
      await database.waitReady;
      return database;
    } catch (error) {
      await database.close();
      throw error;
    }
  };
}
