import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Pool, PoolClient } from "pg";
import { createPool } from "../src/db/client.js";

const pools: Pool[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

describe("PostgreSQL pool error handling", () => {
  it("handles an idle client error without an uncaught EventEmitter error", () => {
    const onPoolError = vi.fn();
    const pool = createPool("postgresql://localhost/test", onPoolError);
    pools.push(pool);
    const error = new Error("Connection terminated unexpectedly");

    expect(pool.listenerCount("error")).toBe(1);
    expect(() => pool.emit("error", error)).not.toThrow();
    expect(onPoolError).toHaveBeenCalledOnce();
    expect(onPoolError).toHaveBeenCalledWith(error);
  });

  it("handles a checked-out client error while preserving the query rejection path", async () => {
    const onPoolError = vi.fn();
    const pool = createPool("postgresql://localhost/test", onPoolError);
    pools.push(pool);
    const client = new EventEmitter() as PoolClient;
    const connectionError = new Error("Connection terminated unexpectedly");

    pool.emit("connect", client);
    pool.emit("acquire", client);

    expect(() => client.emit("error", connectionError)).not.toThrow();
    expect(onPoolError).toHaveBeenCalledOnce();
    expect(onPoolError).toHaveBeenCalledWith(connectionError);

    const query = Promise.reject(connectionError);
    await expect(query).rejects.toBe(connectionError);
  });

  it("leaves released client errors to the pool-level idle handler", () => {
    const onPoolError = vi.fn();
    const pool = createPool("postgresql://localhost/test", onPoolError);
    pools.push(pool);
    const client = new EventEmitter() as PoolClient;

    pool.emit("connect", client);
    pool.emit("acquire", client);
    pool.emit("release", undefined, client);
    client.emit("error", new Error("idle disconnect"));

    expect(onPoolError).not.toHaveBeenCalled();
  });

  it("does not convert an active query rejection into a pool error", async () => {
    const onPoolError = vi.fn();
    const pool = createPool("postgresql://localhost/test", onPoolError);
    pools.push(pool);
    const queryError = new Error("active query failed");
    pool.query = vi.fn().mockRejectedValue(queryError) as typeof pool.query;

    await expect(pool.query("select 1")).rejects.toBe(queryError);
    expect(onPoolError).not.toHaveBeenCalled();
  });
});
