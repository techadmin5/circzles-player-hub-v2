import { drizzle } from "drizzle-orm/node-postgres";
import pg, { type PoolClient } from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

export type PoolErrorHandler = (error: Error) => void;

const defaultPoolErrorHandler: PoolErrorHandler = (error) => {
  console.error("Unexpected PostgreSQL client error; broken client removed from pool", error);
};

function attachClientErrorHandling(pool: pg.Pool, onPoolError: PoolErrorHandler) {
  const activeClients = new WeakSet<PoolClient>();

  // pg-pool removes its idle error listener while a client is checked out.
  // Drizzle transactions use that client directly, so retain a safety listener.
  pool.on("connect", (client) => {
    client.on("error", (error) => {
      if (activeClients.has(client)) {
        onPoolError(error);
      }
    });
  });
  pool.on("acquire", (client) => activeClients.add(client));
  pool.on("release", (_error, client) => activeClients.delete(client));
}

export function createPool(databaseUrl: string, onPoolError: PoolErrorHandler = defaultPoolErrorHandler) {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  });
  pool.on("error", onPoolError);
  attachClientErrorHandling(pool, onPoolError);
  return pool;
}

export function createDb(databaseUrl: string, onPoolError?: PoolErrorHandler) {
  const pool = createPool(databaseUrl, onPoolError);
  return { pool, db: drizzle(pool, { schema }) };
}

export type Database = ReturnType<typeof createDb>["db"];
