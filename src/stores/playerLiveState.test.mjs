import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createRequire } from "node:module";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

process.env.NEXT_PUBLIC_DATA_MODE = "api";
process.env.NEXT_PUBLIC_API_BASE_URL = "https://hub.example.test";
// Node does not run Next's static-image loader. Preserve its module contract.
const require = createRequire(import.meta.url);
require.extensions[".png"] = (module) => { module.exports = { src: "/fixture-rank.png", width: 256, height: 256 }; };
class TestEventSource extends EventTarget {
  static connections = [];
  onopen = null; onerror = null; closed = false;
  constructor(url, options) { super(); this.url = url; this.options = options; TestEventSource.connections.push(this); }
  close() { this.closed = true; }
  open() { this.onopen?.(); }
  fail() { this.onerror?.(); }
  send(type = "player-state-changed", id = "fixture-event") {
    const event = new Event(type);
    Object.defineProperty(event, "lastEventId", { value: id }); this.dispatchEvent(event);
  }
}
const { AuthProvider, useAuth } = await import("../components/auth/AuthProvider.tsx");
const { PlayerIdentityPanel } = await import("../components/player/PlayerIdentityPanel.tsx");
const { GameShell } = await import("../components/game-shell/GameShell.tsx");
const { LeaderboardPlayerIdentity } = await import("../components/leaderboard/LeaderboardPlayerIdentity.tsx");
const { ProfileEditor } = await import("../components/player/ProfileEditor.tsx");
const { apiClient } = await import("../lib/apiClient.ts");
const { usePlayerUiState } = await import("./playerUiState.ts");

const initial = () => ({ internalId: "10000000-0000-4000-8000-000000000001", publicPlayerId: "hazel_001", displayName: "Hazel", avatar: "/brand/avatar.svg", avatarSource: "DEFAULT", customAvatarAvailable: false, country: "", state: "", xp: 0, xpNeeded: 1200, progressionLevel: 1, rank: "Peasant", synapsePoints: 1000, equippedFrame: "", badgeShowcase: [], streak: 0, stats: { ownedPuzzles: 0, completed: 0, approvedAttempts: 0, personalBests: 0, podiums: 0, seasonRank: 0, longestStreak: 0 } });

async function setup(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hub.example.test/profile" });
  const keys = ["window", "self", "document", "HTMLElement", "Element", "SVGElement", "File", "FileReader", "EventSource", "IS_REACT_ACT_ENVIRONMENT"];
  const saved = keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "EventSource" ? TestEventSource : dom.window[key] });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  window.setTimeout = (...args) => setTimeout(...args); window.clearTimeout = (...args) => clearTimeout(...args);
  window.setInterval = (...args) => setInterval(...args); window.clearInterval = (...args) => clearInterval(...args);
  TestEventSource.connections = [];
  usePlayerUiState.getState().clear();
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await act(async () => root.unmount()); usePlayerUiState.getState().clear(); dom.window.close(); for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  return { root, tick: async (ms) => act(async () => t.mock.timers.tick(ms)) };
}

function server(t) {
  let profile = initial(); let failHydration = false; let signedIn = true;
  const mutations = [];
  const fetch = t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === "/api/auth/session") return Response.json(profile, { status: signedIn ? 200 : 401 });
    if (path === "/api/me") return Response.json(failHydration ? { code: "UNAVAILABLE" } : profile, { status: failHydration ? 503 : 200 });
    if (path === "/api/auth/logout") { signedIn = false; return Response.json({ ok: true }); }
    if (path === "/api/me/inventory") return Response.json({ items: [{ inventoryItemId: "owned", rewardType: "AVATAR", quantity: 1, name: "Owned CircZles", imageUrl: "/owned.svg" }, { inventoryItemId: "unowned", rewardType: "AVATAR", quantity: 0, name: "Unowned", imageUrl: "/unowned.svg" }], equipment: {} });
    const input = init.body ? JSON.parse(init.body) : {};
    mutations.push({ path, input });
    if (path === "/api/me/avatar/photo") profile = { ...profile, avatar: "https://res.cloudinary.com/test/photo.png", avatarSource: "CUSTOM_UPLOAD", customAvatarAvailable: true };
    else if (path === "/api/me/avatar") profile = { ...profile, avatarSource: input.source, avatar: input.source === "DEFAULT" ? "/brand/avatar.svg" : "https://res.cloudinary.com/test/photo.png" };
    else if (path.endsWith("/equip")) profile = { ...profile, avatarSource: "INVENTORY_AVATAR", avatar: "/owned.svg" };
    else if (path === "/api/me/profile") profile = { ...profile, ...input };
    else profile = { ...profile, synapsePoints: profile.synapsePoints + 100, xp: 1500, xpNeeded: 3600, progressionLevel: 5, rank: "Farmer" };
    return Response.json(profile);
  });
  return { fetch, mutations, get profile() { return profile; }, setProfile(value) { profile = value; }, fail(value) { failHydration = value; }, login() { signedIn = true; } };
}

function Surface({ editor = false }) {
  const { player, logout } = useAuth();
  return createElement("div", {}, createElement("button", { "data-testid": "logout-live", onClick: () => { void logout(); } }, "Fixture"), createElement(GameShell, {}, player && createElement("div", {}, createElement(PlayerIdentityPanel, { fallbackPlayer: player, mode: "api" }), createElement("div", { "data-testid": "current-leaderboard-identity" }, createElement(LeaderboardPlayerIdentity, { publicPlayerId: player.publicPlayerId, displayName: "Stale cached name", isCurrentPlayer: true })), editor && createElement(ProfileEditor))));
}
async function render(root, tick, editor = false) {
  const router = { replace() {}, push() {}, prefetch() {}, back() {}, forward() {}, refresh() {} };
  await act(async () => root.render(createElement(AppRouterContext.Provider, { value: router }, createElement(PathnameContext.Provider, { value: "/profile" }, createElement(AuthProvider, {}, createElement(Surface, { editor }))))));
  await tick(1); await act(async () => {});
}
const button = (text) => [...document.querySelectorAll("button")].find((node) => node.textContent.includes(text));

test("production hydrates a single snapshot, renders the neutral icon and exposes Change Avatar", async (t) => {
  const { root, tick } = await setup(t); server(t); await render(root, tick);
  assert.equal(usePlayerUiState.getState().player.avatar, "/brand/avatar.svg");
  assert.ok(document.querySelector('[data-testid="player-hero"] img[src*="avatar.svg"]'));
  assert.ok(button("Change Avatar"));
});

test("production owned/default/photo choices rerender all avatars and never offer unowned rewards", async (t) => {
  const { root, tick } = await setup(t); const backend = server(t); await render(root, tick);
  await act(async () => button("Change Avatar").click()); await tick(1);
  assert.ok(button("Owned CircZles")); assert.equal(button("Unowned"), undefined);
  await act(async () => button("Owned CircZles").click());
  assert.equal(usePlayerUiState.getState().player.avatar, "/owned.svg");
  assert.ok(document.querySelector('[data-testid="player-hero"] img[src*="owned.svg"]'));
  await act(async () => button("Use Default Avatar").click());
  assert.equal(usePlayerUiState.getState().player.avatar, "/brand/avatar.svg");
  const input = document.querySelector('input[type="file"]');
  Object.defineProperty(input, "files", { configurable: true, value: [new File([new Uint8Array([137,80,78,71,13,10,26,10])], "photo.png", { type: "image/png" })] });
  await act(async () => { input.dispatchEvent(new window.Event("change", { bubbles: true })); await new Promise(setImmediate); });
  await act(async () => { await new Promise(setImmediate); });
  assert.equal(usePlayerUiState.getState().player.avatarSource, "CUSTOM_UPLOAD");
  assert.ok(document.querySelector('[data-testid="player-hero"] img[src*="res.cloudinary.com"]'));
  assert.ok(button("Replace Photo"));
  assert.ok(document.querySelector('[data-testid="current-leaderboard-identity"] img[src*="res.cloudinary.com"]'));
  assert.equal(backend.mutations.filter((row) => row.path === "/api/me/avatar/photo").length, 1);
});

test("successful profile mutation updates display name/location across mounted surfaces and rehydration", async (t) => {
  const { root, tick } = await setup(t); const backend = server(t); await render(root, tick, true);
  assert.ok(document.querySelector("form"));
  await act(async () => apiClient.updateProfile({ displayName: "Updated Hazel", country: "India", state: "Kerala" }));
  assert.match(document.querySelector('[data-testid="player-hero"]').textContent, /Updated Hazel/);
  assert.match(document.querySelector('[data-testid="current-leaderboard-identity"]').textContent, /Updated Hazel/);
  assert.match(document.querySelector('[data-testid="player-hero"]').textContent, /Kerala, India/);
  await act(async () => usePlayerUiState.getState().clear());
  await act(async () => apiClient.refreshLivePlayer());
  assert.equal(usePlayerUiState.getState().player.displayName, backend.profile.displayName);
  assert.equal(usePlayerUiState.getState().player.country, "India");
});

test("mission/store/wheel/equipment/rename/submission mutations refresh backend XP, thresholds, SP and rank without page refresh", async (t) => {
  const { root, tick } = await setup(t); server(t); await render(root, tick);
  for (const mutation of [() => apiClient.claimMission("mission", "key"), () => apiClient.purchaseStoreListing("listing", "key"), () => apiClient.spinRewardWheel("key"), () => apiClient.unequipSlot("FRAME"), () => apiClient.renameDisplayName("card", "Hazel", "key"), () => apiClient.createSubmission({ playerPuzzleId: "puzzle", completionTimeMs: 1000, videoUploadId: "video" }, "key")]) {
    const before = usePlayerUiState.getState().player.synapsePoints;
    await act(async () => mutation());
    const live = usePlayerUiState.getState().player;
    assert.equal(live.synapsePoints, before + 100);
    assert.equal(live.xp, 1500); assert.equal(live.xpNeeded, 3600); assert.equal(live.progressionLevel, 5); assert.equal(live.rank, "Farmer");
    const hero = document.querySelector('[data-testid="player-hero"]');
    assert.match(hero.textContent, /Farmer/); assert.match(hero.textContent, /Progression Level 5/);
    assert.match(hero.textContent, /1,500 \/ 3,600 XP/);
    assert.equal(hero.querySelector(".cz-track-fill").style.width, "42%");
  }
});

test("out-of-order hydration and logout cannot restore an old player's snapshot", async (t) => {
  await setup(t);
  const pending = [];
  t.mock.method(globalThis, "fetch", () => new Promise((resolve) => pending.push(resolve)));
  const first = apiClient.refreshLivePlayer(), second = apiClient.refreshLivePlayer();
  pending[1](Response.json({ ...initial(), displayName: "Newest" })); await second;
  pending[0](Response.json({ ...initial(), displayName: "Stale" })); await first;
  assert.equal(usePlayerUiState.getState().player.displayName, "Newest");
  const oldSession = apiClient.refreshLivePlayer(); usePlayerUiState.getState().clear();
  pending[2](Response.json(initial())); await oldSession;
  assert.equal(usePlayerUiState.getState().player, undefined);
});

test("committed mutation is not retried when hydration fails; successful rehydration clears the warning", async (t) => {
  await setup(t); const backend = server(t); await apiClient.refreshLivePlayer();
  backend.fail(true); await apiClient.selectAvatar("DEFAULT");
  assert.equal(backend.mutations.length, 1); assert.match(usePlayerUiState.getState().syncError, /action succeeded/);
  backend.fail(false); await apiClient.refreshLivePlayer(); assert.equal(usePlayerUiState.getState().syncError, undefined);
});

test("low-frequency fallback and focus synchronize review-derived progression; logout/login hydrates persisted cosmetics", async (t) => {
  const { root, tick } = await setup(t); const backend = server(t); await render(root, tick);
  backend.setProfile({ ...backend.profile, xp: 1500, xpNeeded: 3600, progressionLevel: 5, rank: "Farmer", synapsePoints: 2000 });
  await tick(300_000); assert.equal(usePlayerUiState.getState().player.rank, "Farmer");
  backend.setProfile({ ...backend.profile, displayName: "Remote update", avatar: "/owned.svg", avatarSource: "INVENTORY_AVATAR" });
  await act(async () => window.dispatchEvent(new window.Event("focus"))); assert.equal(usePlayerUiState.getState().player.displayName, "Remote update");
  await act(async () => root.unmount()); usePlayerUiState.getState().clear(); backend.login();
  const nextRoot = createRoot(document.getElementById("root"));
  await render(nextRoot, tick); assert.equal(usePlayerUiState.getState().player.avatar, "/owned.svg");
  await act(async () => nextRoot.unmount());
});

test("invalid uploads never reach the server", async (t) => {
  await setup(t); const backend = server(t);
  await assert.rejects(apiClient.uploadAvatar(new File(["<svg />"], "bad.svg", { type: "image/svg+xml" })), /JPEG/);
  await assert.rejects(apiClient.uploadAvatar(new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })), /2 MiB/);
  assert.equal(backend.mutations.length, 0);
});


test("external approval notification updates XP/SP/level/rank and mounted surfaces immediately, with no poll or mutation", async (t) => {
  const { root, tick } = await setup(t); const backend = server(t); await render(root, tick);
  const connection = TestEventSource.connections.at(-1);
  assert.equal(connection.url, "/api/me/events"); assert.equal(connection.options.withCredentials, true);
  await act(async () => connection.open());
  backend.setProfile({ ...backend.profile, xp: 1500, xpNeeded: 3600, progressionLevel: 5, rank: "Farmer", synapsePoints: 2000 });
  const before = backend.fetch.mock.callCount();
  await act(async () => connection.send("player-state-changed", "approved-review"));
  assert.equal(backend.fetch.mock.callCount(), before + 1);
  assert.equal(backend.mutations.length, 0);
  const live = usePlayerUiState.getState().player;
  assert.equal(live.xp, 1500); assert.equal(live.synapsePoints, 2000); assert.equal(live.progressionLevel, 5); assert.equal(live.rank, "Farmer");
  const hero = document.querySelector('[data-testid="player-hero"]');
  assert.match(hero.textContent, /Farmer/); assert.match(hero.textContent, /Progression Level 5/);
  assert.match(hero.textContent, /1,500 \/ 3,600 XP/); assert.equal(hero.querySelector(".cz-track-fill").style.width, "42%");
  assert.match(document.body.textContent, /2,000/);
  assert.ok(hero.querySelector('[data-testid="progression-badge"]') || hero.querySelector('img[src*="fixture-rank"]'));
  await act(async () => connection.send("player-state-changed", "approved-review"));
  assert.equal(backend.fetch.mock.callCount(), before + 1);
});

test("SSE reconnect/visibility/focus recover missed canonical state and logout ignores old notifications", async (t) => {
  const { root, tick } = await setup(t); const backend = server(t); await render(root, tick);
  const first = TestEventSource.connections.at(-1);
  await act(async () => first.open());
  await act(async () => first.fail()); assert.equal(first.closed, true);
  backend.setProfile({ ...backend.profile, xp: 1500, xpNeeded: 3600, progressionLevel: 5, rank: "Farmer" });
  await tick(1250);
  const reconnect = TestEventSource.connections.at(-1); assert.notEqual(reconnect, first);
  await act(async () => reconnect.open()); assert.equal(usePlayerUiState.getState().player.rank, "Farmer");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  await act(async () => document.dispatchEvent(new window.Event("visibilitychange"))); assert.equal(reconnect.closed, true);
  backend.setProfile({ ...backend.profile, synapsePoints: 3000 });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  await act(async () => document.dispatchEvent(new window.Event("visibilitychange"))); assert.equal(usePlayerUiState.getState().player.synapsePoints, 3000);
  const latest = TestEventSource.connections.at(-1);
  await act(async () => document.querySelector('[data-testid="logout-live"]').click()); assert.equal(latest.closed, true);
  const count = backend.fetch.mock.callCount();
  await act(async () => latest.send("player-state-changed", "late-old-session"));
  assert.equal(backend.fetch.mock.callCount(), count); assert.equal(usePlayerUiState.getState().player, undefined);
});

test("expired stream session and component unmount disconnect event synchronization", async (t) => {
  const { root, tick } = await setup(t); const backend = server(t); await render(root, tick);
  const connection = TestEventSource.connections.at(-1);
  backend.setProfile({ ...backend.profile });
  await act(async () => connection.send("session-expired")); assert.equal(connection.closed, true);
  // Auth session refresh may still be valid in this fixture; its new stream is also cleaned up.
  const current = TestEventSource.connections.at(-1);
  await act(async () => root.unmount()); assert.equal(current.closed, true);
});


test("failed event hydration retries canonical state without another event or safety poll", async (t) => {
  const { root, tick } = await setup(t); const backend = server(t); await render(root, tick);
  const connection = TestEventSource.connections.at(-1);
  backend.setProfile({ ...backend.profile, synapsePoints: 4000 }); backend.fail(true);
  await act(async () => connection.send("player-state-changed", "approval-during-outage"));
  assert.match(usePlayerUiState.getState().syncError, /could not be refreshed/);
  backend.fail(false); await tick(1000);
  assert.equal(usePlayerUiState.getState().player.synapsePoints, 4000); assert.equal(usePlayerUiState.getState().syncError, undefined);
});
