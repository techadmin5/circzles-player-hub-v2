import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { registerCatalogRoutes } from "../src/http/catalogRoutes.js";
import type { Env } from "../src/config/env.js";
import type { CatalogService } from "../src/domain/catalog.js";
import type { AdminAuthorizationService } from "../src/domain/adminAuth.js";

// Test HTTP transport independently; catalog.test.ts covers real transactional writes.
describe("bounded catalog import transport", () => {
  async function setup() {
    const app = Fastify(); await app.register(cookie);
    const requirePermission = vi.fn().mockResolvedValue({});
    const importRows = vi.fn().mockResolvedValue({ ready: true, applied: false, errors: [] });
    registerCatalogRoutes(app, { env: { NODE_ENV: "test", FRONTEND_ORIGIN: "https://hub.example.test" } as Env, adminAuth: { requirePermission } as unknown as AdminAuthorizationService, catalog: { import: importRows } as unknown as CatalogService });
    await app.ready(); return { app, requirePermission, importRows };
  }
  it.each(["preview", "apply"])("admits a 5000-row %s request larger than the default body limit through existing authorization", async action => {
    const { app, requirePermission, importRows } = await setup();
    const rows = Array.from({ length: 5000 }, (_, i) => ({ sourceId: `${i}-R4`, name: "Puzzle ".repeat(25), size: "12", brand: "CircZles", numberIdentifier: String(i), manufacturingCode: "R4", level: "01", units: "500", firstFullSku: `CC-${i}-R4-01-0001`, productType: "CIRCZLES" }));
    const manifest = { datasetId: "transport-only", rows, mappings: Object.fromEntries(rows.map(row => [row.sourceId, { newVariantKey: row.sourceId }])) };
    expect(Buffer.byteLength(JSON.stringify(manifest))).toBeGreaterThan(1024 * 1024);
    try {
      const result = await app.inject({ method: "POST", url: "/api/admin/catalog/import/" + action, payload: manifest });
      expect(result.statusCode).toBe(200); expect(result.headers["cache-control"]).toBe("private, no-store");
      expect(requirePermission).toHaveBeenCalledWith(undefined, "CATALOG_MANAGE");
      expect(importRows).toHaveBeenCalledWith(manifest, ...(action === "apply" ? [true] : []));
    } finally { await app.close(); }
  });
  it("still bounds import bodies and retains the smaller limit on unrelated catalog writes", async () => {
    const { app, importRows } = await setup();
    try {
      for (const [url, size] of [["/api/admin/catalog/import/preview", 16 * 1024 * 1024], ["/api/admin/catalog", 1024 * 1024]] as const) {
        const result = await app.inject({ method: "POST", url, payload: JSON.stringify({ padding: "x".repeat(size) }), headers: { "content-type": "application/json" } });
        expect(result.statusCode).toBe(413);
      }
      expect(importRows).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it.each(["/api/admin/catalog/designs", "/api/admin/catalog/design-aliases", "/api/admin/catalog/import/propose"])("requires catalog authorization for identity endpoint %s", async url => {
    const app = Fastify(); await app.register(cookie);
    const requirePermission = vi.fn().mockRejectedValue(Object.assign(new Error("Admin permission required"), { statusCode: 403 }));
    const action = vi.fn();
    registerCatalogRoutes(app, { env: { NODE_ENV: "test", FRONTEND_ORIGIN: "https://hub.example.test" } as Env, adminAuth: { requirePermission } as unknown as AdminAuthorizationService, catalog: { designs: action, confirmAlias: action, propose: action } as unknown as CatalogService });
    try {
      const result = await app.inject({ method: url.endsWith("/designs") ? "GET" : "POST", url, ...(url.endsWith("/designs") ? {} : { payload: {} }) });
      expect(result.statusCode).toBe(403); expect(requirePermission).toHaveBeenCalledWith(undefined, "CATALOG_MANAGE"); expect(action).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
