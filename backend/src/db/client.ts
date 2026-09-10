import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

export type PoolErrorHandler = (error: Error) => void;

const defaultPoolErrorHandler: PoolErrorHandler = (error) => {
  console.error("Unexpected PostgreSQL idle client error; broken client removed from pool", error);
};

export function createPool(databaseUrl: string, onPoolError: PoolErrorHandler = defaultPoolErrorHandler) {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  });
  pool.on("error", onPoolError);
  return pool;
}

export function createDb(databaseUrl: string, onPoolError?: PoolErrorHandler) {
  const pool = createPool(databaseUrl, onPoolError);
  return { pool, db: drizzle(pool, { schema }) };
}

export type Database = ReturnType<typeof createDb>["db"];
