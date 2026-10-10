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
  t.mock.method(globalThis, "fetch", async (url, init = {}) => { if (new URL(url).pathname.endsWith("/propose")) return Response.json({ proposals: [] });
    const path = new URL(url).pathname;
    if (init.method && !new URL(url).pathname.endsWith("/propose")) { calls.push({ path, body: JSON.parse(init.body) }); if (path.endsWith("/batches")) { batches = [b]; return Response.json(b); } return Response.json(v); }
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
  t.mock.method(globalThis, "fetch", async (url, init = {}) => { if (new URL(url).pathname.endsWith("/propose")) return Response.json({ proposals: [] });
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
test("catalog import requires preview and explicit confirmation, invalidated by source changes", async t => {
  const root = await setup(t), calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => { if (new URL(url).pathname.endsWith("/propose")) return Response.json({ proposals: [] });
    if (!init.method) return Response.json([]);
    const path = new URL(url).pathname; calls.push(path); return Response.json({ applied: path.endsWith("apply"), rows: 1, planned: 1, skipped: [], ready: true, errors: [] });
  });
  await act(async () => root.render(createElement(CatalogAdmin)));
  const fileInput = document.querySelector('input[type="file"]');
  const source = { sourceId: "29-R2", name: "Lion", size: "12", brand: "CircZles", numberIdentifier: "29", manufacturingCode: "R2", level: "01", units: "48", firstFullSku: "CC-29-R2-01-0001", productType: "CIRCZLES" };
  async function edit(datasetId) {
    const value = JSON.stringify({ datasetId, rows: [source], mappings: { "29-R2": { newVariantKey: "lion" } } });
    await act(async () => { Object.defineProperty(fileInput, "files", { configurable: true, value: [{ name: "catalog.json", size: value.length, text: async () => value }] }); fileInput.dispatchEvent(new window.Event("change", { bubbles: true })); await new Promise(setImmediate); });
    await click("Reconcile canonical products"); await click("Review import summary");
  }
  const applyButton = () => Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Apply validated import");
  await edit("test"); assert.equal(applyButton().disabled, true);
  await click("Dry-run validation"); assert.equal(applyButton().disabled, false);
  await edit("changed"); assert.equal(applyButton().disabled, true);
  await click("Dry-run validation"); await click("Apply validated import");
  assert.equal(calls.length, 2); assert.ok(document.querySelector('[role="dialog"]'));
  await click("Cancel"); assert.equal(calls.length, 2);
  await click("Apply validated import"); await click("Apply Import"); assert.equal(applyButton().disabled, true);
  assert.match(document.body.textContent, /Import completed successfully/);
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

async function uploadCatalog(name, text) {
  const control = document.querySelector('input[type="file"]');
  await act(async () => { Object.defineProperty(control, "files", { configurable: true, value: [{ name, size: Buffer.byteLength(text), text: async () => text }] }); control.dispatchEvent(new window.Event("change", { bubbles: true })); await new Promise(setImmediate); });
}
async function selectCatalog(label, value) {
  const select = Array.from(document.querySelectorAll("select")).find(node => node.getAttribute("aria-label") === label); assert.ok(select, label);
  await act(async () => { select.value = value; select.dispatchEvent(new window.Event("change", { bubbles: true })); });
}
const importCsv = 'Puzzle Name,Size,Brand Name,Number Identifier,Manufacturing Code,Levels,Units,Sku Number,Website SKU,Notes\nLion,12,CircZles,29,R2,01,48,CC-29-R2-01-0001,WEB-29,Unrelated\nLION,12,CircZles,61,R3,01,500,CC-61-R3-01-0001,WEB-61,Unrelated';
test("CSV wizard ignores commercial columns and explicitly shares Lion groups before server preview", async t => {
  const root = await setup(t), manifests = [];
  t.mock.method(globalThis, "fetch", async (_url, init = {}) => { if (new URL(_url).pathname.endsWith("/propose")) return Response.json({ proposals: [] });
    if (!init.method) return Response.json([v]);
    manifests.push(JSON.parse(init.body)); return Response.json({ ready: false, applied: false, errors: [{ sourceId: "61-R3", message: "Review this source" }], rows: 2, planned: 2, skipped: [] });
  });
  await act(async () => root.render(createElement(CatalogAdmin)));
  await uploadCatalog("catalog.csv", importCsv); assert.match(document.body.textContent, /Website SKU.*Ignored/); assert.equal(manifests.length, 0);
  await click("Preview normalized rows"); assert.match(document.body.textContent, /Selected 2 of 2/);
  await click("Reconcile canonical products"); assert.match(document.body.textContent, /Needs review/);
  await click("New playable CircZles"); await click("Resolve row 3");
  await selectCatalog("Reuse new canonical group", "import-group-0001"); await click("Review import summary");
  await click("Dry-run validation");
  assert.deepEqual(manifests[0].mappings["29-R2"], manifests[0].mappings["61-R3"]);
  assert.equal(manifests[0].rows[0].firstFullSku, "CC-29-R2-01-0001"); assert.equal("Website SKU" in manifests[0].rows[0], false);
  assert.match(document.body.textContent, /Review this source/);
  assert.equal(Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Apply validated import").disabled, true);
});
test("wizard selection controls exclude rows; unresolved mappings block dry-run", async t => {
  const root = await setup(t), manifests = [];
  t.mock.method(globalThis, "fetch", async (_url, init = {}) => { if (new URL(_url).pathname.endsWith("/propose")) return Response.json({ proposals: [] }); if (!init.method) return Response.json([]); manifests.push(JSON.parse(init.body)); return Response.json({ ready: true, applied: false, errors: [], rows: 1, planned: 1, skipped: [] }); });
  await act(async () => root.render(createElement(CatalogAdmin))); await uploadCatalog("catalog.csv", importCsv); await click("Preview normalized rows");
  await click("Deselect All"); assert.match(document.body.textContent, /Selected 0 of 2/);
  await click("Select All"); assert.match(document.body.textContent, /Selected 2 of 2/);
  const checkbox = document.querySelector('[aria-label="Import row 3"]'); await act(async () => checkbox.click());
  await click("Reconcile canonical products"); await click("Review import summary");
  assert.equal(Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Dry-run validation").disabled, true);
  await click("Back"); await click("Confirm new product identities for unresolved rows"); await click("Review import summary"); await click("Dry-run validation");
  assert.deepEqual(manifests[0].rows.map(r => r.sourceId), ["29-R2"]); assert.deepEqual(Object.keys(manifests[0].mappings), ["29-R2"]);
});
test("wizard existing catalog selection sends catalogVariantId without creating an implicit group", async t => {
  const root = await setup(t), manifests = [];
  t.mock.method(globalThis, "fetch", async (_url, init = {}) => { if (new URL(_url).pathname.endsWith("/propose")) return Response.json({ proposals: [] }); if (!init.method) return Response.json([v]); manifests.push(JSON.parse(init.body)); return Response.json({ ready: true, applied: false, errors: [], rows: 2, planned: 2, skipped: [] }); });
  await act(async () => root.render(createElement(CatalogAdmin))); await uploadCatalog("catalog.csv", importCsv); await click("Preview normalized rows"); await click("Reconcile canonical products");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
  await selectCatalog("Existing canonical product", v.catalogVariantId);
  await click("Resolve row 3"); await click("New playable CircZles"); await click("Review import summary"); await click("Dry-run validation");
  assert.deepEqual(manifests[0].mappings["29-R2"], { catalogVariantId: v.catalogVariantId });
});
test("5000-row wizard renders bounded pages and never auto-applies on file selection", async t => {
  const root = await setup(t); let posts = 0;
  t.mock.method(globalThis, "fetch", async (_url, init = {}) => { if (new URL(_url).pathname.endsWith("/propose")) return Response.json({ proposals: [] }); if (init.method) posts++; return Response.json([]); });
  await act(async () => root.render(createElement(CatalogAdmin)));
  const header = importCsv.split("\n")[0]; const rows = Array.from({ length: 5000 }, (_, i) => `Puzzle,12,CircZles,${i + 100},R4,01,1,CC-${i + 100}-R4-01-0001,WEB,Notes`);
  await uploadCatalog("large.csv", [header, ...rows].join("\n")); await click("Preview normalized rows");
  assert.equal(document.querySelectorAll('input[type="checkbox"]').length, 50); assert.match(document.body.textContent, /Selected 5000 of 5000/); assert.equal(posts, 0);
  await click("Next rows"); assert.match(document.body.textContent, /Page 2/); assert.equal(document.querySelectorAll('input[type="checkbox"]').length, 50);
});

test("Excel worksheet selection and manual column override update normalized preview explicitly", async t => {
  const XLSX = await import("xlsx"), root = await setup(t);
  t.mock.method(globalThis, "fetch", async () => Response.json([]));
  await act(async () => root.render(createElement(CatalogAdmin)));
  const book = XLSX.utils.book_new(); const [header, one, two] = importCsv.split("\n").map(line => line.split(","));
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Notes"], ["Ignore"]]), "Notes");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([header, one]), "R2");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([header, two]), "R3");
  const bytes = XLSX.write(book, { bookType: "xlsx", type: "buffer" });
  const control = document.querySelector('input[type="file"]');
  await act(async () => { Object.defineProperty(control, "files", { configurable: true, value: [{ name: "catalog.xlsx", size: bytes.length, arrayBuffer: async () => bytes }] }); control.dispatchEvent(new window.Event("change", { bubbles: true })); await new Promise(setImmediate); });
  assert.match(document.body.textContent, /Worksheet: R2/);
  await selectCatalog("Select worksheet", "2"); assert.match(document.body.textContent, /Worksheet: R3/);
  await selectCatalog("Column for CircZles Name", "9"); await click("Preview normalized rows");
  const table = Array.from(document.querySelectorAll("table")).find(node => node.querySelector("caption"));
  assert.match(table.textContent, /Unrelated/); assert.match(table.textContent, /CC-61-R3-01-0001/); assert.doesNotMatch(table.textContent, /CC-29-R2/);
  await selectCatalog("Product type for row 2", "ACCESSORY"); assert.match(table.textContent, /SKU family/);
});

test("51-sheet wizard switches on demand and clears selection, mapping and dry-run approval", async t => {
  const XLSX = await import("xlsx"), root = await setup(t), calls = []; let fileReads = 0;
  t.mock.method(globalThis, "fetch", async (_url, init = {}) => { if (new URL(_url).pathname.endsWith("/propose")) return Response.json({ proposals: [] }); if (!init.method) return Response.json([]); calls.push(JSON.parse(init.body)); return Response.json({ ready: true, applied: false, rows: 1, planned: 1, skipped: [], errors: [] }); });
  await act(async () => root.render(createElement(CatalogAdmin)));
  const book = XLSX.utils.book_new(), [header, r2, r3] = importCsv.split("\n").map(line => line.split(","));
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), "Empty");
  for (let i = 1; i < 49; i++) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Notes"], ["Unrelated"]]), "Reference " + i);
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([header, r2]), "Final Run SKU R2");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([header, r3]), "Final Run SKU R3");
  const bytes = XLSX.write(book, { bookType: "xlsx", type: "buffer" });
  const control = document.querySelector('input[type="file"]');
  await act(async () => { Object.defineProperty(control, "files", { configurable: true, value: [{ name: "_Circzles Cogzart Final Run SKU Oct-25.xlsx", size: bytes.length, arrayBuffer: async () => { fileReads++; return bytes; } }] }); control.dispatchEvent(new window.Event("change", { bubbles: true })); await new Promise(setImmediate); });
  const picker = document.querySelector('[aria-label="Select worksheet"]'); assert.equal(picker.options.length, 51);
  assert.equal(picker.value, "49");
  await click("Preview normalized rows"); await click("Deselect All"); await click("Select All"); await click("Reconcile canonical products"); await click("New playable CircZles"); await click("Review import summary"); await click("Dry-run validation");
  assert.equal(Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Apply validated import").disabled, false);
  await selectCatalog("Select worksheet", "50");
  assert.equal(document.querySelector('[role="dialog"]'), null); assert.doesNotMatch(document.body.textContent, /Preview only/);
  await click("Preview normalized rows"); assert.match(document.body.textContent, /Selected 1 of 1/);
  await click("Reconcile canonical products"); assert.match(document.body.textContent, /Needs review/); await click("Review import summary");
  assert.equal(Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Apply validated import").disabled, true);
  assert.equal(Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Dry-run validation").disabled, true);
  await selectCatalog("Select worksheet", "0"); assert.match(document.body.textContent, /No usable rows found/);
  await selectCatalog("Select worksheet", "49"); await click("Preview normalized rows");
  assert.equal(document.querySelectorAll('input[type="checkbox"]').length, 1); assert.equal(fileReads, 1); assert.equal(calls.length, 1);
});

test("real worksheet preview excludes ignored column-17 notes and remapping recomputes rows", async t => {
  const XLSX = await import("xlsx"), { readFile } = await import("node:fs/promises"), root = await setup(t);
  t.mock.method(globalThis, "fetch", async () => Response.json([]));
  const fixture = JSON.parse(await readFile(new URL("../../../docs/circzles-catalog/r1-r2-r3.source.json", import.meta.url), "utf8"));
  const matrix = Array.from({ length: 248 }, () => []);
  matrix[0] = ["Workbook"]; matrix[2] = ["Puzzle Name", "Size", "Brand Name", "Number Identifier", "Manufacturing Code", "Levels", "Units", "Sku Number", ...Array(8).fill(""), "Reference Notes"];
  fixture.rows.forEach((r, i) => { matrix[i + 3] = [r.name, r.size, r.brand, r.numberIdentifier, r.manufacturingCode, r.level, r.units, r.firstFullSku]; });
  for (let i = 0; i < 44; i++) matrix[161 + i * 2][16] = "Reference " + i;
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(matrix), "circzles sku");
  const bytes = XLSX.write(book, { bookType: "xlsx", type: "buffer" });
  await act(async () => root.render(createElement(CatalogAdmin)));
  const control = document.querySelector('input[type="file"]');
  await act(async () => { Object.defineProperty(control, "files", { configurable: true, value: [{ name: "_Circzles Cogzart Final Run SKU Oct-25.xlsx", size: bytes.length, arrayBuffer: async () => bytes }] }); control.dispatchEvent(new window.Event("change", { bubbles: true })); await new Promise(setImmediate); });
  await click("Preview normalized rows"); assert.match(document.body.textContent, /Selected 82 of 82/);
  await click("Reconcile canonical products"); await click("Confirm new product identities for unresolved rows"); await click("Review import summary");
  const units = Array.from(document.querySelectorAll("dt")).find(node => node.textContent === "Manufactured units"); assert.equal(units.nextElementSibling.textContent, "12001");
  await click("Back"); await click("Back"); await click("Back");
  await selectCatalog("Column for CircZles Name", "16"); await click("Preview normalized rows");
  assert.match(document.body.textContent, /Selected 126 of 126/);
});

test("verified signatures automatically group manufacturing runs and missing pieces require explicit review", async t => {
  const { proposeIdentities } = await import("../../../backend/src/domain/catalogIdentity.ts");
  const root = await setup(t), previews = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/propose")) return Response.json({ proposals: proposeIdentities(JSON.parse(init.body).rows, { aliases: [], designs: [], variants: [] }) });
    if (path.endsWith("/preview")) { previews.push(JSON.parse(init.body)); return Response.json({ ready: true, applied: false, rows: 2, planned: 2, errors: [], skipped: [] }); }
    return Response.json([]);
  });
  await act(async () => root.render(createElement(CatalogAdmin)));
  const csv = "Puzzle Name,Size,Brand,Number Identifier,Manufacturing Run,Level,Units,First Full SKU,No. of Pieces\nLion,12,CircZles,29,R2,01,48,CC-29-R2-01-0001,37\nLION,12,CircZles,61,R3,01,500,CC-61-R3-01-0001,37";
  const upload = async text => { const control = document.querySelector('input[type="file"]'); await act(async () => { Object.defineProperty(control, "files", { configurable: true, value: [{ name: "verified.csv", size: text.length, text: async () => text }] }); control.dispatchEvent(new window.Event("change", { bubbles: true })); await new Promise(setImmediate); }); };
  await upload(csv); await click("Preview normalized rows"); assert.match(document.body.textContent, /Automatically grouped/);
  await click("Reconcile canonical products"); await click("Review import summary"); await click("Dry-run validation");
  assert.equal(previews.length, 1); assert.equal(previews[0].mappings["29-R2"].newVariantKey, previews[0].mappings["61-R3"].newVariantKey);
  await upload(csv.replace(/,37$/, ",")); await click("Preview normalized rows"); assert.match(document.body.textContent, /NEEDS-REVIEW/);
  await click("Reconcile canonical products"); await click("Review import summary");
  assert.equal(Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Dry-run validation").disabled, true);
  assert.equal(Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Apply validated import").disabled, true);
});

test("manual duplicate redirects to existing CircZles manufacturing form instead of creating another playable identity", async t => {
  const root = await setup(t); let creates = 0;
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/designs")) return Response.json({ designs: [{ puzzleDesignId: v.puzzleDesignId, name: "Lion" }], aliases: [], variants: [v] });
    if (init.method === "POST") { creates++; return Response.json({ ...v, existingCanonical: true }); }
    return Response.json(path.endsWith(v.catalogVariantId) ? { ...v, batches: [] } : [v]);
  });
  await act(async () => root.render(createElement(CatalogAdmin))); await click("+ Add CircZles");
  await submit(document.querySelector("form"), { displayName: "Lion", brand: "CircZles", puzzleDesignId: v.puzzleDesignId, sizeLabel: "12", levelId: "1", pieceCount: "37", status: "ACTIVE" });
  assert.equal(creates, 1); assert.match(document.body.textContent, /This playable CircZles already exists. Add a Manufacturing Batch instead./);
  assert.ok(Array.from(document.querySelectorAll("form")).some(f => f.elements.namedItem("skuPrefix")));
  assert.equal(Array.from(document.querySelectorAll("button")).some(b => b.textContent === "Create New CircZles"), false);
});
