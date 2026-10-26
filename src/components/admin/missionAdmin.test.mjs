import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

process.env.NEXT_PUBLIC_DATA_MODE = "api";
process.env.NEXT_PUBLIC_API_BASE_URL = "https://hub.example.test";
const { MissionAdmin } = await import("./MissionAdmin.tsx");
const { CatalogAdminBoundary } = await import("./CatalogAdminBoundary.tsx");
const { usePlayerUiState } = await import("../../stores/playerUiState.ts");
const mission = { missionId: "10000000-0000-4000-8000-000000000001", title: "Synthetic daily", description: "Test description", category: "DAILY", periodType: "DAILY", active: false, displayOrder: 0, updatedAt: "2030-01-01T00:00:00.000Z", startsAt: null, endsAt: null, claimDeadline: null, activationEffectiveAt: "2030-01-01T00:00:00.000Z", lifecycle: "INACTIVE", configurationIssues: [], rule: { eventType: "puzzle.added", targetCount: 2, sourceType: null, puzzleId: null, levelId: null, conditions: {}, active: true }, rewards: [{ rewardType: "XP", amount: 1, active: true }] };
const page = (rows = [mission], hasMore = false) => ({ missions: rows, offset: 0, limit: 25, hasMore });
const approvalContract = (revision = mission.updatedAt) => ({ binding: { missionId: mission.missionId, approvedConfigurationRevision: revision, configurationDigest: "a".repeat(64) }, evaluatedAt: "2030-01-01T12:00:00.000Z", missionInactive: true, recordingEnabled: true, allowsActivation: false, rewards: { xp: 1, synapsePoints: 0 }, categories: ["PRODUCT", "REWARD_BUDGET"].map(category => ({ category, status: "MISSING", recordedApproval: null, requiredDecisions: [] })), recordContract: { requiredFields: [], actorSource: "AUTHENTICATED_SERVER_SESSION", timestampSource: "SERVER_UTC", auditRequirement: "SAME_TRANSACTION_AS_APPROVAL", freshnessRequirement: "REVISION_AND_DIGEST_MUST_MATCH" } });

test("capacity inspection preserves expired pending evidence and recovery requires reason plus explicit authorization", async t => {
  const root = await setup(t), writes = [];
  const row = { exceptionId: "20000000-0000-4000-8000-000000000001", missionId: mission.missionId, playerId: "synthetic-player", progressId: "synthetic-progress", periodKey: "2020-02-10", arrivedAt: "2020-02-10T12:00:00Z", recordedAt: "2020-02-10T12:00:01Z", claimDeadline: "2020-02-10T12:00:01Z", xp: 7, synapsePoints: 3, digest: "a".repeat(64), status: "PENDING", revision: "1", history: [{ eventId: "1", action: "OPENED", actorAdminUserId: null, occurredAt: "2020-02-10T12:00:01Z", reason: "Capacity blocked", errorCode: "SP_BALANCE_LIMIT_EXCEEDED", claimId: null }] };
  mockFetch(t, async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (init.method === "POST") { writes.push(JSON.parse(init.body)); return Response.json({ ...row, status: "RECOVERED", revision: "2", history: [...row.history, { ...row.history[0], eventId: "2", action: "RECOVERED", actorAdminUserId: "server-admin", reason: "Reviewed original reward" }] }); }
    return Response.json(path.endsWith("/capacity-exceptions") ? { entries: [row], hasMore: false } : path.endsWith(mission.missionId) ? mission : page());
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Inspect capacity exceptions");
  const section = document.querySelector('[aria-label="Mission capacity exceptions"]');
  assert.match(section.textContent, /2020-02-10T12:00:01Z/); assert.match(section.textContent, /7 XP \/ 3 SP/);
  const button = [...section.querySelectorAll("button")].find(b => b.textContent === "Authorize exact recovery"); assert.ok(button.disabled);
  await act(async () => {
    const input = section.querySelector("textarea"); const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set; setter.call(input, "Reviewed original reward"); input.dispatchEvent(new window.Event("input", { bubbles: true })); input.dispatchEvent(new window.Event("change", { bubbles: true }));
    section.querySelector('input[type="checkbox"]').click();
  });
  await act(async () => section.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
  assert.equal(writes.length, 1); assert.deepEqual(Object.keys(writes[0]).sort(), ["digest", "expectedEventId", "idempotencyKey", "reason"]);
  assert.match(section.textContent, /RECOVERED/); assert.equal(section.querySelector("form"), null);
});

test("lifecycle review shows a confirmation dialog and readiness blocker, never posts activation", async t => {
  const root = await setup(t), writes = [];
  mockFetch(t, async (url, init = {}) => {
    const path = new URL(url).pathname; if (init.method === "POST") writes.push(path);
    const contract = approvalContract(); contract.categories.forEach(category => { category.status = "APPROVED"; });
    const report = readiness(); report.checks = [{ code: "CHEST_LINK_REVIEW", status: "BLOCKED", category: "PRODUCT", field: "claimDeadline", message: "Enabled chest links require separate review." }];
    return Response.json(path.endsWith("/approval-contract") ? contract : path.endsWith("/readiness") ? report : path.endsWith(mission.missionId) ? mission : page());
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily");
  assert.equal(document.querySelector("dialog"), null); await click("Review activation");
  const dialog = document.querySelector("dialog"); assert.ok(dialog.open); assert.match(dialog.textContent, /CHEST_LINK_REVIEW/);
  assert.ok([...dialog.querySelectorAll("button")].find(button => button.textContent === "Confirm activation").disabled);
  await click("Confirm activation"); assert.deepEqual(writes, []);
  await click("Cancel lifecycle change"); assert.equal(document.querySelector("dialog"), null);
});

test("deactivation requires explicit confirmation, posts revision/digest/key only and refreshes details", async t => {
  const root = await setup(t), writes = []; let current = { ...mission, active: true, lifecycle: "ACTIVE" };
  mockFetch(t, async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (init.method === "POST") { writes.push(JSON.parse(init.body)); current = { ...current, active: false, lifecycle: "INACTIVE", updatedAt: "2030-01-02T00:00:00.000Z" }; return Response.json({ active: false }); }
    return Response.json(path.endsWith("/approval-contract") ? { ...approvalContract(), missionInactive: false } : path.endsWith(mission.missionId) ? current : page([current]));
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Review deactivation");
  const dialog = document.querySelector("dialog"), button = [...dialog.querySelectorAll("button")].find(button => button.textContent === "Confirm deactivation");
  assert.equal(button.disabled, true); assert.match(dialog.textContent, /Earned progress, frozen rewards, claim history and existing claim deadlines are preserved/);
  await act(async () => dialog.querySelector('input[type="checkbox"]').click()); assert.equal(button.disabled, false);
  await click("Confirm deactivation"); assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]).sort(), ["configurationDigest", "expectedUpdatedAt", "idempotencyKey"]);
  assert.equal(writes[0].expectedUpdatedAt, mission.updatedAt); assert.equal(writes[0].configurationDigest, "a".repeat(64)); assert.match(writes[0].idempotencyKey, /^[a-f0-9-]{36}$/);
  assert.equal(document.querySelector("dialog"), null); assert.match(document.querySelector('[aria-label="Mission details"]').textContent, /Definition status: INACTIVE/);
});

test("stale lifecycle review disables confirmation and a conflict cannot be displayed as success", async t => {
  const root = await setup(t); let stale = true;
  mockFetch(t, async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (init.method === "POST") return Response.json({ code: "MISSION_REVISION_CONFLICT", message: "Mission changed on the server." }, { status: 409 });
    return Response.json(path.endsWith("/approval-contract") ? approvalContract(stale ? "2030-02-01T00:00:00.000Z" : mission.updatedAt) : path.endsWith(mission.missionId) ? { ...mission, active: true, lifecycle: "ACTIVE" } : page([{ ...mission, active: true, lifecycle: "ACTIVE" }]));
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Review deactivation");
  assert.match(document.querySelector("dialog").textContent, /reviewed revision is stale/);
  assert.ok([...document.querySelectorAll("dialog button")].find(button => button.textContent === "Confirm deactivation").disabled);
  await click("Cancel lifecycle change"); stale = false; await click("Review deactivation");
  await act(async () => document.querySelector('dialog input[type="checkbox"]').click()); await click("Confirm deactivation");
  assert.equal(document.querySelector("dialog"), null); assert.match(document.querySelector('[aria-label="Mission lifecycle controls"]').textContent, /Reload details and review again/);
  assert.match(document.querySelector('[aria-label="Mission details"]').textContent, /Definition status: ACTIVE/);
});

test("reloading details aborts a pending lifecycle review without offering stale controls", async t => {
  const root = await setup(t); let resolve, signal;
  mockFetch(t, async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/approval-contract")) { signal = init.signal; return new Promise(done => { resolve = () => done(Response.json(approvalContract())); }); }
    return Response.json(path.endsWith("/readiness") ? readiness() : path.endsWith(mission.missionId) ? mission : page());
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Review activation"); await click("Reload details");
  assert.equal(signal.aborted, true); await act(async () => resolve()); assert.equal(document.querySelector("dialog"), null);
});

test("approval inspection separates categories and requires confirmation before writes", async t => {
  const root = await setup(t), calls = [];
  mockFetch(t, async (url, init = {}) => { const path = new URL(url).pathname; calls.push({ path, method: init.method, body: init.body }); return Response.json(path.endsWith("/approval-contract") ? approvalContract() : path.endsWith(mission.missionId) ? mission : page()); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily");
  assert.equal(calls.some(call => call.path.endsWith("/approval-contract")), false);
  await click("Inspect approval contract");
  const section = document.querySelector('[aria-label="Mission approval contract"]');
  for (const text of ["Product approval: MISSING", "Reward-budget approval: MISSING", "Approval actions do not activate missions", mission.updatedAt, "a".repeat(64), "UTC", "1 XP / 0 SP"]) assert.ok(section.textContent.includes(text), text);
  assert.deepEqual([...section.querySelectorAll("button")].map(button => button.textContent), ["Inspect approval contract", "Grant product approval", "Grant reward-budget approval"]);
  assert.equal(section.querySelectorAll("input[type=checkbox]").length, 2);
  assert.equal([...section.querySelectorAll("button")].filter(button => button.disabled).length, 2);
  const call = calls.find(call => call.path.endsWith("/approval-contract")); assert.ok(call); assert.ok(call.method === undefined || call.method === "GET"); assert.equal(call.body, undefined);
});

test("approval contract from another revision is hidden", async t => {
  const root = await setup(t);
  mockFetch(t, async url => { const path = new URL(url).pathname; return Response.json(path.endsWith("/approval-contract") ? approvalContract("2030-02-01T00:00:00.000Z") : path.endsWith(mission.missionId) ? mission : page()); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Inspect approval contract");
  const section = document.querySelector('[aria-label="Mission approval contract"]');
  assert.match(section.querySelector('[role="alert"]').textContent, /Reload details/); assert.doesNotMatch(section.textContent, /Configuration SHA-256/);
});

test("approval contract failures do not fabricate an approval", async t => {
  const root = await setup(t);
  mockFetch(t, async url => { const path = new URL(url).pathname; return path.endsWith("/approval-contract") ? Response.json({ message: "Contract unavailable" }, { status: 503 }) : Response.json(path.endsWith(mission.missionId) ? mission : page()); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Inspect approval contract");
  const section = document.querySelector('[aria-label="Mission approval contract"]');
  assert.match(section.querySelector('[role="alert"]').textContent, /Contract unavailable/); assert.doesNotMatch(section.textContent, /Configuration SHA-256/);
});

test("configuration edits invalidate the inspected contract", async t => {
  const root = await setup(t); let saved = mission;
  mockFetch(t, async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (init.method === "PATCH") { saved = { ...mission, title: "Changed binding", updatedAt: "2030-01-02T00:00:00.000Z" }; return Response.json(saved); }
    return Response.json(path.endsWith("/approval-contract") ? approvalContract() : path.endsWith(mission.missionId) ? saved : page([saved]));
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Inspect approval contract");
  assert.match(document.querySelector('[aria-label="Mission approval contract"]').textContent, /Configuration SHA-256/);
  await submitMetadata({ title: "Changed binding" });
  assert.match(document.querySelector('[aria-label="Mission approval contract"]').textContent, /No contract inspected/);
});

test("reload aborts pending contract reads and ignores late results", async t => {
  const root = await setup(t); let resolve, signal;
  mockFetch(t, async (url, init = {}) => { const path = new URL(url).pathname; if (path.endsWith("/approval-contract")) { signal = init.signal; return new Promise(done => { resolve = () => done(Response.json(approvalContract())); }); } return Response.json(path.endsWith(mission.missionId) ? mission : page()); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Inspect approval contract");
  await click("Reload details"); assert.equal(signal.aborted, true); await act(async () => resolve());
  const section = document.querySelector('[aria-label="Mission approval contract"]'); assert.match(section.textContent, /No contract inspected/); assert.doesNotMatch(section.textContent, /Configuration SHA-256/);
});
function mockFetch(t, handler) { return t.mock.method(globalThis, "fetch", async (url, init) => new URL(url).pathname.endsWith("/history") ? Response.json({ entries: [], limit: 25, offset: 0, hasMore: false }) : handler(url, init)); }
async function setup(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hub.example.test/admin/missions" });
  const keys = ["window", "self", "document", "HTMLElement", "Element", "SVGElement", "FormData", "IS_REACT_ACT_ENVIRONMENT"];
  const saved = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key] });
  usePlayerUiState.getState().clear();
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await act(async () => root.unmount()); usePlayerUiState.getState().clear(); dom.window.close(); for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  return root;
}
async function click(label) {
  const button = [...document.querySelectorAll("button")].find(node => node.textContent === label);
  assert.ok(button, label); await act(async () => button.click());
}
async function confirmApproval(label) {
  const checkbox = document.querySelector(`input[aria-label="${label}"]`); assert.ok(checkbox);
  await act(async () => checkbox.click());
}
function grantContract(contract, category) {
  return { ...contract, categories: contract.categories.map(item => item.category !== category ? item : { ...item, status: "APPROVED", recordedApproval: { ...contract.binding, approvalId: category === "PRODUCT" ? "1" : "2", approvalCategory: category, approverAdminUserId: "10000000-0000-4000-8000-000000000002", approvedAt: "2030-01-01T12:00:00.000Z", xp: 1, synapsePoints: 0, revocationId: null, revokedByAdminUserId: null, revokedAt: null } }) };
}
test("confirmed product approval sends only the binding and loaded state, refreshes history and invalidates readiness", async t => {
  const root = await setup(t), writes = []; let historyReads = 0, contract = approvalContract();
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/history")) { historyReads++; return Response.json({ entries: [], limit: 25, offset: 0, hasMore: false }); }
    if (init.method === "POST") { writes.push(JSON.parse(init.body)); contract = grantContract(contract, "PRODUCT"); return Response.json(contract); }
    return Response.json(path.endsWith("/approval-contract") ? contract : path.endsWith("/readiness") ? readiness() : path.endsWith(mission.missionId) ? mission : page());
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Check readiness"); await click("Inspect approval contract");
  await click("Grant product approval"); assert.equal(writes.length, 0);
  await confirmApproval("Confirm product approval"); await click("Grant product approval");
  assert.deepEqual(writes, [{ expectedUpdatedAt: mission.updatedAt, configurationDigest: "a".repeat(64), expectedApprovalId: null, expectedRevocationId: null }]);
  assert.match(document.querySelector('[aria-label="Mission approval contract"]').textContent, /Product approval: APPROVED/);
  assert.match(document.querySelector('[aria-label="Activation Readiness"]').textContent, /No preview calculated/); assert.equal(historyReads, 2);
});
test("budget approval remains independent and revocation sends the exact recorded approval ID", async t => {
  const root = await setup(t), paths = [], bodies = []; let contract = grantContract(approvalContract(), "PRODUCT");
  mockFetch(t, async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (init.method === "POST") {
      paths.push(path); bodies.push(JSON.parse(init.body));
      contract = path.endsWith("/revoke") ? { ...contract, categories: contract.categories.map(item => item.category === "PRODUCT" ? { ...item, status: "REVOKED", recordedApproval: { ...item.recordedApproval, revocationId: "1", revokedByAdminUserId: "server-admin", revokedAt: "2030-01-02T00:00:00.000Z" } } : item) } : grantContract(contract, "REWARD_BUDGET");
      return Response.json(contract);
    }
    return Response.json(path.endsWith("/approval-contract") ? contract : path.endsWith(mission.missionId) ? mission : page());
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Inspect approval contract");
  await confirmApproval("Confirm reward-budget approval"); await click("Grant reward-budget approval");
  await confirmApproval("Confirm product revocation"); await click("Revoke product approval");
  assert.ok(paths[0].endsWith("/approvals/REWARD_BUDGET")); assert.ok(paths[1].endsWith("/approvals/PRODUCT/revoke"));
  assert.equal(bodies[1].expectedApprovalId, "1");
  const section = document.querySelector('[aria-label="Mission approval contract"]');
  assert.match(section.textContent, /Product approval: REVOKED/); assert.match(section.textContent, /Reward-budget approval: APPROVED/);
  assert.match(section.textContent, /Revoked by administrator server-admin/);
});
test("conflicting approval clears the stale contract instead of showing optimistic success", async t => {
  const root = await setup(t);
  mockFetch(t, async (url, init = {}) => {
    const path = new URL(url).pathname;
    return init.method === "POST" ? Response.json({ message: "Approval history changed. Reload before continuing." }, { status: 409 }) : Response.json(path.endsWith("/approval-contract") ? approvalContract() : path.endsWith(mission.missionId) ? mission : page());
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Inspect approval contract");
  await confirmApproval("Confirm product approval"); await click("Grant product approval");
  const section = document.querySelector('[aria-label="Mission approval contract"]');
  assert.match(section.querySelector('[role="alert"]').textContent, /history changed/); assert.doesNotMatch(section.textContent, /Product approval: APPROVED/);
  assert.equal(section.querySelector("input"), null);
});
test("pending approval cannot be sent twice or edit configuration while saving", async t => {
  const root = await setup(t); let count = 0, resolve;
  mockFetch(t, async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (init.method === "POST") { count++; return new Promise(done => { resolve = () => done(Response.json(grantContract(approvalContract(), "PRODUCT"))); }); }
    return Response.json(path.endsWith("/approval-contract") ? approvalContract() : path.endsWith(mission.missionId) ? mission : page());
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Inspect approval contract"); await confirmApproval("Confirm product approval"); await click("Grant product approval");
  assert.equal([...document.querySelectorAll("button")].find(button => button.textContent === "Reload details").disabled, true);
  assert.equal(count, 1); await act(async () => resolve());
  assert.match(document.querySelector('[aria-label="Mission approval contract"]').textContent, /Product approval: APPROVED/);
});
test("active mission inspection permits revocation of an invalidated record but offers no grant or activation", async t => {
  const root = await setup(t), active = { ...mission, active: true, lifecycle: "ACTIVE" };
  const contract = grantContract(approvalContract(), "PRODUCT"); contract.missionInactive = false; contract.recordingEnabled = false; contract.categories[0].status = "INVALIDATED";
  mockFetch(t, async url => { const path = new URL(url).pathname; return Response.json(path.endsWith("/approval-contract") ? contract : path.endsWith(mission.missionId) ? active : page([active])); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Inspect approval contract");
  const section = document.querySelector('[aria-label="Mission approval contract"]');
  assert.match(section.textContent, /Product approval: INVALIDATED/);
  assert.deepEqual([...section.querySelectorAll("button")].map(button => button.textContent), ["Inspect approval contract", "Revoke product approval"]);
  assert.match(section.textContent, /Approvals do not expire automatically/);
});
test("administrator history displays grant/revocation actions and exact before-after approval information", async t => {
  const root = await setup(t);
  const snapshot = { title: mission.title, description: "", category: "DAILY", periodType: "DAILY", active: false, displayOrder: 0, updatedAt: mission.updatedAt };
  t.mock.method(globalThis, "fetch", async url => {
    const path = new URL(url).pathname;
    if (path.endsWith("/history")) return Response.json({ entries: ["APPROVAL_GRANTED", "APPROVAL_REVOKED"].map((action, index) => ({ historyId: String(index + 1), missionId: mission.missionId, actorAdminUserId: "server-admin", action, occurredAt: mission.updatedAt, before: snapshot, after: { ...snapshot, approval: { category: "REWARD_BUDGET", status: index ? "REVOKED" : "APPROVED", xp: 1, synapsePoints: 0, digest: "a".repeat(64) } } })), offset: 0, limit: 25, hasMore: false });
    return Response.json(path.endsWith(mission.missionId) ? mission : page());
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily");
  const section = document.querySelector('[aria-label="Administrator change history"]');
  for (const text of ["Approval granted", "Approval revoked", "REWARD_BUDGET", '"xp": 1', '"synapsePoints": 0', "UTC", "server-admin"]) assert.ok(section.textContent.includes(text), text);
});
async function submitMetadata(fields) {
  const form = document.querySelector('input[name="title"]').form;
  for (const [key, value] of Object.entries(fields)) form.elements.namedItem(key).value = value;
  await act(async () => form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
}

const readiness = (revision = mission.updatedAt) => ({ missionId: mission.missionId, missionRevision: revision, evaluatedAt: "2030-01-01T12:00:00.000Z", configurationStatus: "PASS", overallStatus: "BLOCKED", activationReady: false, productApproval: "NOT_RECORDED", rewardSafety: { xp: 1, synapsePoints: 0, spWalletLimit: 2147483647, maximumSafeSpBalance: null, maximumSafeXpTotal: 9007199254740990, balancesInspected: false }, checks: [
  { code: "MISSION_INACTIVE", status: "PASS", category: "CONFIGURATION", field: "active", message: "The stored mission remains inactive." },
  { code: "REWARD_BUDGET_APPROVAL_MISSING", status: "BLOCKED", category: "PRODUCT", field: "rewards", message: "Storage limits are not an approved reward budget." },
  { code: "POINT_IN_TIME_ONLY", status: "WARNING", category: "ADVISORY", field: "missionRevision", message: "Recheck after persisted changes." },
] });
test("readiness is explicitly requested, renders all check statuses and offers no activation control", async t => {
  const root = await setup(t), calls = [];
  mockFetch(t, async (url, init = {}) => { const path = new URL(url).pathname; calls.push({ path, method: init.method, body: init.body }); return Response.json(path.endsWith("/readiness") ? readiness() : path.endsWith(mission.missionId) ? mission : page()); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily");
  const section = document.querySelector('[aria-label="Activation Readiness"]'); assert.ok(section); assert.match(section.textContent, /No preview calculated/);
  assert.equal(calls.some(call => call.path.endsWith("/readiness")), false);
  await click("Check readiness");
  assert.match(section.textContent, /Overall: BLOCKED. Configuration: PASS/);
  assert.match(section.textContent, /Product approval: not recorded/);
  for (const word of ["PASS", "BLOCKED", "WARNING", "REWARD_BUDGET_APPROVAL_MISSING", "Field: rewards", "Mission revision:", "UTC"]) assert.match(section.textContent, new RegExp(word));
  const call = calls.find(call => call.path.endsWith("/readiness")); assert.ok(call); assert.equal(call.method === undefined || call.method === "GET", true); assert.equal(call.body, undefined);
  assert.deepEqual([...section.querySelectorAll("button")].map(button => button.textContent), ["Check readiness"]);
});
test("readiness failure is explicit and never substitutes a fabricated PASS", async t => {
  const root = await setup(t);
  mockFetch(t, async url => { const path = new URL(url).pathname; return path.endsWith("/readiness") ? Response.json({ message: "Readiness unavailable" }, { status: 503 }) : Response.json(path.endsWith(mission.missionId) ? mission : page()); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Check readiness");
  const section = document.querySelector('[aria-label="Activation Readiness"]');
  assert.match(section.querySelector('[role="alert"]').textContent, /unavailable/); assert.equal(section.querySelector('[aria-label="Readiness checklist"]'), null);
});
test("a different readiness revision hides the checklist until mission details are reloaded", async t => {
  const root = await setup(t);
  mockFetch(t, async url => { const path = new URL(url).pathname; return Response.json(path.endsWith("/readiness") ? readiness("2030-01-02T00:00:00.000Z") : path.endsWith(mission.missionId) ? mission : page()); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Check readiness");
  const section = document.querySelector('[aria-label="Activation Readiness"]');
  assert.match(section.querySelector('[role="alert"]').textContent, /Reload details/); assert.equal(section.querySelector('[aria-label="Readiness checklist"]'), null);
});
test("a rejected concurrent save invalidates old readiness without discarding unsaved editor values", async t => {
  const root = await setup(t);
  mockFetch(t, async (url, init = {}) => {
    if (init.method === "PATCH") return Response.json({ code: "MISSION_REVISION_CONFLICT", message: "Mission changed. Reload details." }, { status: 409 });
    const path = new URL(url).pathname; return Response.json(path.endsWith("/readiness") ? readiness() : path.endsWith(mission.missionId) ? mission : page());
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Check readiness");
  assert.ok(document.querySelector('[aria-label="Readiness checklist"]'));
  await submitMetadata({ title: "Unsaved title" });
  assert.equal(document.querySelector('[aria-label="Readiness checklist"]'), null);
  assert.match(document.querySelector('[aria-label="Activation Readiness"]').textContent, /No preview calculated/);
  assert.equal(document.querySelector('input[name="title"]').value, "Unsaved title");
});
for (const kind of ["metadata", "rule", "schedule", "rewards"]) test(`persisted ${kind} edits invalidate readiness and the next check uses the new revision`, async t => {
  const root = await setup(t); let saved = mission, checks = 0;
  mockFetch(t, async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/readiness")) { checks++; return Response.json(readiness(saved.updatedAt)); }
    if (path.endsWith("/rule-options")) return Response.json(ruleOptions);
    if (init.method === "PATCH") { saved = { ...mission, updatedAt: "2030-01-02T00:00:00.000Z" }; return Response.json(saved); }
    return Response.json(path.endsWith(mission.missionId) ? saved : page([saved]));
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Check readiness");
  assert.ok(document.querySelector('[aria-label="Readiness checklist"]'));
  if (kind === "metadata") await submitMetadata({ title: "Synthetic rename" });
  if (kind === "rule") { await click("Configure rule"); await submitRule({ targetCount: "3" }); }
  if (kind === "schedule") { await click("Configure schedule"); await submitSchedule({ startsAt: "2030-02-11T00:00:00Z" }); }
  if (kind === "rewards") { await click("Configure rewards"); await selectRewardCurrency("includeXp"); await submitRewards({ xp: "9" }); }
  const section = document.querySelector('[aria-label="Activation Readiness"]');
  assert.match(section.textContent, /No preview calculated/); assert.equal(section.querySelector('[aria-label="Readiness checklist"]'), null);
  await click("Check readiness"); assert.equal(checks, 2); assert.match(section.textContent, /2030-01-02T00:00:00.000Z/);
});
test("pending readiness is not duplicated and a late old response cannot survive a saved edit", async t => {
  const root = await setup(t); let resolveCheck, checkSignal; let count = 0, saved = mission;
  mockFetch(t, async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/readiness")) { count++; checkSignal = init.signal; return new Promise(resolve => { resolveCheck = () => resolve(Response.json(readiness())); }); }
    if (init.method === "PATCH") { saved = { ...mission, updatedAt: "2030-01-02T00:00:00.000Z" }; return Response.json(saved); }
    return Response.json(path.endsWith(mission.missionId) ? saved : page([saved]));
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Check readiness"); await click("Checking readiness..."); assert.equal(count, 1);
  await submitMetadata({ title: "Synthetic rename" }); assert.equal(checkSignal.aborted, true);
  await act(async () => resolveCheck());
  assert.equal(document.querySelector('[aria-label="Readiness checklist"]'), null); assert.match(document.querySelector('[aria-label="Activation Readiness"]').textContent, /No preview calculated/);
});
test("readiness for an active mission reports a blocker without offering deactivation", async t => {
  const root = await setup(t), active = { ...mission, active: true, lifecycle: "ACTIVE" };
  const report = readiness(); report.configurationStatus = "BLOCKED"; report.checks[0] = { ...report.checks[0], status: "BLOCKED", message: "This definition is active; preview will not deactivate it." };
  mockFetch(t, async url => { const path = new URL(url).pathname; return Response.json(path.endsWith("/readiness") ? report : path.endsWith(mission.missionId) ? active : page([active])); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Check readiness");
  const section = document.querySelector('[aria-label="Activation Readiness"]'); assert.match(section.textContent, /will not deactivate/);
  assert.deepEqual([...section.querySelectorAll("button")].map(button => button.textContent), ["Check readiness"]);
});
test("readiness explanations are rendered as text, never HTML", async t => {
  const root = await setup(t), report = readiness(); report.checks[1].message = "<script>unsafe</script>";
  mockFetch(t, async url => { const path = new URL(url).pathname; return Response.json(path.endsWith("/readiness") ? report : path.endsWith(mission.missionId) ? mission : page()); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Check readiness");
  const section = document.querySelector('[aria-label="Activation Readiness"]'); assert.equal(section.querySelector("script"), null); assert.match(section.textContent, /<script>unsafe<\/script>/);
});

async function selectRewardCurrency(name, checked = true) {
  const element = document.querySelector(`form[aria-label="Configure mission rewards"] input[name="${name}"]`); assert.ok(element);
  if (element.checked !== checked) await act(async () => element.click());
}
async function submitRewards(fields = {}) {
  const form = document.querySelector('form[aria-label="Configure mission rewards"]'); assert.ok(form);
  for (const [key, value] of Object.entries(fields)) form.elements.namedItem(key).value = value;
  await act(async () => form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
}
test("reward editor never copies existing amounts and requires an explicit chosen amount", async t => {
  const root = await setup(t), writes = []; let saved = mission;
  mockFetch(t, async (url, init = {}) => {
    if (init.method) { const body = JSON.parse(init.body); writes.push({ path: new URL(url).pathname, body }); saved = { ...mission, rewards: [{ rewardType: "XP", amount: body.xp, active: true }], updatedAt: "2030-01-02T00:00:00.000Z" }; return Response.json(saved); }
    return Response.json(new URL(url).pathname.endsWith(mission.missionId) ? saved : page([saved]));
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure rewards");
  assert.equal(document.querySelector('input[name="includeXp"]').checked, false); assert.equal(document.querySelector('input[name="xp"]'), null);
  await submitRewards(); assert.match(document.querySelector('[role="alert"]').textContent, /Choose at least one currency/);
  await selectRewardCurrency("includeXp"); assert.equal(document.querySelector('input[name="xp"]').value, "");
  await submitRewards(); assert.match(document.querySelector('[role="alert"]').textContent, /Enter each selected reward explicitly/); assert.equal(writes.length, 0);
  await submitRewards({ xp: "1" });
  assert.deepEqual(writes, [{ path: `/api/admin/missions/${mission.missionId}/rewards`, body: { xp: 1, synapsePoints: null, expectedUpdatedAt: mission.updatedAt } }]);
  assert.match(document.body.textContent, /Mission reward configuration saved. Mission remains inactive/); assert.match(document.body.textContent, /Definition status: INACTIVE/);
});
test("accepts exact maximum XP/SP values without inventing reward fields or activating a draft", async t => {
  const root = await setup(t), empty = { ...mission, rule: null, rewards: [] }; const writes = [];
  mockFetch(t, async (url, init = {}) => {
    if (init.method) { writes.push(JSON.parse(init.body)); return Response.json({ ...empty, rewards: [{ rewardType: "XP", amount: writes[0].xp, active: true }, { rewardType: "SYNAPSE_POINTS", amount: writes[0].synapsePoints, active: true }], updatedAt: "2030-01-02T00:00:00Z" }); }
    return Response.json(new URL(url).pathname.endsWith(mission.missionId) ? empty : page([empty]));
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure rewards");
  await selectRewardCurrency("includeXp"); await selectRewardCurrency("includeSp");
  await submitRewards({ xp: "2147483647", synapsePoints: "2147483647" });
  assert.deepEqual(writes, [{ xp: 2147483647, synapsePoints: 2147483647, expectedUpdatedAt: mission.updatedAt }]);
  assert.match(document.body.textContent, /No rule configured/); assert.match(document.body.textContent, /Definition status: INACTIVE/);
});
test("SP-only replacement explicitly omits XP and uses only server-confirmed rewards", async t => {
  const root = await setup(t), writes = [];
  mockFetch(t, async (url, init = {}) => {
    if (init.method) { writes.push(JSON.parse(init.body)); return Response.json({ ...mission, rewards: [{ rewardType: "XP", amount: 1, active: false }, { rewardType: "SYNAPSE_POINTS", amount: 7, active: true }], updatedAt: "2030-01-02T00:00:00Z" }); }
    return Response.json(new URL(url).pathname.endsWith(mission.missionId) ? mission : page());
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure rewards"); await selectRewardCurrency("includeSp");
  await submitRewards({ synapsePoints: "7" });
  assert.deepEqual(writes, [{ xp: null, synapsePoints: 7, expectedUpdatedAt: mission.updatedAt }]);
  assert.match(document.body.textContent, /7 SYNAPSE_POINTS/);
});
test("invalid reward amounts stay editable and cannot reach the API", async t => {
  const root = await setup(t); let writes = 0;
  mockFetch(t, async (url, init = {}) => { if (init.method) writes++; return Response.json(new URL(url).pathname.endsWith(mission.missionId) ? mission : page()); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure rewards"); await selectRewardCurrency("includeXp"); await selectRewardCurrency("includeSp");
  for (const xp of ["", "0", "-1", "1.5", "2147483648"]) {
    await submitRewards({ xp, synapsePoints: "1" }); assert.match(document.querySelector('[role="alert"]').textContent, /positive whole amount/); assert.ok(document.querySelector('form[aria-label="Configure mission rewards"]'));
  }
  for (const synapsePoints of ["", "0", "-1", "1.5", "2147483648"]) {
    await submitRewards({ xp: "1", synapsePoints }); assert.match(document.querySelector('[role="alert"]').textContent, /positive whole amount/);
  }
  assert.equal(writes, 0);
});
test("unselecting a currency or reopening the reward editor never silently reuses its amount", async t => {
  const root = await setup(t);
  mockFetch(t, async url => Response.json(new URL(url).pathname.endsWith(mission.missionId) ? mission : page()));
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure rewards"); await selectRewardCurrency("includeXp");
  document.querySelector('input[name="xp"]').value = "42";
  await selectRewardCurrency("includeXp", false); await selectRewardCurrency("includeXp"); assert.equal(document.querySelector('input[name="xp"]').value, "");
  await click("Close reward editor"); await click("Configure rewards");
  assert.equal(document.querySelector('input[name="includeXp"]').checked, false); assert.equal(document.querySelector('input[name="xp"]'), null);
});
test("zero-reward behavior is explicit: omit one currency, but no all-zero or empty payable reward", async t => {
  const root = await setup(t);
  mockFetch(t, async url => Response.json(new URL(url).pathname.endsWith(mission.missionId) ? mission : page()));
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure rewards"); await submitRewards();
  assert.match(document.querySelector('[role="alert"]').textContent, /empty or all-zero payable reward/);
  assert.match(document.body.textContent, /Unselected currencies are omitted, not stored as zero/);
  assert.match(document.body.textContent, /new draft may remain unconfigured/);
  assert.match(document.body.textContent, /Previously earned reward snapshots and claims keep their original amounts/);
});
test("active definitions cannot open the reward editor or submit reward changes", async t => {
  const root = await setup(t), active = { ...mission, active: true, lifecycle: "ACTIVE" }; let writes = 0;
  mockFetch(t, async (url, init = {}) => { if (init.method) writes++; return Response.json(new URL(url).pathname.endsWith(mission.missionId) ? active : page([active])); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure rewards");
  assert.equal([...document.querySelectorAll("button")].find(button => button.textContent === "Configure rewards").disabled, true);
  assert.equal(document.querySelector('form[aria-label="Configure mission rewards"]'), null); assert.equal(writes, 0);
});
test("unsupported rewards remain read-only and cannot be overwritten by the XP/SP editor", async t => {
  const root = await setup(t), unsupported = { ...mission, rewards: [...mission.rewards, { rewardType: "COSMETIC", amount: 1, active: false }] }; let writes = 0;
  mockFetch(t, async (url, init = {}) => { if (init.method) writes++; return Response.json(new URL(url).pathname.endsWith(mission.missionId) ? unsupported : page([unsupported])); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure rewards");
  assert.match(document.body.textContent, /reward types outside this editor/); assert.equal(document.querySelector('form[aria-label="Configure mission rewards"]'), null); assert.equal(writes, 0);
});
test("stale reward edits retain explicitly entered amounts and reload requires fresh entry", async t => {
  const root = await setup(t);
  mockFetch(t, async (url, init = {}) => init.method ? Response.json({ code: "MISSION_REVISION_CONFLICT", message: "Mission changed. Reload its details before saving." }, { status: 409 }) : Response.json(new URL(url).pathname.endsWith(mission.missionId) ? mission : page()));
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure rewards"); await selectRewardCurrency("includeXp");
  await submitRewards({ xp: "9" });
  assert.match(document.querySelector('[role="alert"]').textContent, /Reload its details/); assert.equal(document.querySelector('input[name="xp"]').value, "9"); assert.doesNotMatch(document.body.textContent, /reward configuration saved/);
  await click("Reload details"); await click("Configure rewards"); await selectRewardCurrency("includeXp"); assert.equal(document.querySelector('input[name="xp"]').value, "");
});
test("server reward validation failures never fabricate saved rewards", async t => {
  const root = await setup(t);
  mockFetch(t, async (url, init = {}) => init.method ? Response.json({ code: "VALIDATION_FAILED", message: "Reward configuration rejected." }, { status: 400 }) : Response.json(new URL(url).pathname.endsWith(mission.missionId) ? mission : page()));
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure rewards"); await selectRewardCurrency("includeSp"); await submitRewards({ synapsePoints: "7" });
  assert.match(document.querySelector('[role="alert"]').textContent, /rejected/); assert.doesNotMatch(document.body.textContent, /reward configuration saved/); assert.equal(document.querySelector('input[name="synapsePoints"]').value, "7");
});
test("a pending reward save cannot submit twice", async t => {
  const root = await setup(t); let resolveSave; const writes = [];
  mockFetch(t, async (url, init = {}) => {
    if (init.method) { writes.push(JSON.parse(init.body)); return new Promise(resolve => { resolveSave = () => resolve(Response.json({ ...mission, rewards: [{ rewardType: "XP", amount: 9, active: true }], updatedAt: "2030-01-02T00:00:00Z" })); }); }
    return Response.json(new URL(url).pathname.endsWith(mission.missionId) ? mission : page());
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure rewards"); await selectRewardCurrency("includeXp");
  await submitRewards({ xp: "9" }); await submitRewards();
  assert.equal(writes.length, 1); assert.equal(document.querySelector('form[aria-label="Configure mission rewards"] fieldset').disabled, true);
  await act(async () => resolveSave()); assert.match(document.body.textContent, /Mission reward configuration saved/);
});
test("history labels reward changes and renders meaningful before/after amounts", async t => {
  const root = await setup(t);
  t.mock.method(globalThis, "fetch", async url => { const path = new URL(url).pathname; return Response.json(path.endsWith("/history") ? { entries: [{ historyId: "5", missionId: mission.missionId, actorAdminUserId: "synthetic-admin", action: "REWARDS_CONFIGURED", occurredAt: mission.updatedAt, before: { rewards: [] }, after: { rewards: [{ rewardType: "XP", amount: 9, active: true }] } }], hasMore: false, limit: 25, offset: 0 } : path.endsWith(mission.missionId) ? mission : page()); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily");
  const history = document.querySelector('[aria-label="Administrator change history"]');
  assert.match(history.textContent, /Rewards configured/); assert.match(history.textContent, /synthetic-admin/); assert.match(history.textContent, /UTC/); assert.match(history.textContent, /Before/); assert.match(history.textContent, /After/); assert.match(history.textContent, /"amount": 9/);
});

async function submitSchedule(fields = {}) {
  const form = document.querySelector('form[aria-label="Configure mission schedule"]'); assert.ok(form);
  for (const [key, value] of Object.entries(fields)) form.elements.namedItem(key).value = value;
  await act(async () => form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
}
test("saves UTC availability only with the loaded revision and keeps the definition inactive", async t => {
  const root = await setup(t), writes = []; let saved = mission;
  mockFetch(t, async (url, init = {}) => {
    if (init.method === "PATCH") { const body = JSON.parse(init.body); writes.push({ path: new URL(url).pathname, body }); saved = { ...mission, startsAt: body.startsAt, endsAt: body.endsAt, claimDeadline: body.claimDeadline, updatedAt: "2030-01-02T00:00:00.000Z" }; return Response.json(saved); }
    return Response.json(new URL(url).pathname.endsWith(mission.missionId) ? saved : page([saved]));
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure schedule");
  assert.match(document.body.textContent, /Existing event cutoff \(read-only\)/);
  assert.equal(document.querySelector('input[name="activationEffectiveAt"]'), null);
  assert.equal(document.querySelector('input[name="startsAt"]').type, "text");
  await submitSchedule({ startsAt: "2030-02-11T00:00:00Z", endsAt: "2030-02-12T00:00:00.1Z" });
  assert.deepEqual(writes, [{ path: `/api/admin/missions/${mission.missionId}/schedule`, body: { startsAt: "2030-02-11T00:00:00.000Z", endsAt: "2030-02-12T00:00:00.100Z", claimDeadline: null, expectedUpdatedAt: mission.updatedAt } }]);
  assert.match(document.body.textContent, /Mission schedule saved. Mission remains inactive/);
  assert.match(document.body.textContent, /Definition status: INACTIVE/);
  assert.match(document.body.textContent, /2030-02-11 00:00:00.000 UTC/);
});
test("fixed campaign windows are required and invalid windows retain editable inputs", async t => {
  const root = await setup(t), fixed = { ...mission, category: "EVENT", periodType: "FIXED" }; let writes = 0;
  mockFetch(t, async (url, init = {}) => { if (init.method) writes++; return Response.json(new URL(url).pathname.endsWith(mission.missionId) ? fixed : page([fixed])); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure schedule");
  assert.equal(document.querySelector('input[name="startsAt"]').required, true); assert.equal(document.querySelector('input[name="endsAt"]').required, true);
  await submitSchedule(); assert.match(document.querySelector('[role="alert"]').textContent, /require both/);
  await submitSchedule({ startsAt: "2030-02-12T00:00:00Z", endsAt: "2030-02-12T00:00:00Z" }); assert.match(document.querySelector('[role="alert"]').textContent, /end must be after start/);
  assert.ok(document.querySelector('form[aria-label="Configure mission schedule"]')); assert.equal(writes, 0);
});
test("UTC inputs reject invalid calendar dates, local times, offsets and lost precision", async t => {
  const root = await setup(t); let writes = 0;
  mockFetch(t, async (url, init = {}) => { if (init.method) writes++; return Response.json(new URL(url).pathname.endsWith(mission.missionId) ? mission : page()); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure schedule");
  for (const startsAt of ["2030-02-30T00:00:00Z", "2030-02-11T00:00:00", "2030-02-11T05:30:00+05:30", "2030-02-11T00:00:00.0001Z", "0000-01-01T00:00:00Z"]) {
    await submitSchedule({ startsAt }); assert.match(document.querySelector('[role="alert"]').textContent, /real ISO UTC dates/);
  }
  assert.equal(writes, 0);
});
test("daily and weekly boundaries, reward grace and chest grace are distinguished", async t => {
  const root = await setup(t), weekly = { ...mission, category: "WEEKLY", periodType: "WEEKLY" };
  mockFetch(t, async url => Response.json(new URL(url).pathname.endsWith(mission.missionId) ? weekly : page([weekly])));
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure schedule");
  assert.equal(document.querySelector('input[name="claimDeadline"]').disabled, true);
  assert.match(document.body.textContent, /Monday 00:00 UTC/);
  assert.match(document.body.textContent, /Availability does not shift daily or weekly period boundaries/);
  assert.match(document.body.textContent, /rewards expire 24 hours after their UTC period ends/);
  assert.match(document.body.textContent, /Chest grace is separate/);
  assert.match(document.body.textContent, /Existing earned snapshots keep their recorded deadlines/);
  assert.match(document.body.textContent, /future start never activates a mission automatically/);
});
test("fixed explicit deadlines cannot precede availability end, but can equal it", async t => {
  const root = await setup(t), fixed = { ...mission, category: "EVENT", periodType: "FIXED" }; const writes = [];
  mockFetch(t, async (url, init = {}) => {
    if (init.method) { writes.push(JSON.parse(init.body)); return Response.json({ ...fixed, ...writes[0], updatedAt: "2030-01-02T00:00:00Z" }); }
    return Response.json(new URL(url).pathname.endsWith(mission.missionId) ? fixed : page([fixed]));
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure schedule");
  assert.equal(document.querySelector('input[name="claimDeadline"]').disabled, false);
  await submitSchedule({ startsAt: "2030-02-11T00:00:00Z", endsAt: "2030-02-12T00:00:00Z", claimDeadline: "2030-02-11T12:00:00Z" });
  assert.match(document.querySelector('[role="alert"]').textContent, /cannot be before availability end/); assert.equal(writes.length, 0);
  await submitSchedule({ claimDeadline: "2030-02-12T00:00:00Z" });
  assert.equal(writes[0].claimDeadline, writes[0].endsAt);
});
test("lifetime open windows can be cleared and impossible cutoff/deadline combinations cannot be saved", async t => {
  const root = await setup(t), lifetime = { ...mission, category: "ACHIEVEMENT", periodType: "LIFETIME" }; const writes = [];
  mockFetch(t, async (url, init = {}) => { if (init.method) { writes.push(JSON.parse(init.body)); return Response.json(lifetime); } return Response.json(new URL(url).pathname.endsWith(mission.missionId) ? lifetime : page([lifetime])); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure schedule");
  await submitSchedule({ endsAt: mission.activationEffectiveAt }); assert.match(document.querySelector('[role="alert"]').textContent, /end after the existing event cutoff/);
  await submitSchedule({ endsAt: "", claimDeadline: mission.activationEffectiveAt }); assert.match(document.querySelector('[role="alert"]').textContent, /after the earliest eligible event/);
  await submitSchedule({ startsAt: "", endsAt: "", claimDeadline: "" });
  assert.deepEqual(writes, [{ startsAt: null, endsAt: null, claimDeadline: null, expectedUpdatedAt: mission.updatedAt }]);
});
test("active definitions cannot open the scheduling form or submit a schedule", async t => {
  const root = await setup(t), active = { ...mission, active: true, lifecycle: "SCHEDULED" }; let writes = 0;
  mockFetch(t, async (url, init = {}) => { if (init.method) writes++; return Response.json(new URL(url).pathname.endsWith(mission.missionId) ? active : page([active])); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure schedule");
  assert.equal([...document.querySelectorAll("button")].find(button => button.textContent === "Configure schedule").disabled, true);
  assert.equal(document.querySelector('form[aria-label="Configure mission schedule"]'), null); assert.equal(writes, 0);
});
test("stale schedule errors preserve edits and reload restores the server snapshot", async t => {
  const root = await setup(t);
  mockFetch(t, async (url, init = {}) => init.method ? Response.json({ code: "MISSION_REVISION_CONFLICT", message: "Mission changed. Reload its details before saving." }, { status: 409 }) : Response.json(new URL(url).pathname.endsWith(mission.missionId) ? mission : page()));
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure schedule");
  await submitSchedule({ startsAt: "2030-02-11T00:00:00Z" });
  assert.match(document.querySelector('[role="alert"]').textContent, /Reload its details/);
  assert.equal(document.querySelector('input[name="startsAt"]').value, "2030-02-11T00:00:00Z"); assert.doesNotMatch(document.body.textContent, /schedule saved/);
  await click("Reload details"); await click("Configure schedule"); assert.equal(document.querySelector('input[name="startsAt"]').value, "");
});
test("a pending schedule mutation cannot be submitted twice", async t => {
  const root = await setup(t); let resolveSave; const writes = [];
  mockFetch(t, async (url, init = {}) => {
    if (init.method) { writes.push(JSON.parse(init.body)); return new Promise(resolve => { resolveSave = () => resolve(Response.json({ ...mission, ...writes[0], updatedAt: "2030-01-02T00:00:00Z" })); }); }
    return Response.json(new URL(url).pathname.endsWith(mission.missionId) ? mission : page());
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure schedule");
  await submitSchedule({ startsAt: "2030-02-11T00:00:00Z" }); await submitSchedule();
  assert.equal(writes.length, 1); assert.equal(document.querySelector('form[aria-label="Configure mission schedule"] fieldset').disabled, true);
  await act(async () => resolveSave()); assert.match(document.body.textContent, /Mission schedule saved/);
});
test("server scheduling validation failure never displays optimistic success", async t => {
  const root = await setup(t);
  mockFetch(t, async (url, init = {}) => init.method ? Response.json({ code: "VALIDATION_FAILED", message: "Schedule rejected by server." }, { status: 400 }) : Response.json(new URL(url).pathname.endsWith(mission.missionId) ? mission : page()));
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure schedule");
  await submitSchedule({ startsAt: "2030-02-11T00:00:00Z" }); assert.match(document.querySelector('[role="alert"]').textContent, /rejected by server/);
  assert.doesNotMatch(document.body.textContent, /Mission schedule saved/); assert.ok(document.querySelector('form[aria-label="Configure mission schedule"]'));
});
test("history labels schedule changes and displays UTC before/after safely", async t => {
  const root = await setup(t);
  t.mock.method(globalThis, "fetch", async url => { const path = new URL(url).pathname; return Response.json(path.endsWith("/history") ? { entries: [{ historyId: "4", missionId: mission.missionId, actorAdminUserId: "synthetic-admin", action: "SCHEDULE_CONFIGURED", occurredAt: mission.updatedAt, before: { schedule: { startsAt: null } }, after: { schedule: { startsAt: "2030-02-11T00:00:00.000Z" } } }], hasMore: false, limit: 25, offset: 0 } : path.endsWith(mission.missionId) ? mission : page()); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily");
  const history = document.querySelector('[aria-label="Administrator change history"]');
  assert.match(history.textContent, /Schedule configured/); assert.match(history.textContent, /2030-02-11T00:00:00.000Z/); assert.match(history.textContent, /UTC/); assert.match(history.textContent, /Before/); assert.match(history.textContent, /After/);
});

const ruleOptions = { options: [
  { eventType: "puzzle.added", label: "CircZles added", sourceType: "PUZZLE_CLAIM" },
  { eventType: "submission.created", label: "Submission created", sourceType: "SUBMISSION" },
  { eventType: "submission.approved", label: "Submission approved", sourceType: "SUBMISSION_REVIEW" },
  { eventType: "submission.rejected", label: "Submission rejected", sourceType: "SUBMISSION_REVIEW" },
  { eventType: "submission.resubmission_required", label: "Resubmission requested", sourceType: "SUBMISSION_REVIEW" },
  { eventType: "personal_best.improved", label: "Personal best improved", sourceType: "SUBMISSION" },
] };
async function submitRule(fields = {}) {
  const form = document.querySelector('form[aria-label="Configure mission rule"]'); assert.ok(form);
  for (const [key, value] of Object.entries(fields)) {
    const element = form.elements.namedItem(key);
    if (element.type === "checkbox") element.checked = value; else element.value = value;
  }
  await act(async () => form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
}

test("loads supported rules on demand and saves exact filters with the loaded revision", async t => {
  const root = await setup(t), calls = [], writes = []; let saved = mission;
  mockFetch(t, async (url, init = {}) => {
    const path = new URL(url).pathname; calls.push(path);
    if (path.endsWith("/rule-options")) return Response.json(ruleOptions);
    if (init.method === "PATCH") { const body = JSON.parse(init.body); writes.push({ path, body }); const rule = { ...body }; delete rule.expectedUpdatedAt; saved = { ...mission, rule, updatedAt: "2030-01-02T00:00:00.000Z" }; return Response.json(saved); }
    return Response.json(path.endsWith(mission.missionId) ? saved : page([saved]));
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily");
  assert.equal(calls.some(path => path.endsWith("/rule-options")), false);
  await click("Configure rule");
  assert.equal(document.querySelector('select[name="eventType"]').options.length, 7);
  assert.match(document.body.textContent, /Each matching event adds one/);
  await submitRule({ targetCount: "3", levelId: "0.5", puzzleId: "10000000-0000-4000-8000-000000000002", filterSource: true });
  assert.deepEqual(writes, [{ path: `/api/admin/missions/${mission.missionId}/rule`, body: { eventType: "puzzle.added", targetCount: 3, sourceType: "PUZZLE_CLAIM", puzzleId: "10000000-0000-4000-8000-000000000002", levelId: 0.5, conditions: {}, active: true, expectedUpdatedAt: mission.updatedAt } }]);
  assert.match(document.body.textContent, /Mission rule configuration saved. Mission remains inactive/);
  assert.match(document.body.textContent, /Target 3/);
});
test("rule setup on a partial draft defaults disabled and creates no reward or activation fields", async t => {
  const root = await setup(t), empty = { ...mission, rule: null, rewards: [] }; const writes = [];
  mockFetch(t, async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/rule-options")) return Response.json(ruleOptions);
    if (init.method) { writes.push(JSON.parse(init.body)); return Response.json({ ...empty, rule: writes[0], updatedAt: "2030-01-02T00:00:00Z" }); }
    return Response.json(path.endsWith(mission.missionId) ? empty : page([empty]));
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure rule");
  assert.equal(document.querySelector('input[name="active"]').checked, false);
  const select = document.querySelector('select[name="eventType"]');
  await act(async () => { select.value = "submission.approved"; select.dispatchEvent(new window.Event("change", { bubbles: true })); });
  await submitRule({ targetCount: "1" });
  assert.deepEqual(writes, [{ eventType: "submission.approved", targetCount: 1, sourceType: null, puzzleId: null, levelId: null, conditions: {}, active: false, expectedUpdatedAt: mission.updatedAt }]);
  assert.match(document.body.textContent, /No rewards configured/);
});
test("active missions cannot open the rule editor or send a rule write", async t => {
  const root = await setup(t), active = { ...mission, active: true }; const calls = [];
  mockFetch(t, async (url, init = {}) => { calls.push({ path: new URL(url).pathname, method: init.method }); return Response.json(new URL(url).pathname.endsWith(mission.missionId) ? active : page([active])); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure rule");
  assert.equal([...document.querySelectorAll("button")].find(button => button.textContent === "Configure rule").disabled, true);
  assert.equal(document.querySelector('[aria-label="Configure mission rule"]'), null);
  assert.equal(calls.some(call => call.method || call.path.endsWith("/rule-options")), false);
});
test("invalid rule parameters remain editable and do not reach the API", async t => {
  const root = await setup(t); let writes = 0;
  mockFetch(t, async (url, init = {}) => { if (init.method) writes++; const path = new URL(url).pathname; return Response.json(path.endsWith("/rule-options") ? ruleOptions : path.endsWith(mission.missionId) ? mission : page()); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure rule");
  for (const fields of [{ targetCount: "0" }, { targetCount: "1.5" }, { targetCount: "2147483648" }, { targetCount: "2", levelId: "1.25" }, { levelId: "3.5", puzzleId: "bad" }]) {
    await submitRule(fields); assert.match(document.querySelector('[role="alert"]').textContent, /positive whole event count/); assert.ok(document.querySelector('[aria-label="Configure mission rule"]'));
  }
  assert.equal(writes, 0);
});
test("a stale rule save keeps unsaved controls and reload restores the server revision", async t => {
  const root = await setup(t);
  mockFetch(t, async (url, init = {}) => {
    if (init.method === "PATCH") return Response.json({ code: "MISSION_REVISION_CONFLICT", message: "Mission changed. Reload its details before saving." }, { status: 409 });
    const path = new URL(url).pathname; return Response.json(path.endsWith("/rule-options") ? ruleOptions : path.endsWith(mission.missionId) ? mission : page());
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure rule");
  await submitRule({ targetCount: "7" });
  assert.match(document.querySelector('[role="alert"]').textContent, /Reload its details/);
  assert.equal(document.querySelector('input[name="targetCount"]').value, "7");
  assert.doesNotMatch(document.body.textContent, /configuration saved/);
  await click("Reload details"); await click("Configure rule");
  assert.equal(document.querySelector('input[name="targetCount"]').value, "2");
});
test("existing advanced rules remain read-only and are never silently simplified", async t => {
  const root = await setup(t), advanced = { ...mission, rule: { ...mission.rule, conditions: { brand: "CircZles" } } }; let writes = 0;
  mockFetch(t, async (url, init = {}) => { if (init.method) writes++; const path = new URL(url).pathname; return Response.json(path.endsWith("/rule-options") ? ruleOptions : path.endsWith(mission.missionId) ? advanced : page([advanced])); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure rule");
  assert.match(document.body.textContent, /remains read-only/); assert.equal(document.querySelector('[aria-label="Configure mission rule"]'), null); assert.equal(writes, 0);
});
test("rule option loading errors fail closed without fabricated options", async t => {
  const root = await setup(t);
  mockFetch(t, async url => { const path = new URL(url).pathname; return path.endsWith("/rule-options") ? Response.json({ message: "Options unavailable" }, { status: 503 }) : Response.json(path.endsWith(mission.missionId) ? mission : page()); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Configure rule");
  assert.match(document.querySelector('[role="alert"]').textContent, /Options unavailable/);
  assert.equal(document.querySelector('[aria-label="Configure mission rule"]'), null);
});
test("history renders rule audit action and before/after snapshots safely", async t => {
  const root = await setup(t);
  t.mock.method(globalThis, "fetch", async url => { const path = new URL(url).pathname; return Response.json(path.endsWith("/history") ? { entries: [{ historyId: "3", missionId: mission.missionId, actorAdminUserId: "synthetic-admin", action: "RULE_CONFIGURED", occurredAt: mission.updatedAt, before: { rule: null }, after: { rule: { ...mission.rule, eventType: "<script>unsafe</script>" } } }], hasMore: false, limit: 25, offset: 0 } : path.endsWith(mission.missionId) ? mission : page()); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily");
  const history = document.querySelector('[aria-label="Administrator change history"]');
  assert.match(history.textContent, /Rule configured/); assert.match(history.textContent, /synthetic-admin/); assert.match(history.textContent, /Before/); assert.match(history.textContent, /After/); assert.equal(history.querySelector("script"), null);
});

test("mission boundary asks its own permission and never mounts denied content", async t => {
  const root = await setup(t), calls = [];
  mockFetch(t, async url => { calls.push(new URL(url).pathname); return Response.json({ code: "FORBIDDEN" }, { status: 403 }); });
  await act(async () => root.render(createElement(PathnameContext.Provider, { value: "/admin/missions" }, createElement(CatalogAdminBoundary, null, createElement(MissionAdmin)))));
  assert.deepEqual(calls, ["/api/admin/missions/access"]);
  assert.match(document.body.textContent, /Admin access unavailable/); assert.equal(document.querySelector("form"), null);
});
test("authorized mission boundary links to the real mission list", async t => {
  const root = await setup(t);
  mockFetch(t, async url => Response.json(new URL(url).pathname.endsWith("/access") ? { allowed: true } : page()));
  await act(async () => root.render(createElement(PathnameContext.Provider, { value: "/admin/missions" }, createElement(CatalogAdminBoundary, null, createElement(MissionAdmin)))));
  assert.ok(document.querySelector('a[href="/admin/missions"]'));
  assert.match(document.body.textContent, /Synthetic daily/);
});
test("catalog authorization cannot be reused when navigating into Missions", async t => {
  const root = await setup(t); let deny;
  mockFetch(t, async url => new URL(url).pathname === "/api/admin/missions/access"
    ? new Promise(resolve => { deny = () => resolve(Response.json({ code: "FORBIDDEN" }, { status: 403 })); })
    : Response.json({ allowed: true }));
  const screen = pathname => createElement(PathnameContext.Provider, { value: pathname }, createElement(CatalogAdminBoundary, null, createElement("p", null, "Private area content")));
  await act(async () => root.render(screen("/admin/puzzles")));
  assert.match(document.body.textContent, /Private area content/);
  await act(async () => root.render(screen("/admin/missions")));
  assert.doesNotMatch(document.body.textContent, /Private area content/);
  assert.match(document.body.textContent, /Checking admin access/);
  await act(async () => deny());
  assert.match(document.body.textContent, /Admin access unavailable/);
});
test("loads actual detail, saves only metadata and accepts server-confirmed content", async t => {
  const root = await setup(t), writes = []; let saved = mission;
  mockFetch(t, async (url, init = {}) => {
    if (init.method === "PATCH") { const body = JSON.parse(init.body); writes.push(body); saved = { ...mission, title: body.title, description: body.description, displayOrder: body.displayOrder, updatedAt: "2030-01-02T00:00:00.000Z" }; return Response.json(saved); }
    return Response.json(new URL(url).pathname.endsWith(mission.missionId) ? saved : page([saved]));
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily");
  assert.match(document.body.textContent, /puzzle.added · Target 2/);
  assert.match(document.body.textContent, /24-hour period-end grace/);
  await submitMetadata({ title: "Renamed label", description: "Updated copy", displayOrder: "7" });
  assert.deepEqual(writes, [{ title: "Renamed label", description: "Updated copy", displayOrder: 7, expectedUpdatedAt: mission.updatedAt }]);
  assert.match(document.body.textContent, /Mission metadata saved/);
  assert.equal(document.querySelector('input[name="title"]').value, "Renamed label");
  assert.equal([...document.querySelectorAll("button")].some(b => /Activate|Claim|Grant/.test(b.textContent)), false);
});
test("stale save rejection retains the unsaved draft and never reports success", async t => {
  const root = await setup(t);
  mockFetch(t, async (url, init = {}) => init.method === "PATCH" ? Response.json({ code: "MISSION_REVISION_CONFLICT", message: "Mission changed. Reload its details before saving." }, { status: 409 }) : Response.json(new URL(url).pathname.endsWith(mission.missionId) ? mission : page()));
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily");
  await submitMetadata({ title: "Unsaved draft" });
  assert.match(document.querySelector('[role="alert"]').textContent, /Reload its details/);
  assert.doesNotMatch(document.body.textContent, /Mission metadata saved/);
  assert.equal(document.querySelector('input[name="title"]').value, "Unsaved draft");
  await click("Reload details"); assert.equal(document.querySelector('input[name="title"]').value, "Synthetic daily");
});
test("active definitions are read-only and incomplete configuration is visible", async t => {
  const root = await setup(t), active = { ...mission, active: true, lifecycle: "ACTIVE", rule: null, rewards: [], configurationIssues: ["An active mission rule is required."] }; let writes = 0;
  mockFetch(t, async (url, init = {}) => { if (init.method) writes++; return Response.json(new URL(url).pathname.endsWith(mission.missionId) ? active : page([active])); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily");
  assert.equal(document.querySelector("fieldset").disabled, true);
  assert.match(document.body.textContent, /Configuration incomplete/); assert.match(document.body.textContent, /No rule configured/);
  await click("Save metadata"); assert.equal(writes, 0);
});
test("pagination uses server hasMore and requests another page", async t => {
  const root = await setup(t), calls = [];
  mockFetch(t, async url => { const parsed = new URL(url); calls.push(parsed.searchParams.get("offset")); return Response.json(parsed.searchParams.get("offset") === "25" ? page([], false) : page([mission], true)); });
  await act(async () => root.render(createElement(MissionAdmin))); await click("Next");
  assert.deepEqual(calls, ["0", "25"]); assert.match(document.body.textContent, /No missions found/);
});
test("list failure is explicit and does not fabricate missions", async t => {
  const root = await setup(t);
  mockFetch(t, async () => Response.json({ message: "Mission service unavailable" }, { status: 503 }));
  await act(async () => root.render(createElement(MissionAdmin)));
  assert.match(document.querySelector('[role="alert"]').textContent, /Mission service unavailable/);
  assert.equal(document.querySelector('[aria-label="Mission definitions"]'), null);
});

async function submitDraft(fields) {
  const form = document.querySelector('form[aria-label="Create mission draft"]');
  assert.ok(form);
  for (const [key, value] of Object.entries(fields)) form.elements.namedItem(key).value = value;
  await act(async () => form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
}
test("creates only inactive draft metadata and opens the server-confirmed detail", async t => {
  const root = await setup(t), writes = []; let rows = [];
  mockFetch(t, async (_url, init = {}) => {
    if (init.method === "POST") {
      const body = JSON.parse(init.body); writes.push(body);
      const created = { ...mission, ...body, active: false, rule: null, rewards: [], configurationIssues: ["An active mission rule is required.", "Invalid mission reward total."] };
      rows = [created]; return Response.json(created, { status: 201 });
    }
    return Response.json(page(rows));
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("Create Mission Draft");
  const category = document.querySelector('select[name="category"]');
  assert.equal(category.value, "");
  assert.deepEqual([...category.options].filter(option => option.value).map(option => option.value), ["DAILY", "WEEKLY", "SPRINT", "SEASON", "EVENT", "ACHIEVEMENT"]);
  await submitDraft({ title: "My inactive draft", description: "Draft copy", category: "DAILY", displayOrder: "3" });
  assert.deepEqual(writes, [{ title: "My inactive draft", description: "Draft copy", category: "DAILY", displayOrder: 3 }]);
  assert.match(document.body.textContent, /Inactive draft created/);
  assert.match(document.body.textContent, /Definition status: INACTIVE/);
  assert.match(document.body.textContent, /No rule configured/);
  assert.match(document.body.textContent, /No rewards configured/);
  assert.equal(document.querySelector('form[aria-label="Create mission draft"]'), null);
});
test("failed draft creation preserves inputs and never fabricates success", async t => {
  const root = await setup(t);
  mockFetch(t, async (_url, init = {}) => init.method === "POST" ? Response.json({ message: "Draft could not be saved" }, { status: 500 }) : Response.json(page([])));
  await act(async () => root.render(createElement(MissionAdmin))); await click("Create Mission Draft");
  await submitDraft({ title: "Retain this draft", category: "WEEKLY" });
  assert.equal(document.querySelector('input[name="title"]').value, "Retain this draft");
  assert.match(document.querySelector('[role="alert"]').textContent, /could not be saved/);
  assert.doesNotMatch(document.body.textContent, /Inactive draft created/);
  assert.equal(document.querySelector('[aria-label="Mission details"]'), null);
});
test("a pending create request cannot be submitted twice", async t => {
  const root = await setup(t); let writes = 0, resolve;
  mockFetch(t, async (_url, init = {}) => {
    if (init.method === "POST") { writes++; return new Promise(done => { resolve = () => done(Response.json({ ...mission, title: "Pending draft", rule: null, rewards: [] }, { status: 201 })); }); }
    return Response.json(page([]));
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("Create Mission Draft");
  await submitDraft({ title: "Pending draft", category: "DAILY" });
  await submitDraft({ title: "Pending draft", category: "DAILY" });
  assert.equal(writes, 1);
  await act(async () => resolve());
});
test("history shows actor, UTC time and escaped before/after, then refreshes after an edit", async t => {
  const root = await setup(t); let saved = mission, reads = 0, edited = false;
  const snapshot = { title: "<script>unsafe()</script>", description: "Draft copy", displayOrder: 0, category: "DAILY", periodType: "DAILY", active: false, updatedAt: mission.updatedAt };
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    if (init.method === "PATCH") { edited = true; saved = { ...mission, title: "Audited label", updatedAt: "2030-01-02T00:00:00.000Z" }; return Response.json(saved); }
    if (new URL(url).pathname.endsWith("/history")) { reads++; return Response.json({ entries: [{ historyId: edited ? "2" : "1", missionId: mission.missionId, actorAdminUserId: "10000000-0000-4000-8000-000000000002", action: edited ? "METADATA_UPDATED" : "DRAFT_CREATED", occurredAt: "2030-01-01T00:00:00.000Z", before: edited ? snapshot : null, after: { ...snapshot, title: edited ? "Audited label" : snapshot.title } }], limit: 25, offset: 0, hasMore: false }); }
    return Response.json(new URL(url).pathname.endsWith(mission.missionId) ? saved : page([saved]));
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily");
  const history = () => document.querySelector('[aria-label="Administrator change history"]');
  assert.match(history().textContent, /Draft created/); assert.match(history().textContent, /2030-01-01T00:00:00.000Z \(UTC\)/);
  assert.match(history().textContent, /Administrator 10000000-0000-4000-8000-000000000002/);
  assert.match(history().textContent, /<script>unsafe/); assert.equal(history().querySelector("script"), null);
  await submitMetadata({ title: "Audited label" });
  assert.equal(reads, 2); assert.match(history().textContent, /Metadata updated/);
  assert.match(history().textContent, /Before/); assert.match(history().textContent, /After/);
});
test("history paginates without changing missions or exposing mutation controls", async t => {
  const root = await setup(t), offsets = [];
  t.mock.method(globalThis, "fetch", async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/history")) { const offset = parsed.searchParams.get("offset"); offsets.push(offset); return Response.json({ entries: [], limit: 25, offset: Number(offset), hasMore: offset === "0" }); }
    return Response.json(parsed.pathname.endsWith(mission.missionId) ? mission : page());
  });
  await act(async () => root.render(createElement(MissionAdmin))); await click("View Synthetic daily"); await click("Older changes");
  assert.deepEqual(offsets, ["0", "25"]);
  const history = document.querySelector('[aria-label="Administrator change history"]');
  assert.equal(history.querySelector("input,textarea,select,form"), null);
});
