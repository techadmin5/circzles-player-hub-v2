import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Env } from "../config/env.js";
import type { AdminAuthorizationService } from "../domain/adminAuth.js";
import { CatalogService, catalogJson } from "../domain/catalog.js";
import { AppError, validationFailed } from "../domain/errors.js";
import { constantTimeEqual, SESSION_COOKIE_NAME } from "../domain/sessions.js";

export function registerCatalogRoutes(app: FastifyInstance, deps: { env: Env; adminAuth: AdminAuthorizationService; catalog: CatalogService }) {
  app.register(async scope => {
    scope.addHook("preHandler", async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      await deps.adminAuth.requirePermission(request.cookies[SESSION_COOKIE_NAME], "CATALOG_MANAGE");
      const proxy = request.headers["x-player-hub-proxy-secret"];
      if (deps.env.NODE_ENV === "production" && (!deps.env.PLAYER_HUB_PROXY_SECRET || typeof proxy !== "string" || !constantTimeEqual(proxy, deps.env.PLAYER_HUB_PROXY_SECRET))) throw new AppError("CATALOG_PROXY_REQUIRED", "Use the Player Hub website for catalog administration.", 403);
      if (!["GET", "HEAD"].includes(request.method) && ((request.headers.origin && request.headers.origin !== new URL(deps.env.FRONTEND_ORIGIN).origin) || request.headers["sec-fetch-site"] === "cross-site")) throw new AppError("CATALOG_ORIGIN_INVALID", "Invalid catalog request origin.", 403);
    });
    function id(params: unknown, key: "variantId" | "batchId") {
      const value = z.object({ [key]: z.string().uuid() }).strict().safeParse(params);
      if (!value.success) throw validationFailed("Invalid catalog identifier.");
      return value.data[key];
    }
    scope.get("/api/admin/catalog/access", async () => ({ allowed: true }));
    scope.get("/api/admin/catalog/designs", async () => catalogJson(await deps.catalog.designs()));
    scope.post("/api/admin/catalog/design-aliases", async request => deps.catalog.confirmAlias(request.body));
    scope.post("/api/admin/catalog/import/propose", { bodyLimit: 16 * 1024 * 1024 }, async request => deps.catalog.propose(request.body));
    scope.get("/api/admin/catalog", async request => {
      const query = z.object({ search: z.string().max(200).optional(), status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(), productType: z.enum(["CIRCZLES", "ACCESSORY"]).optional(), limit: z.coerce.number().int().min(1).max(100).default(100), offset: z.coerce.number().int().min(0).max(1000000).default(0) }).strict().safeParse(request.query);
      if (!query.success) throw validationFailed("Invalid catalog filters.");
      return catalogJson(await deps.catalog.list(query.data));
    });
    scope.get("/api/admin/catalog/:variantId", async request => catalogJson(await deps.catalog.detail(id(request.params, "variantId"))));
    scope.post("/api/admin/catalog", async (request, reply) => reply.code(201).send(catalogJson(await deps.catalog.create(request.body as Parameters<CatalogService["create"]>[0]))));
    scope.patch("/api/admin/catalog/:variantId", async request => catalogJson(await deps.catalog.update(id(request.params, "variantId"), request.body)));
    scope.post("/api/admin/catalog/:variantId/batches", async (request, reply) => reply.code(201).send(catalogJson(await deps.catalog.addBatch(id(request.params, "variantId"), request.body as Parameters<CatalogService["addBatch"]>[1]))));
    scope.patch("/api/admin/catalog/batches/:batchId", async request => catalogJson(await deps.catalog.editBatch(id(request.params, "batchId"), request.body)));
    scope.post("/api/admin/catalog/batches/:batchId/ranges", async request => catalogJson(await deps.catalog.addRange(id(request.params, "batchId"), request.body)));
    // 5,000-row manifests exceed Fastify's default 1 MiB transport limit.
    // The existing strict row/count validators and authorization still apply.
    const importOptions = { bodyLimit: 16 * 1024 * 1024 };
    scope.post("/api/admin/catalog/import/preview", importOptions, async request => deps.catalog.import(request.body));
    scope.post("/api/admin/catalog/import/apply", importOptions, async request => deps.catalog.import(request.body, true));
  });
}
