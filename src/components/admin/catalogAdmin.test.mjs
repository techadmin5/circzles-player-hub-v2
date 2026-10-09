import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

process.env.NEXT_PUBLIC_DATA_MODE = "api";
process.env.NEXT_PUBLIC_API_BASE_URL = "https://hub.example.test";
const { CatalogAdmin } = await import("./CatalogAdmin.tsx");
const { CatalogAdminBoundary } = await import("./CatalogAdminBoundary.tsx");
const { PuzzleCollectionExplorer } = await import("../puzzles/PuzzleCollectionExplorer.tsx");
const { usePlayerUiState } = await import("../../stores/playerUiState.ts");
const { useSound } = await import("../../hooks/useSound.ts");
const { PRIMARY_NAV } = await import("../game-shell/navConfig.ts");
const v = { catalogVariantId: "10000000-0000-4000-8000-000000000001", puzzleDesignId: "10000000-0000-4000-8000-000000000002", puzzleId: "10000000-0000-4000-8000-000000000003", displayName: "Lion", brand: "CircZles", productType: "CIRCZLES", sizeLabel: "12", pieceCount: 121, levelId: "1", status: "ACTIVE", image: null, description: "", marketingMetadata: {} };
const b = { manufacturingBatchId: "10000000-0000-4000-8000-000000000004", numberIdentifier: "29", manufacturingCode: "R2", skuPrefix: "CC-29-R2-01", serialStart: "1", serialEnd: "48", unitsManufactured: "48", claimedUnits: "1", remainingUnits: "47", status: "ACTIVE", ranges: [{ serialStart: "1", serialEnd: "48" }] };
const owned = { id: v.puzzleId, name: "Lion", levelId: 1, image: "/puzzles/placeholder.svg", description: "", status: "OWNED", playerPuzzleId: "owned" };
const profile = { internalId: "player", publicPlayerId: "player_001", displayName: "Player", avatar: "/brand/avatar.svg", progressionLevel: 1, rank: "Peasant", xp: 0, xpNeeded: 1200, synapsePoints: 0, stats: { ownedPuzzles: 1, completed: 0, approvedAttempts: 0, personalBests: 0, podiums: 0, seasonRank: 0, longestStreak: 0 } };
async function setup(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hub.example.test/admin/puzzles" });
  const keys = ["window", "self", "document", "HTMLElement", "Element", "SVGElement", "FormData", "IS_REACT_ACT_ENVIRONMENT"];
  const saved = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key] });
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  useSound.setState({ master: false }); usePlayerUiState.getState().clear();
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await act(async () => root.unmount()); usePlayerUiState.getState().clear(); dom.window.close(); for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  return root;
}
async function click(text) { const button = Array.from(document.querySelectorAll("button")).find(node => node.textContent === text); assert.ok(button, text); await act(async () => button.click()); }
async function submit(form, fields) { for (const [key, value] of Object.entries(fields)) form.elements.namedItem(key).value = value; await act(async () => form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))); }

test("catalog boundary stays closed for denied or unprovisioned server roles", async t => {
  const root = await setup(t); let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; return Response.json({ code: "FORBIDDEN" }, { status: 403 }); });
  localFlag();
  await act(async () => root.render(createElement(PathnameContext.Provider, { value: "/admin/puzzles" }, createElement(CatalogAdminBoundary, null, createElement(CatalogAdmin)))));
  assert.match(document.body.textContent, /Admin access unavailable/); assert.equal(document.querySelector("form"), null); assert.equal(requests, 1);
  function localFlag() { window.localStorage.setItem("admin", "true"); }
});
test("authorized catalog detail renders batch ranges and statistics while protecting claimed identity", async t => {
  const root = await setup(t);
  t.mock.method(globalThis, "fetch", async url => Response.json(new URL(url).pathname.endsWith(v.catalogVariantId) ? { ...v, batches: [b] } : [v]));
  await act(async () => root.render(createElement(CatalogAdmin))); await click("Lion");
  assert.match(document.body.textContent, /Manufactured: 48 · Claimed: 1 · Remaining: 47/);
  assert.match(document.body.textContent, /Verified ranges: 1–48/);
  assert.doesNotMatch(document.body.textContent, /Correct unclaimed manufacturing setup/);
  assert.match(document.body.textContent, /Add Manufacturing Batch to Existing CircZles/);
});
test("admin can create a canonical CircZles then attach an exact manufacturing batch without client identity fields", async t => {
  const root = await setup(t), calls = []; let batches = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (init.method) { calls.push({ path, body: JSON.parse(init.body) }); if (path.endsWith("/batches")) { batches = [b]; return Response.json(b); } return Response.json(v); }
    return Response.json(path.endsWith(v.catalogVariantId) ? { ...v, batches } : []);
  });
  await act(async () => root.render(createElement(CatalogAdmin))); await click("+ Add CircZles");
  await submit(document.querySelector("form"), { displayName: "Lion", brand: "CircZles", sizeLabel: "12", pieceCount: "121", levelId: "1", status: "ACTIVE" });
  assert.equal(calls[0].body.levelId, 1); assert.equal(calls[0].body.productType, "CIRCZLES");
  const form = Array.from(document.querySelectorAll("form")).find(form => form.elements.namedItem("skuPrefix"));
  await submit(form, { numberIdentifier: "29", manufacturingCode: "R2", skuPrefix: "CC-29-R2-01", firstFullSku: "CC-29-R2-01-0001", serialStart: "1", serialEnd: "48", unitsManufactured: "48", status: "ACTIVE" });
  assert.equal(calls[1].path, "/api/admin/catalog/" + v.catalogVariantId + "/batches");
  assert.equal(calls[1].body.firstFullSku, "CC-29-R2-01-0001"); assert.equal(calls[1].body.unitsManufactured, "48");
  assert.equal("playerId" in calls[1].body, false); assert.equal("puzzleId" in calls[1].body, false);
});
test("server mutation rejection displays an error and never fabricates a successful catalog update", async t => {
  const root = await setup(t);
  t.mock.method(globalThis, "fetch", async (_url, init = {}) => init.method ? Response.json({ code: "FORBIDDEN", message: "Admin permission is required." }, { status: 403 }) : Response.json([]));
  await act(async () => root.render(createElement(CatalogAdmin))); await click("+ Add CircZles");
  await submit(document.querySelector("form"), { displayName: "Denied", brand: "CircZles" });
  assert.match(document.querySelector('[role="alert"]').textContent, /Admin permission/); assert.doesNotMatch(document.body.textContent, /entry saved/);
});
test("successful physical claim immediately updates the collection and canonical owned statistic without refresh", async t => {
  const root = await setup(t), calls = []; let claimed = false;
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const path = new URL(url).pathname; calls.push({ path, body: init.body });
    if (path === "/api/puzzles/claim") { claimed = true; return Response.json({ success: true, puzzle: owned }); }
    if (path === "/api/me") return Response.json(profile);
    return Response.json(claimed ? [owned] : []);
  });
  await act(async () => root.render(createElement(PuzzleCollectionExplorer)));
  assert.match(document.body.textContent, /No CircZles added/); assert.equal(document.querySelector('input[name="code"]').placeholder, "CC-29-R2-01-0001");
  await submit(document.querySelector("form"), { code: "CC-29-R2-01-0001" });
  assert.match(document.body.textContent, /Lion added/); assert.equal(document.querySelector('[data-testid="puzzle-card-' + v.puzzleId + '"] h3').textContent, "Lion");
  assert.equal(usePlayerUiState.getState().player.stats.ownedPuzzles, 1);
  assert.deepEqual(JSON.parse(calls.find(c => c.path === "/api/puzzles/claim").body), { code: "CC-29-R2-01-0001" });
});
for (const [code, text] of [["PUZZLE_SERIAL_NOT_MANUFACTURED", "outside the manufactured"], ["PUZZLE_BATCH_INACTIVE", "not active"], ["PUZZLE_CODE_ACCESSORY", "Accessory SKUs"], ["PUZZLE_CODE_ALREADY_CLAIMED", "already been claimed"], ["PUZZLE_ALREADY_OWNED", "already in your Player Hub"]]) test("claim UX explains " + code + " without adding ownership", async t => {
  const root = await setup(t);
  t.mock.method(globalThis, "fetch", async (_url, init = {}) => init.method ? Response.json({ code }, { status: 400 }) : Response.json([]));
  await act(async () => root.render(createElement(PuzzleCollectionExplorer))); await submit(document.querySelector("form"), { code: "CC-29-R2-01-0501" });
  assert.ok(document.querySelector('[data-testid="add-puzzle-message"]').textContent.includes(text)); assert.equal(document.querySelector('[data-testid^="puzzle-card-"]'), null);
});
test("navigation brands the existing collection route as My CircZles", () => assert.equal(PRIMARY_NAV.find(item => item.href === "/puzzles").label, "My CircZles"));
test("a pending pre-claim collection read cannot erase a successful claim when canonical hydration fails", async t => {
  const root = await setup(t); let release, reads = 0, posts = 0;
  t.mock.method(globalThis, "fetch", async url => {
    const path = new URL(url).pathname;
    if (path === "/api/puzzles/claim") { posts++; return Response.json({ success: true, puzzle: owned }); }
    if (path === "/api/me") return Response.json({ code: "UNAVAILABLE" }, { status: 503 });
    reads++; return new Promise(resolve => { release = resolve; });
  });
  await act(async () => root.render(createElement(PuzzleCollectionExplorer)));
  await submit(document.querySelector("form"), { code: "CC-29-R2-01-0001" });
  await act(async () => release(Response.json([])));
  assert.equal(reads, 1); assert.equal(posts, 1); assert.equal(document.querySelector('[data-testid="puzzle-card-' + v.puzzleId + '"] h3').textContent, "Lion");
  assert.ok(usePlayerUiState.getState().syncError);
});
test("catalog authorization is rechecked after a session generation changes", async t => {
  const root = await setup(t); let allowed = true;
  t.mock.method(globalThis, "fetch", async () => Response.json(allowed ? { allowed: true } : { code: "FORBIDDEN" }, { status: allowed ? 200 : 403 }));
  await act(async () => root.render(createElement(PathnameContext.Provider, { value: "/admin/puzzles" }, createElement(CatalogAdminBoundary, null, createElement("p", null, "Authorized content")))));
  assert.match(document.body.textContent, /Authorized content/); allowed = false;
  await act(async () => usePlayerUiState.getState().clear());
  assert.doesNotMatch(document.body.textContent, /Authorized content/); assert.match(document.body.textContent, /Admin access unavailable/);
});
test("catalog import requires a successful preview before apply and clears approval when the manifest changes", async t => {
  const root = await setup(t), calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    if (!init.method) return Response.json([]);
    const path = new URL(url).pathname; calls.push(path); return Response.json({ applied: path.endsWith("apply"), rows: 1, planned: 1, skipped: [], ready: true, errors: [] });
  });
  await act(async () => root.render(createElement(CatalogAdmin)));
  const fileInput = document.querySelector('input[type="file"]');
  async function edit(value) {
    await act(async () => { Object.defineProperty(fileInput, "files", { configurable: true, value: [{ text: async () => value }] }); fileInput.dispatchEvent(new window.Event("change", { bubbles: true })); await new Promise(setImmediate); });
  }
  await edit('{"datasetId":"test","rows":[],"mappings":{}}');
  const apply = Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Apply validated import"); assert.equal(apply.disabled, true);
  await click("Dry-run validation"); assert.equal(apply.disabled, false);
  await edit('{"datasetId":"changed","rows":[],"mappings":{}}'); assert.equal(apply.disabled, true);
  await click("Dry-run validation"); await click("Apply validated import"); assert.equal(apply.disabled, true);
  assert.deepEqual(calls, ["/api/admin/catalog/import/preview", "/api/admin/catalog/import/preview", "/api/admin/catalog/import/apply"]);
});
test("canonical state invalidation refreshes renamed CircZles without changing owned stats", async t => {
  const root = await setup(t); let name = "Lion";
  t.mock.method(globalThis, "fetch", async () => Response.json([{ ...owned, name }]));
  await act(async () => { usePlayerUiState.getState().hydrate(profile); root.render(createElement(PuzzleCollectionExplorer)); });
  assert.equal(document.querySelector("h3").textContent, "Lion"); name = "Final Lion";
  await act(async () => usePlayerUiState.getState().hydrate(profile));
  assert.equal(document.querySelector("h3").textContent, "Final Lion"); assert.equal(usePlayerUiState.getState().player.stats.ownedPuzzles, 1);
});
