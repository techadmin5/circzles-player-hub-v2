import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

export function createPool(databaseUrl: string) {
  return new Pool({ connectionString: databaseUrl });
}

export function createDb(databaseUrl: string) {
  const pool = createPool(databaseUrl);
  return { pool, db: drizzle(pool, { schema }) };
}

export type Database = ReturnType<typeof createDb>["db"];
