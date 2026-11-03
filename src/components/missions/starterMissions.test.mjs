import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

process.env.NEXT_PUBLIC_DATA_MODE = "api";
process.env.NEXT_PUBLIC_API_BASE_URL = "https://hub.example.test";
const { DailyCheckIn } = await import("./DailyCheckIn.tsx");
const { MissionTrackingEditor } = await import("../admin/MissionTrackingEditor.tsx");
async function setup(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hub.example.test/missions" });
  const keys = ["window", "self", "document", "HTMLElement", "Element", "SVGElement", "FormData", "IS_REACT_ACT_ENVIRONMENT"];
  const saved = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key] });
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  return root;
}
const click = async label => act(async () => [...document.querySelectorAll("button")].find(button => button.textContent === label).click());
test("check-in never fires on mount; explicit click uses session, empty body and UTC response", async t => {
  const root = await setup(t), writes = []; let refreshes = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => { writes.push([url, init]); return Response.json({ utcDate: "2030-01-01", idempotent: writes.length > 1 }); });
  await act(async () => root.render(createElement(DailyCheckIn, { onRecorded: () => refreshes++ })));
  assert.equal(writes.length, 0); await click("Check in today");
  assert.equal(writes[0][0], "https://hub.example.test/api/missions/check-in");
  assert.equal(writes[0][1].credentials, "include"); assert.equal(writes[0][1].body, "{}");
  assert.match(document.body.textContent, /2030-01-01 UTC/); assert.equal(refreshes, 1);
  await click("Check in today"); assert.match(document.body.textContent, /Already checked in/);
});
test("failed check-in exposes retry without claiming or awarding anything", async t => {
  const root = await setup(t); let refreshes = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json({ message: "Session expired" }, { status: 401 }));
  await act(async () => root.render(createElement(DailyCheckIn, { onRecorded: () => refreshes++ })));
  await click("Check in today"); assert.match(document.body.textContent, /Session expired/); assert.equal(refreshes, 0);
});
const mission = { missionId: "10000000-0000-4000-8000-000000000001", updatedAt: "2030-01-01T00:00:00.000Z", active: false, rule: { eventType: "reward_wheel.spun" } };
test("tracking loads on demand, retains UTC mode, and submits only configuration plus revision", async t => {
  const root = await setup(t), reads = [], saves = [];
  t.mock.method(globalThis, "fetch", async url => { reads.push(url); return Response.json({ mode: "DISTINCT_UTC_DAYS", firstEver: false, eligibleMissionIds: [], collectibleId: null }); });
  await act(async () => root.render(createElement(MissionTrackingEditor, { mission, busy: false, onSave: input => saves.push(input) })));
  assert.equal(reads.length, 0); await click("Inspect tracking"); assert.equal(reads.length, 1);
  await act(async () => document.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
  assert.deepEqual(saves, [{ mode: "DISTINCT_UTC_DAYS", firstEver: false, eligibleMissionIds: [], collectibleId: null, expectedUpdatedAt: mission.updatedAt }]);
});
test("active tracking stays inspectable but has no enabled mutation controls", async t => {
  const root = await setup(t);
  t.mock.method(globalThis, "fetch", async () => Response.json(null));
  await act(async () => root.render(createElement(MissionTrackingEditor, { mission: { ...mission, active: true }, busy: false, onSave: () => assert.fail("Must not save") })));
  await click("Inspect tracking"); assert.equal(document.querySelector("fieldset").disabled, true);
});
