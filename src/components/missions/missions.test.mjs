import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

process.env.NEXT_PUBLIC_DATA_MODE = "api";
process.env.NEXT_PUBLIC_API_BASE_URL = "https://hub.example.test";
const require = createRequire(import.meta.url);
require.extensions[".css"] = module => { module.exports = {}; };
require.extensions[".png"] = module => { module.exports = { src: "/synthetic-rank.png", width: 256, height: 256 }; };
const { MissionExplorer } = await import("./MissionExplorer.tsx");
const { GameFeedbackProvider } = await import("../feedback/GameFeedbackProvider.tsx");
const { usePlayerUiState } = await import("../../stores/playerUiState.ts");
const { useSound } = await import("../../hooks/useSound.ts");
const { adaptApiMission, apiClient } = await import("../../lib/apiClient.ts");
const mission = (periodKey = "2030-01-01") => ({ missionId: "10000000-0000-4000-8000-000000000001", title: "Synthetic earned mission", description: "Synthetic", category: "DAILY", periodType: "DAILY", periodKey, status: "CLAIMABLE", claimable: true, progress: { current: 1, target: 1 }, startsAt: null, endsAt: "2030-01-02T00:00:00Z", claimDeadline: "2030-01-03T00:00:00Z", rewards: [{ type: "XP", amount: 7, label: "7 XP" }] });

async function setup(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hub.example.test/missions" });
  const keys = ["window", "self", "document", "HTMLElement", "Element", "SVGElement", "IS_REACT_ACT_ENVIRONMENT"];
  const saved = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key] });
  usePlayerUiState.getState().clear(); useSound.setState({ master: false, reducedMotion: true });
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await act(async () => root.unmount()); usePlayerUiState.getState().clear(); dom.window.close(); for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  return async () => act(async () => root.render(createElement(GameFeedbackProvider, null, createElement(MissionExplorer, { mode: "api" }))));
}
function card(period) { return [...document.querySelectorAll("article[data-period-key]")].find(node => node.dataset.periodKey === period); }

test("earned-period adapter shows the claim grace period rather than an ended availability window", () => {
  const adapted = adaptApiMission(mission(), new Date("2030-01-02T12:00:00Z"));
  assert.equal(adapted.claimDeadline, "2030-01-03T00:00:00Z"); assert.notEqual(adapted.timeRemaining, "Ended");
});
test("period API preserves credentials/no-store and encodes an explicit fixed period claim", async t => {
  const reads = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => { reads.push([new URL(url).pathname, init]); return Response.json({ missions: [mission()] }); });
  await apiClient.getMissionPeriods();
  assert.equal(reads[0][0], "/api/missions/periods"); assert.equal(reads[0][1].credentials, "include"); assert.equal(reads[0][1].cache, "no-store");
  t.mock.method(globalThis, "fetch", async (url, init) => { reads.push([new URL(url).pathname, init]); return Response.json({ code: "MISSION_CAPACITY_PENDING", message: "Pending" }, { status: 409 }); });
  await assert.rejects(apiClient.claimMission("mission", "stable-key", "fixed:mission"), { code: "MISSION_CAPACITY_PENDING" });
  assert.equal(reads[1][0], "/api/missions/mission/periods/fixed%3Amission/claim"); assert.equal(reads[1][1].headers["Idempotency-Key"], "stable-key"); assert.equal(reads[1][1].body, "{}");
});
test("two periods of one mission have independent busy/error/key state and reuse only their own retry key", async t => {
  const render = await setup(t), writes = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    if (init.method !== "POST") return Response.json({ missions: [mission(), mission("2030-01-02")] });
    writes.push({ path: new URL(url).pathname, key: init.headers["Idempotency-Key"] });
    return Response.json({ code: "MISSION_CAPACITY_PENDING", message: "Recorded" }, { status: 409 });
  });
  await render(); assert.equal(document.querySelectorAll("article[data-period-key]").length, 2);
  assert.match(card("2030-01-01").textContent, /Claim before 2030-01-03T00:00:00Z \(UTC\)/);
  await act(async () => card("2030-01-01").querySelector("button").click());
  assert.match(card("2030-01-01").textContent, /recorded for administrator recovery/);
  assert.doesNotMatch(card("2030-01-02").textContent, /recorded for administrator recovery/);
  await act(async () => card("2030-01-02").querySelector("button").click());
  await act(async () => card("2030-01-01").querySelector("button").click());
  assert.equal(writes.length, 3); assert.notEqual(writes[0].key, writes[1].key); assert.equal(writes[0].key, writes[2].key);
  assert.ok(writes[0].path.endsWith("/periods/2030-01-01/claim")); assert.ok(writes[1].path.endsWith("/periods/2030-01-02/claim"));
  assert.doesNotMatch(document.body.textContent, /Awarded|Mission Complete/);
});
test("successful claim updates only its period and does not replay payout when refresh fails", async t => {
  const render = await setup(t); let reads = 0, writes = 0;
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === "/api/me") return Response.json({ xp: 7, synapsePoints: 3, progressionLevel: 1, rank: "Synthetic" });
    if (init.method === "POST") { writes++; return Response.json({ missionClaimId: "synthetic-claim", missionId: mission().missionId, periodKey: "2030-01-01", status: "CLAIMED", idempotent: false, awarded: { xp: 7, synapsePoints: 3 }, playerState: { xp: 7, synapsePoints: 3, progressionLevel: 1, rankName: "Synthetic" } }); }
    if (++reads > 1) throw new Error("Synthetic refresh failure");
    return Response.json({ missions: [mission(), mission("2030-01-02")] });
  });
  await render(); await act(async () => card("2030-01-01").querySelector("button").click());
  assert.match(card("2030-01-01").textContent, /Claimed/); assert.equal(card("2030-01-01").querySelector("button"), null);
  assert.match(card("2030-01-01").textContent, /Reward claimed.*could not be refreshed/);
  assert.match(card("2030-01-02").querySelector("button").textContent, /Claim Reward/); assert.equal(writes, 1);
});
test("manual refresh reveals newly processed progress without a second page load", async t => {
  const render = await setup(t); let reads = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json({ missions: ++reads === 1 ? [] : [mission()] }));
  await render(); assert.match(document.body.textContent, /No active missions/);
  await act(async () => [...document.querySelectorAll("button")].find(button => button.textContent.includes("Refresh missions")).click());
  assert.ok(card("2030-01-01")); assert.equal(reads, 2);
});
for (const [code, message] of [["MISSION_CLAIM_EXPIRED", /original claim deadline has passed/], ["MISSION_CLAIMS_MAINTENANCE", /temporarily paused.*original deadlines still apply/]]) test(`${code} explains the actual claim state without a reward celebration`, async t => {
  const render = await setup(t);
  t.mock.method(globalThis, "fetch", async (_url, init = {}) => init.method === "POST" ? Response.json({ code, message: "Synthetic" }, { status: 409 }) : Response.json({ missions: [mission()] }));
  await render(); await act(async () => card("2030-01-01").querySelector("button").click());
  assert.match(card("2030-01-01").textContent, message); assert.doesNotMatch(card("2030-01-01").textContent, /Awarded/);
});
