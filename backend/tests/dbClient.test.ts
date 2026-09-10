import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
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
