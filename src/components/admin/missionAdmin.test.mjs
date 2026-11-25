import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
process.env.NEXT_PUBLIC_DATA_MODE = "api";
process.env.NEXT_PUBLIC_API_BASE_URL = "https://hub.example.test";
const { MissionAdmin } = await import("./MissionAdmin.tsx");
const { MissionLifecycleControls } = await import("./MissionLifecycleControls.tsx");
const { MissionApprovalContract } = await import("./MissionApprovalContract.tsx");
const { MissionRewardEditor } = await import("./MissionRewardEditor.tsx");
const { MissionScheduleEditor } = await import("./MissionScheduleEditor.tsx");
const { MissionTrackingEditor } = await import("./MissionTrackingEditor.tsx");
const { MissionManagerTabs } = await import("./MissionManagerTabs.tsx");
const model = await import("./missionManagerModel.ts");
const mission = { missionId: "10000000-0000-4000-8000-000000000001", title: "Daily Check-In", description: "Check in explicitly.", category: "DAILY", periodType: "DAILY", active: false, displayOrder: 0, updatedAt: "2030-01-01T00:00:00.000Z", startsAt: null, endsAt: null, claimDeadline: null, activationEffectiveAt: "2030-01-01T00:00:00.000Z", lifecycle: "INACTIVE", configurationIssues: [], rule: { eventType: "player.checked_in", targetCount: 1, sourceType: null, puzzleId: null, levelId: null, conditions: {}, active: true }, rewards: [{ rewardType: "XP", amount: 10, active: true }, { rewardType: "SYNAPSE_POINTS", amount: 10, active: true }] };
const tracking = { mode: "EVENT_COUNT", firstEver: false, eligibleMissionIds: [], collectibleId: null };
function contract(m = mission, approved = false) {
  const binding = { missionId: m.missionId, approvedConfigurationRevision: m.updatedAt, configurationDigest: "a".repeat(64) };
  const amounts = model.totals(m);
  return {
    binding, evaluatedAt: m.updatedAt, missionInactive: !m.active, recordingEnabled: !m.active, allowsActivation: false,
    rewards: { xp: amounts.xp, synapsePoints: amounts.sp },
    categories: ["PRODUCT", "REWARD_BUDGET"].map(category => ({
      category, status: approved ? "APPROVED" : "MISSING",
      recordedApproval: approved ? {
        ...binding, approvalId: category === "PRODUCT" ? "1" : "2", approvalCategory: category,
        approverAdminUserId: "40000000-0000-4000-8000-000000000004", approvedAt: m.updatedAt,
        xp: amounts.xp, synapsePoints: amounts.sp, revocationId: null, revokedByAdminUserId: null, revokedAt: null,
      } : null, requiredDecisions: [],
    })), recordContract: {},
  };
}
function readiness(m = mission, approved = false) { return { missionId: m.missionId, missionRevision: m.updatedAt, evaluatedAt: m.updatedAt, configurationStatus: m.rule && model.totals(m).configured ? "PASS" : "BLOCKED", overallStatus: approved ? "PASS" : "BLOCKED", activationReady: approved && !m.active, checks: [{ code: "PRODUCT_APPROVAL", category: "PRODUCT", status: approved ? "PASS" : "BLOCKED", field: "approval", message: "Product review required." }], rewardSafety: {} }; }
function inspection(m = mission, approved = false) { return { revision: m.updatedAt, readiness: readiness(m, approved), approval: contract(m, approved), tracking, lastLifecycleAction: null }; }
async function setup(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hub.example.test/admin/missions", pretendToBeVisual: true });
  const keys = ["window", "self", "document", "HTMLElement", "Element", "SVGElement", "FormData", "IS_REACT_ACT_ENVIRONMENT", "requestAnimationFrame"], saved = keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  for (const k of keys) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: k === "IS_REACT_ACT_ENVIRONMENT" ? true : k === "requestAnimationFrame" ? dom.window.requestAnimationFrame.bind(dom.window) : dom.window[k] });
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [k, d] of saved) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } });
  return root;
}
function mockApi(t, initial = [mission], options = {}) {
  let rows = structuredClone(initial); const writes = [], reads = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const u = new URL(url), p = u.pathname; reads.push(p + u.search);
    if (options.override) { const response = await options.override(p, init, rows); if (response) return response; }
    if (init.method && init.method !== "GET") {
      const body = JSON.parse(init.body); writes.push({ path: p, method: init.method, body });
      if (p === "/api/admin/missions") { const row = { ...mission, ...body, missionId: "20000000-0000-4000-8000-000000000002", active: false, rewards: [], rule: null }; rows.push(row); return Response.json(row, { status: 201 }); }
      if (p.includes("/approvals/")) return Response.json(contract(rows[0], true));
      const m = rows.find(m => p.includes(m.missionId));
      if (p.endsWith("/activate") || p.endsWith("/deactivate")) { m.active = p.endsWith("/activate"); m.lifecycle = m.active ? "ACTIVE" : "INACTIVE"; return Response.json({ active: m.active }); }
      if (p.endsWith("/rewards")) m.rewards = [["XP", body.xp], ["SYNAPSE_POINTS", body.synapsePoints]].filter(([, amount]) => amount !== null).map(([rewardType, amount]) => ({ rewardType, amount, active: true }));
      if (p.endsWith("/tracking")) return Response.json(m);
      if (p === "/api/admin/missions/" + m.missionId) Object.assign(m, body);
      m.updatedAt = "2030-01-02T00:00:00.000Z"; return Response.json(m);
    }
    if (p.endsWith("/access")) return Response.json({ allowed: true });
    if (p.endsWith("/collectibles")) return Response.json({ collectibles: options.catalog ?? [], hasMore: false });
    if (p === "/api/admin/missions") return Response.json({ missions: rows, hasMore: false, offset: 0, limit: 100 });
    if (p.endsWith("/rule-options")) return Response.json({ options: [{ eventType: "player.checked_in", sourceType: "PLAYER_CHECK_IN", label: "Check-in" }] });
    const m = rows.find(m => p.includes(m.missionId)) ?? rows[0] ?? mission;
    if (p.endsWith("/approval-contract")) return Response.json(contract(m, options.approved));
    if (p.endsWith("/readiness")) return Response.json(readiness(m, options.approved));
    if (p.endsWith("/tracking")) return Response.json(options.tracking ?? tracking);
    if (p.endsWith("/history")) return Response.json({ entries: [], hasMore: false });
    if (p === "/api/admin/missions/" + m.missionId) return Response.json(m);
    throw new Error("Unexpected mock request: " + p);
  });
  return { writes, reads };
}
async function click(text) { const b = [...document.querySelectorAll("button")].find(b => b.textContent === text); assert.ok(b, text); await act(async () => b.click()); }
async function open(m = mission) { await act(async () => document.querySelector('[aria-label="Open ' + m.title + '"]').click()); }
async function setValue(element, value) { assert.ok(element); await act(async () => { const proto = element.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : element.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(element, value); element.dispatchEvent(new window.Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true })); }); }
async function submit(selector) { await act(async () => document.querySelector(selector).dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))); }
test("library loads actual totals, statuses, objectives and exact proposed rewards without writes", async t => {
  const root = await setup(t), api = mockApi(t);
  await act(async () => root.render(createElement(MissionAdmin)));
  assert.ok(document.querySelector('[aria-label="Total missions: 1"]')); assert.ok(document.querySelector('[aria-label="Awaiting approval: 1"]'));
  const card = document.querySelector('[aria-label="Mission definitions"]'); assert.match(card.textContent, /Daily Check-In/); assert.match(card.textContent, /10 XP/); assert.doesNotMatch(card.textContent, /player.checked_in|10000000|configurationDigest/); assert.equal(api.writes.length, 0);
});
test("authorization denial stops before list, forms and mutations", async t => {
  const root = await setup(t); const api = mockApi(t, [], { override: p => p.endsWith("/access") ? Response.json({ code: "FORBIDDEN", message: "Forbidden" }, { status: 403 }) : null });
  await act(async () => root.render(createElement(MissionAdmin))); assert.equal(api.reads.length, 1); assert.match(document.querySelector('[role="alert"]').textContent, /SUPER_ADMIN/); assert.equal(document.querySelector("form"), null);
});
test("review failures show unknown summary values rather than fabricated readiness", async t => {
  const root = await setup(t); mockApi(t, [mission], { override: p => p.endsWith("/readiness") ? Response.json({ message: "Offline" }, { status: 503 }) : null });
  await act(async () => root.render(createElement(MissionAdmin))); assert.ok(document.querySelector('[aria-label="Awaiting approval: not loaded"]')); assert.match(document.body.textContent, /Review not loaded/);
});
test("search, category and status filters use the complete real library", async t => {
  const root = await setup(t), weekly = { ...mission, missionId: "20000000-0000-4000-8000-000000000002", title: "Weekly Comeback", category: "WEEKLY", periodType: "WEEKLY" }; mockApi(t, [mission, weekly]);
  await act(async () => root.render(createElement(MissionAdmin))); await setValue(document.querySelector('input[type="search"]'), "Comeback");
  assert.equal(document.querySelectorAll(".mm-card").length, 1); assert.match(document.querySelector(".mm-card").textContent, /Weekly Comeback/);
  await setValue(document.querySelector('input[type="search"]'), ""); await setValue(document.querySelectorAll(".mm-filters select")[0], "DAILY"); assert.equal(document.querySelectorAll(".mm-card").length, 1);
  await setValue(document.querySelectorAll(".mm-filters select")[1], "ready"); assert.match(document.body.textContent, /No missions match/);
});
test("pagination shows nine cards per page and stable next/previous controls", async t => {
  const root = await setup(t); mockApi(t, Array.from({ length: 11 }, (_, i) => ({ ...mission, missionId: "10000000-0000-4000-8000-" + String(i + 1).padStart(12, "0"), title: "Mission " + i, displayOrder: i })));
  await act(async () => root.render(createElement(MissionAdmin))); assert.equal(document.querySelectorAll(".mm-card").length, 9); await click("Next"); assert.equal(document.querySelectorAll(".mm-card").length, 2); await click("Previous"); assert.equal(document.querySelectorAll(".mm-card").length, 9);
});
test("detail tabs prevent stacked forms, expose real preview and retain advanced data only in details", async t => {
  const root = await setup(t); mockApi(t); await act(async () => root.render(createElement(MissionAdmin))); await open();
  assert.ok(document.querySelector('[aria-label="Mission details"]')); assert.match(document.querySelector(".mm-player-preview").textContent, /Check in explicitly/); assert.equal(document.querySelector('[aria-label="Configure mission rewards"]'), null);
  await click("History & Advanced"); assert.ok(document.querySelector(".mm-advanced")); assert.equal(document.querySelector(".mm-advanced").open, false);
});
test("missing achievement currencies remain incomplete and no values are invented", async t => {
  const root = await setup(t), achievement = { ...mission, title: "First Submission", category: "ACHIEVEMENT", periodType: "LIFETIME", rewards: [] }; mockApi(t, [achievement]);
  await act(async () => root.render(createElement(MissionAdmin))); await open(achievement); await click("Rewards"); assert.match(document.body.textContent, /Reward configuration required/);
  await click("Configure rewards"); assert.equal(document.querySelector('input[name="xp"]'), null); assert.match(document.body.textContent, /INCOMPLETE/);
});
for (const field of ["xp", "synapsePoints"]) test("reward editor requires explicit valid " + field + " without copying prior values", async t => {
  const root = await setup(t), writes = []; await act(async () => root.render(createElement(MissionRewardEditor, { mission, busy: false, onSave: x => writes.push(x) }))); await click("Configure rewards");
  const name = field === "xp" ? "includeXp" : "includeSp"; await act(async () => document.querySelector('input[name="' + name + '"]').click());
  assert.equal(document.querySelector('input[name="' + field + '"]').value, ""); await submit('form'); assert.equal(writes.length, 0);
  for (const value of ["0", "-1", "1.5", "2147483648"]) { await setValue(document.querySelector('input[name="' + field + '"]'), value); await submit("form"); assert.equal(writes.length, 0); }
  await setValue(document.querySelector('input[name="' + field + '"]'), "12"); await submit("form"); assert.deepEqual(writes, [{ xp: field === "xp" ? 12 : null, synapsePoints: field === "synapsePoints" ? 12 : null, expectedUpdatedAt: mission.updatedAt }]);
});
test("UTC calendar controls serialize UTC independently of browser local timezone", async t => {
  const root = await setup(t), writes = []; await act(async () => root.render(createElement(MissionScheduleEditor, { mission, busy: false, onSave: x => writes.push(x) }))); await click("Configure schedule");
  await setValue(document.querySelector('input[name="startsAt"]'), "2030-02-01T00:00"); await setValue(document.querySelector('input[name="endsAt"]'), "2030-02-02T00:00"); await submit("form");
  assert.equal(writes[0].startsAt, "2030-02-01T00:00:00.000Z"); assert.equal(writes[0].claimDeadline, null);
});
test("contradictory UTC windows are rejected in the editor", async t => {
  const root = await setup(t), writes = []; await act(async () => root.render(createElement(MissionScheduleEditor, { mission, busy: false, onSave: x => writes.push(x) }))); await click("Configure schedule");
  await setValue(document.querySelector('input[name="startsAt"]'), "2030-02-02T00:00"); await setValue(document.querySelector('input[name="endsAt"]'), "2030-02-01T00:00"); await submit("form"); assert.equal(writes.length, 0);
});
for (const category of ["PRODUCT", "REWARD_BUDGET"]) test(category + " approval remains individual, explicit and bound to server revision/digest", async t => {
  const root = await setup(t), writes = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => { writes.push(JSON.parse(init.body)); return Response.json(contract()); });
  await act(async () => root.render(createElement(MissionApprovalContract, { missionId: mission.missionId, revision: mission.updatedAt, initialReport: contract(), busy: false })));
  const label = category === "PRODUCT" ? "product" : "reward budget", button = [...document.querySelectorAll("button")].find(b => b.textContent === "Approve " + label);
  assert.equal(button.disabled, true); await act(async () => document.querySelector('[aria-label="Confirm ' + label + ' approval"]').click()); await click("Approve " + label);
  assert.equal(writes.length, 1); assert.deepEqual(writes[0], { expectedUpdatedAt: mission.updatedAt, configurationDigest: "a".repeat(64), expectedApprovalId: null, expectedRevocationId: null }); assert.ok(!("actor" in writes[0]));
});
test("stale approval report has no approval controls", async t => {
  const root = await setup(t), c = contract(); c.binding.approvedConfigurationRevision = "2020-01-01T00:00:00Z";
  await act(async () => root.render(createElement(MissionApprovalContract, { missionId: mission.missionId, revision: mission.updatedAt, initialReport: c, busy: false }))); assert.equal(document.querySelector('input[type="checkbox"]'), null); assert.match(document.body.textContent, /mission has changed/);
});
test("revision rejection preserves unsaved metadata and presents actionable refresh", async t => {
  const root = await setup(t); mockApi(t, [mission], { override: (_p, init) => init.method === "PATCH" ? Response.json({ code: "MISSION_REVISION_CONFLICT", message: "stale" }, { status: 409 }) : null });
  await act(async () => root.render(createElement(MissionAdmin))); await open(); await setValue(document.querySelector('input[name="title"]'), "Unsaved");
  await submit('[aria-label="Mission metadata"]'); assert.equal(document.querySelector('input[name="title"]').value, "Unsaved"); assert.match(document.querySelector('[role="alert"]').textContent, /Reload its details/);
});
test("new drafts send metadata only and use the server-confirmed inactive response", async t => {
  const root = await setup(t), api = mockApi(t); await act(async () => root.render(createElement(MissionAdmin))); await click("Create New Mission");
  await setValue(document.querySelector('input[name="title"]'), "New draft"); await setValue(document.querySelector('select[name="category"]'), "ACHIEVEMENT"); await submit('[aria-label="Create mission draft"]');
  assert.equal(api.writes.length, 1); assert.deepEqual(api.writes[0].body, { title: "New draft", description: "", category: "ACHIEVEMENT", displayOrder: 0 }); assert.match(document.body.textContent, /Inactive draft created/);
});
test("review queue supports navigation without blanket approvals or writes", async t => {
  const root = await setup(t), second = { ...mission, title: "Weekly Comeback", missionId: "20000000-0000-4000-8000-000000000002" }, api = mockApi(t, [mission, second]);
  await act(async () => root.render(createElement(MissionAdmin))); await click("Review Pending Missions"); await open(); await click("Next review");
  assert.equal(document.querySelector('[aria-label="Mission details"] h2').textContent, second.title); assert.equal(api.writes.length, 0); assert.doesNotMatch(document.body.textContent, /Approve all/);
});
async function lifecycle(t, approved = true, extra = {}) {
  const root = await setup(t), api = mockApi(t, [extra.mission ?? mission], { approved, override: extra.override });
  await act(async () => root.render(createElement(MissionLifecycleControls, { mission: extra.mission ?? mission, busy: false, onBusy: () => {}, onChanged: async () => {} })));
  await click(extra.mission?.active ? "Review deactivation" : "Review activation"); return api;
}
test("activation dialog summarizes exact rewards and traps focus, Cancel performs no mutation", async t => {
  const api = await lifecycle(t); const dialog = document.querySelector("dialog");
  assert.match(dialog.textContent, /10 XP/); assert.match(dialog.textContent, /Daily Check-In/); assert.equal(document.activeElement.textContent, "Cancel");
  const first = dialog.querySelector('input'), last = [...dialog.querySelectorAll("button:not(:disabled)")].at(-1); await act(async () => first.focus()); await act(async () => first.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }))); assert.equal(document.activeElement, last);
  await click("Cancel"); assert.equal(document.querySelector("dialog"), null); assert.equal(api.writes.length, 0); assert.equal(document.activeElement.textContent, "Review activation");
});
test("activation requires explicit checkbox and sends the exact binding with idempotency", async t => {
  const api = await lifecycle(t); assert.equal([...document.querySelectorAll("button")].find(b => b.textContent === "Activate mission").disabled, true);
  await act(async () => document.querySelector('dialog input').click()); await click("Activate mission"); assert.equal(api.writes.length, 1);
  assert.equal(api.writes[0].body.configurationDigest, "a".repeat(64)); assert.equal(api.writes[0].body.expectedUpdatedAt, mission.updatedAt); assert.match(api.writes[0].body.idempotencyKey, /^[0-9a-f-]{36}$/);
});
test("server-blocked activation cannot be confirmed and performs no mutation", async t => {
  const api = await lifecycle(t, false); const checkbox = document.querySelector("dialog input"); assert.equal(checkbox.disabled, true); await click("Activate mission"); assert.equal(api.writes.length, 0);
});
test("stale readiness prevents activation even with approved contract", async t => {
  const api = await lifecycle(t, true, { override: p => p.endsWith("/readiness") ? Response.json({ ...readiness(mission, true), missionRevision: "2020-01-01T00:00:00Z" }) : null });
  assert.equal(document.querySelector("dialog input").disabled, true); assert.match(document.querySelector("dialog").textContent, /stale/); assert.equal(api.writes.length, 0);
});
test("Escape closes the activation dialog and returns focus without a write", async t => {
  const api = await lifecycle(t); await act(async () => document.querySelector("dialog").dispatchEvent(new window.Event("cancel", { cancelable: true }))); assert.equal(document.querySelector("dialog"), null); assert.equal(api.writes.length, 0);
});
test("deactivation explicitly preserves earned records and original deadlines", async t => {
  const active = { ...mission, active: true, lifecycle: "ACTIVE" }, api = await lifecycle(t, false, { mission: active });
  assert.match(document.querySelector("dialog").textContent, /original|Existing claim deadlines/); await act(async () => document.querySelector("dialog input").click()); await click("Deactivate mission"); assert.equal(api.writes[0].path.endsWith("/deactivate"), true);
});
test("tab keyboard navigation uses arrows, Home and End with roving focus", async t => {
  const root = await setup(t); let value = "Overview";
  const render = () => root.render(createElement(MissionManagerTabs, { tabs: ["Overview", "Rewards", "Approvals"], label: "Sections", value, onChange: v => { value = v; render(); } }));
  await act(async () => render()); const buttons = document.querySelectorAll('[role="tab"]');
  await act(async () => buttons[0].dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true })));
  assert.equal(value, "Approvals"); assert.equal(document.activeElement, buttons[2]); assert.equal(buttons[0].tabIndex, -1);
});
test("distinct-mission selector uses names and preserves exact UUIDs in the API payload", async t => {
  const root = await setup(t), aggregate = { ...mission, periodType: "WEEKLY", rule: { ...mission.rule, eventType: "mission.completed", targetCount: 1 } }, source = { ...mission, missionId: "20000000-0000-4000-8000-000000000002" }, writes = [];
  mockApi(t); await act(async () => root.render(createElement(MissionTrackingEditor, { mission: aggregate, missions: [source], catalog: [], busy: false, onSave: v => writes.push(v) }))); await click("Edit tracking & collectible");
  await setValue(document.querySelector('select[name="mode"]'), "DISTINCT_MISSIONS"); await act(async () => document.querySelector('.mm-choice-list input').click()); await submit("form");
  assert.deepEqual(writes[0].eligibleMissionIds, [source.missionId]); assert.doesNotMatch(document.querySelector(".mm-choice-list").textContent, /20000000/);
});
test("collectible preview uses actual catalog name, artwork and association", async t => {
  const root = await setup(t), asset = { rewardDefinitionId: "30000000-0000-4000-8000-000000000003", name: "First Steps", code: "mission-first-steps", rewardType: "BADGE", imageUrl: "/rewards/missions/first-steps.svg", active: true };
  mockApi(t, [mission], { catalog: [asset], tracking: { ...tracking, collectibleId: asset.rewardDefinitionId } }); await act(async () => root.render(createElement(MissionAdmin))); assert.match(document.querySelector(".mm-card").textContent, /First Steps/); assert.equal(document.querySelector(".mm-card img").getAttribute("src"), asset.imageUrl);
});
test("unchanged active mission remains visible and configuration edits remain disabled", async t => {
  const root = await setup(t), active = { ...mission, title: "Start Your Circle", active: true, lifecycle: "ACTIVE", rule: { ...mission.rule, eventType: "puzzle.added" } }, api = mockApi(t, [active]);
  await act(async () => root.render(createElement(MissionAdmin))); await open(active); assert.match(document.body.textContent,/Valid definition \(active\)/); assert.equal(document.querySelector('[aria-label="Mission metadata"] fieldset').disabled, true);
  await click("Save metadata"); assert.equal(api.writes.length, 0); await click("Objective & Tracking"); assert.equal([...document.querySelectorAll("button")].find(b => b.textContent === "Configure rule").disabled, true);
});
for (const [name, expected, m, i] of [
  ["unloaded", "unchecked", mission, undefined], ["pending", "approval", mission, inspection()], ["ready", "ready", mission, inspection(mission, true)],
  ["missing currency", "incomplete", { ...mission, rewards: [] }, inspection({ ...mission, rewards: [] })],
  ["active", "active", { ...mission, active: true }, undefined], ["stale", "unchecked", { ...mission, updatedAt: "2031-01-01T00:00:00Z" }, inspection()],
]) test("status model: " + name, () => assert.equal(model.missionGroup(m, i), expected));
test("sorting uses stable mission-ID tie breaks and literal case-insensitive search", () => {
  const second = { ...mission, missionId: "20000000-0000-4000-8000-000000000002" }; assert.deepEqual(model.filterMissions([second, mission], {}, "CHECK-IN", "DAILY", "", "name").map(m => m.missionId), [mission.missionId, second.missionId]);
});
test("deactivated status requires actual lifecycle history instead of guessing from inactivity", () => {
  assert.equal(model.filterMissions([mission], { [mission.missionId]: inspection() }, "", "", "deactivated", "name").length, 0);
  const i = { ...inspection(), lastLifecycleAction: "MISSION_DEACTIVATED" }; assert.equal(model.filterMissions([mission], { [mission.missionId]: i }, "", "", "deactivated", "name").length, 1);
});
test("technical error codes map to clear recovery actions", () => {
  assert.match(model.friendlyIssue("MISSION_REVISION_CONFLICT"), /Reload/); assert.match(model.friendlyIssue("REWARD_BUDGET_APPROVAL"), /exact reward budget/); assert.match(model.friendlyIssue("FORBIDDEN"), /SUPER_ADMIN/);
});

test("pending draft creation cannot submit twice and retains only the original explicit request", async t => {
  const root = await setup(t); let count = 0, resolve;
  mockApi(t, [], { override: (p, init) => p === "/api/admin/missions" && init.method === "POST" ? (count++, new Promise(done => { resolve = () => done(Response.json({ ...mission, title: "Pending draft" }, { status: 201 })); })) : null });
  await act(async () => root.render(createElement(MissionAdmin))); await click("Create New Mission");
  await setValue(document.querySelector('input[name="title"]'), "Pending draft"); await setValue(document.querySelector('select[name="category"]'), "DAILY");
  await submit('[aria-label="Create mission draft"]'); await submit('[aria-label="Create mission draft"]'); assert.equal(count, 1); await act(async () => resolve());
});
test("pending approval cannot be posted twice", async t => {
  const root = await setup(t); let count = 0, resolve;
  t.mock.method(globalThis, "fetch", async () => { count++; return new Promise(done => { resolve = () => done(Response.json(contract())); }); });
  await act(async () => root.render(createElement(MissionApprovalContract, { missionId: mission.missionId, revision: mission.updatedAt, initialReport: contract(), busy: false })));
  await act(async () => document.querySelector('[aria-label="Confirm product approval"]').click()); const button=[...document.querySelectorAll("button")].find(b=>b.textContent==="Approve product"); await act(async()=>{button.click();button.click();});
  assert.equal(count, 1); await act(async () => resolve());
});
test("a single approved category cannot make activation ready", () => {
  const i = inspection(mission, true); i.approval.categories = [i.approval.categories[0]];
  assert.notEqual(model.missionGroup(mission, i), "ready");
});
test("complete library pagination is loaded before totals are returned", async t => {
  const controller = new AbortController(), other = { ...mission, missionId: "20000000-0000-4000-8000-000000000002" }; const offsets = [];
  t.mock.method(globalThis, "fetch", async url => { const offset = new URL(url).searchParams.get("offset"); offsets.push(offset); return Response.json({ missions: offset === "0" ? [mission] : [other], hasMore: offset === "0" }); });
  const rows = await model.loadMissionLibrary(controller.signal); assert.equal(rows.length, 2); assert.deepEqual(offsets, ["0", "100"]);
});
test("list pagination drift fails rather than displaying a fabricated total", async t => {
  t.mock.method(globalThis, "fetch", async url => Response.json({ missions: [mission], hasMore: new URL(url).searchParams.get("offset") === "0" }));
  await assert.rejects(model.loadMissionLibrary(new AbortController().signal), /list changed/);
});
test("empty library explains the state and never invents a sample mission", async t => {
  const root = await setup(t), api = mockApi(t, []); await act(async () => root.render(createElement(MissionAdmin)));
  assert.ok(document.querySelector('[aria-label="Total missions: 0"]')); assert.match(document.body.textContent, /No missions match/); assert.equal(api.writes.length, 0);
});

test("passed readiness explains verified success instead of asking for an already-completed approval", () => {
  assert.equal(model.readinessMessage({code:"REWARD_BUDGET_APPROVAL_MISSING",status:"PASS",message:"Backend pass"}),"The exact current reward budget is approved.");
  assert.match(model.readinessMessage({code:"REWARD_BUDGET_APPROVAL_MISSING",status:"BLOCKED",message:"Backend blocked"}),/Review and approve/);
});

for (const [name, mutate] of [
  ["missing readiness", i => { i.readiness = null; }],
  ["another mission readiness with identical revision", i => { i.readiness.missionId = "20000000-0000-4000-8000-000000000002"; }],
  ["stale readiness revision", i => { i.readiness.missionRevision = "2020-01-01T00:00:00Z"; }],
  ["truthy nonboolean activation flag", i => { i.readiness.activationReady = "true"; }],
  ["blocked check with contradictory ready flag", i => { i.readiness.checks[0].status = "BLOCKED"; }],
  ["missing readiness checklist", i => { delete i.readiness.checks; }],
  ["blocked overall status", i => { i.readiness.overallStatus = "BLOCKED"; }],
  ["missing product approval record", i => { i.approval.categories[0].recordedApproval = null; }],
  ["missing budget approval record", i => { i.approval.categories[1].recordedApproval = null; }],
  ["different approval revision", i => { i.approval.categories[0].recordedApproval.approvedConfigurationRevision = "2020-01-01T00:00:00Z"; }],
  ["different approval digest", i => { i.approval.categories[1].recordedApproval.configurationDigest = "b".repeat(64); }],
  ["different approved mission", i => { i.approval.categories[0].recordedApproval.missionId = "20000000-0000-4000-8000-000000000002"; }],
  ["wrong approval category", i => { i.approval.categories[1].recordedApproval.approvalCategory = "PRODUCT"; }],
  ["revoked approval", i => { i.approval.categories[0].recordedApproval.revocationId = "4"; }],
  ["mismatched approved reward amount", i => { i.approval.categories[1].recordedApproval.synapsePoints = 999; }],
  ["mismatched current reward contract", i => { i.approval.rewards.xp = 999; }],
  ["duplicate category instead of two independent approvals", i => { i.approval.categories[1] = i.approval.categories[0]; }],
]) test("never ready: " + name, () => {
  const i = inspection(mission, true); mutate(i);
  assert.equal(model.activationAllowed(mission, i.readiness, i.approval), false);
  assert.notEqual(model.missionGroup(mission, i), "ready");
});
test("another mission readiness cannot authorize the activation modal even with matching timestamps", async t => {
  const api = await lifecycle(t, true, { override: p => p.endsWith("/readiness") ? Response.json({ ...readiness(mission, true), missionId: "20000000-0000-4000-8000-000000000002" }) : null });
  assert.equal(document.querySelector("dialog input").disabled, true);
  assert.match(document.querySelector("dialog").textContent, /stale/);
  assert.equal(api.writes.length, 0);
});
test("missing readiness report fails visibly without an activation dialog or write", async t => {
  const api = await lifecycle(t, true, { override: p => p.endsWith("/readiness") ? Response.json(null) : null });
  assert.equal(document.querySelector("dialog"), null);
  assert.match(document.querySelector('[role="alert"]').textContent, /report is incomplete/);
  assert.equal(api.writes.length, 0);
});
