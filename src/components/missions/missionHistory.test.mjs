import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
process.env.NEXT_PUBLIC_DATA_MODE = "api";
process.env.NEXT_PUBLIC_API_BASE_URL = "https://hub.example.test";
const { MissionHistory } = await import("./MissionHistory.tsx");
const { usePlayerUiState } = await import("../../stores/playerUiState.ts");
const entry = (state = "EXPIRED", id = "synthetic-entitlement") => ({ entitlementId: id, missionId: "synthetic-mission", title: "Historic mission", titleSource: "CURRENT_DEFINITION", periodKey: "2020-02-10", state, completionState: "CLAIMABLE", claimState: "UNCLAIMED", progress: { current: 1, target: 1 }, rewards: { xp: 7, synapsePoints: 3 }, rewardSource: "EARNED_SNAPSHOT", recordedAt: "2020-02-10T00:00:00.000Z", completedAt: "2020-02-10T12:00:00.000Z", claimedAt: null, periodStartsAt: null, periodEndsAt: null, claimDeadline: "2020-02-11T00:00:00.000Z", capacity: null });
const page = (entries = [entry()], nextCursor = null) => ({ entries, nextCursor });
async function setup(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hub.example.test/missions" });
  const keys = ["window", "self", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"];
  const saved = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key] });
  usePlayerUiState.getState().clear();
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await act(async () => root.unmount()); usePlayerUiState.getState().clear(); dom.window.close(); for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  return async (mode = "api") => act(async () => root.render(createElement(MissionHistory, { mode })));
}
async function click(text) {
  const button = [...document.querySelectorAll("button")].find(button => button.textContent === text);
  assert.ok(button, text); await act(async () => button.click());
}
test("read-only history displays historical amounts, all states and UTC dates without internal notes or claim controls", async t => {
  const render = await setup(t);
  const states = ["IN_PROGRESS", "UNCLAIMED", "EXPIRED", "CAPACITY_PENDING", "CAPACITY_BLOCKED", "RECOVERED", "PAID", "REVIEW_REQUIRED"];
  t.mock.method(globalThis, "fetch", async () => Response.json(page(states.map((state, index) => ({ ...entry(state, String(index)), title: index === 0 ? "<script>not executable</script>" : state, reason: "PRIVATE_ADMIN_NOTE" })))));
  await render(); assert.equal(document.querySelectorAll("article").length, 8);
  assert.match(document.body.textContent, /Names reflect current definitions/); assert.match(document.body.textContent, /7 XP \/ 3 SP/);
  for (const text of [/In progress/, /Earned, not paid/, /Original claim deadline passed/, /On-time claim recorded/, /Last recovery attempt was blocked/, /Paid through authorized recovery/, /Reward paid/, /payment evidence is incomplete/]) assert.match(document.body.textContent, text);
  assert.match(document.body.textContent, /2020-02-11T00:00:00.000Z \(UTC\)/); assert.match(document.body.textContent, /Not recorded/);
  assert.equal(document.querySelector("script,form,input"), null); assert.doesNotMatch(document.body.textContent, /PRIVATE_ADMIN_NOTE/);
  assert.deepEqual([...document.querySelectorAll("button")].map(button => button.textContent), ["Refresh history"]);
});
test("missing legacy rewards are reported as unavailable rather than zero or current settings", async t => {
  const render = await setup(t);
  t.mock.method(globalThis, "fetch", async () => Response.json(page([{ ...entry(), rewards: null, rewardSource: "UNAVAILABLE" }])));
  await render(); assert.match(document.body.textContent, /Historical reward amounts unavailable/); assert.doesNotMatch(document.body.textContent, /0 XP|7 XP/);
});
test("pagination uses a credentialed no-store GET, preserves earlier rows and prevents duplicate pending requests", async t => {
  const render = await setup(t), requests = []; let finish;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push([new URL(url), init]);
    return requests.length === 1 ? Response.json(page([entry()], "opaque_cursor")) : new Promise(resolve => { finish = () => resolve(Response.json(page([entry("PAID", "older")]))); });
  });
  await render(); await click("Load older history");
  assert.equal(document.querySelectorAll("article").length, 1);
  assert.ok([...document.querySelectorAll("button")].every(button => button.disabled));
  await click("Loading…"); assert.equal(requests.length, 2);
  await act(async () => finish()); assert.equal(document.querySelectorAll("article").length, 2);
  assert.equal(requests[1][0].pathname, "/api/missions/history"); assert.equal(requests[1][0].searchParams.get("cursor"), "opaque_cursor");
  assert.equal(requests[1][1].credentials, "include"); assert.equal(requests[1][1].cache, "no-store");
  assert.ok(requests.every(([, init]) => !init.method || init.method === "GET"));
});
test("failed older-page reads retain existing history and retry the same cursor", async t => {
  const render = await setup(t); let reads = 0; const cursors = [];
  t.mock.method(globalThis, "fetch", async url => {
    cursors.push(new URL(url).searchParams.get("cursor"));
    if (++reads === 1) return Response.json(page([entry()], "same_cursor"));
    if (reads === 2) return Response.json({ message: "Synthetic failure" }, { status: 500 });
    return Response.json(page([entry("PAID", "older")]));
  });
  await render(); await click("Load older history"); assert.equal(document.querySelectorAll("article").length, 1);
  assert.match(document.querySelector('[role="alert"]').textContent, /could not be loaded/);
  await click("Load older history"); assert.equal(document.querySelectorAll("article").length, 2);
  assert.deepEqual(cursors, [null, "same_cursor", "same_cursor"]);
});
test("expired session reports authentication failure and a retry can show an honest empty state", async t => {
  const render = await setup(t); let reads = 0;
  t.mock.method(globalThis, "fetch", async () => ++reads === 1 ? Response.json({ code: "UNAUTHORIZED" }, { status: 401 }) : Response.json(page([])));
  await render(); assert.match(document.body.textContent, /Sign in again/); assert.equal(document.querySelectorAll("article").length, 0);
  await click("Retry history"); assert.match(document.body.textContent, /No mission history recorded yet/);
});
test("session change hides prior history and ignores a late old-session response even if fetch ignores abort", async t => {
  const render = await setup(t); let reads = 0, finishOld;
  t.mock.method(globalThis, "fetch", async () => ++reads === 1 ? new Promise(resolve => { finishOld = () => resolve(Response.json(page([{ ...entry(), title: "OLD_PLAYER_PRIVATE_HISTORY" }]))); }) : Response.json(page([])));
  await render(); await act(async () => usePlayerUiState.getState().clear());
  await act(async () => finishOld());
  assert.doesNotMatch(document.body.textContent, /OLD_PLAYER_PRIVATE_HISTORY/); assert.match(document.body.textContent, /No mission history recorded yet/);
});
test("manual refresh reveals recovered status without issuing recovery or payout requests", async t => {
  const render = await setup(t), paths = [];
  t.mock.method(globalThis, "fetch", async (url, init) => { paths.push(new URL(url).pathname); assert.ok(!init.method || init.method === "GET"); return Response.json(page([entry(paths.length === 1 ? "CAPACITY_PENDING" : "RECOVERED")])); });
  await render(); assert.match(document.body.textContent, /On-time claim recorded/);
  await click("Refresh history"); assert.match(document.body.textContent, /Paid through authorized recovery/);
  assert.deepEqual(paths, ["/api/missions/history", "/api/missions/history"]);
});
test("mock mode never fabricates account history or makes API requests", async t => {
  const render = await setup(t); let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw Error("Unexpected API access"); });
  await render("mock"); assert.equal(calls, 0); assert.match(document.body.textContent, /signed-in player accounts in API mode/);
});
