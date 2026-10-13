import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
process.env.NEXT_PUBLIC_DATA_MODE = "api";
process.env.NEXT_PUBLIC_API_BASE_URL = "https://hub.example.test";
const { LeaderboardExplorer, levelShopUrl } = await import("./LeaderboardExplorer.tsx");
const { PuzzleCollectionExplorer } = await import("../puzzles/PuzzleCollectionExplorer.tsx");
const { PuzzleDetailExplorer } = await import("../puzzles/PuzzleDetailExplorer.tsx");
const { usePlayerUiState } = await import("../../stores/playerUiState.ts");
const boardItem = (id, level = 1, category = "MAIN_LEVEL") => ({ puzzleId: id, puzzleName: id, levelId: level, category, displayOrder: 1, runCode: "R3" });
const catalog = { mainLevels: [boardItem("Lion"), boardItem("Octopus"), boardItem("Abyss", 6), boardItem("Red Alert", 6)], sideQuests: [boardItem("Side", 3.5, "SIDE_QUEST")] };
async function setup(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hub.example.test/leaderboard", pretendToBeVisual: true });
  const keys = ["window", "self", "document", "HTMLElement", "Element", "SVGElement", "FormData", "IS_REACT_ACT_ENVIRONMENT"];
  const saved = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key] });
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  usePlayerUiState.getState().clear(); const root = createRoot(document.getElementById("root"));
  t.after(async () => { await act(async () => root.unmount()); usePlayerUiState.getState().clear(); dom.window.close(); for (const [key, desc] of saved) { if (desc) Object.defineProperty(globalThis, key, desc); else delete globalThis[key]; } });
  return root;
}
async function click(text) { const node = [...document.querySelectorAll("button")].find(button => button.textContent.trim() === text); assert.ok(node, text); await act(async () => node.click()); }
function mockBoards(t, { entries = [], currentPlayerEntry = null } = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async url => {
    const u = new URL(url); calls.push(u);
    if (u.pathname.endsWith("/catalog")) return Response.json(catalog);
    if (u.pathname.includes("public-profile")) return Response.json({ publicPlayerId: "player", displayName: "Player", progressionRank: "Peasant", approvedPuzzlesSolved: 1, avatarUrl: null, displayedBadges: [] });
    const item = [...catalog.mainLevels, ...catalog.sideQuests].find(row => row.puzzleId === u.searchParams.get("puzzleId"));
    return Response.json({ puzzle: item, entries, currentPlayerEntry });
  }); return calls;
}
test("ten levels and multiple Level 1/6 designs select independent boards on demand", async t => {
  const root = await setup(t), calls = mockBoards(t);
  await act(async () => root.render(createElement(LeaderboardExplorer, { mode: "api" })));
  assert.equal(document.querySelectorAll('[aria-label="Choose a level"] button').length, 10);
  assert.deepEqual(calls.filter(u => u.pathname === "/api/leaderboards").map(u => u.searchParams.get("puzzleId")), ["Lion"]);
  assert.equal(document.querySelector('[aria-label="Choose a CircZles"]').textContent, "LionOctopus"); assert.doesNotMatch(document.body.textContent, /R3|puzzleId|levelId/);
  await click("Octopus"); assert.equal(calls.at(-1).searchParams.get("puzzleId"), "Octopus");
  await click("Level 6"); assert.equal(document.querySelector('[aria-label="Choose a CircZles"]').textContent, "AbyssRed Alert"); await click("Red Alert"); assert.equal(calls.at(-1).searchParams.get("puzzleId"), "Red Alert");
  assert.equal(document.querySelector('button[aria-pressed="true"]').textContent, "Level 6");
});
test("empty configured/unconfigured levels use exact shop URLs without double encoding", async t => {
  const root = await setup(t); mockBoards(t);
  await act(async () => root.render(createElement(LeaderboardExplorer, { mode: "api" })));
  assert.match(document.body.textContent, /Be the First to Set a Record!/); assert.match(document.body.textContent, /Take on the challenge, submit your solve, and earn your place on the leaderboard./);
  let link = document.querySelector('a[target="_blank"]'); assert.equal(link.getAttribute("href"), "https://www.circzles.com/buy-circular-wooden-puzzles?By+Levels=Level%25201-5"); assert.equal(link.rel, "noopener noreferrer");
  await click("Level 10"); link = document.querySelector('a[target="_blank"]'); assert.equal(link.getAttribute("href"), "https://www.circzles.com/buy-circular-wooden-puzzles?By+Levels=Level%25206-10"); assert.match(document.body.textContent, /No playable CircZles/);
  await click("Side Quests"); assert.equal(document.querySelector('a[target="_blank"]'), null);
  assert.equal(levelShopUrl(18), null); assert.equal(levelShopUrl(3.5), null);
});
test("empty catalog retains all ten discoverable levels and no invented leaderboard", async t => {
  const root = await setup(t), calls = []; t.mock.method(globalThis, "fetch", async url => { calls.push(url); return Response.json({ mainLevels: [], sideQuests: [] }); });
  await act(async () => root.render(createElement(LeaderboardExplorer, { mode: "api" })));
  assert.equal(document.querySelectorAll('[aria-label="Choose a level"] button').length, 10); assert.equal(calls.length, 1); await click("Level 6"); assert.equal(calls.length, 1);
});
test("category keyboard navigation and existing player profile modal work", async t => {
  const root = await setup(t); mockBoards(t, { currentPlayerEntry: { rank: 15, publicPlayerId: "player", displayName: "Player", bestTime: "03:15.000", bestTimeMs: 195000, isCurrentPlayer: true } });
  await act(async () => root.render(createElement(LeaderboardExplorer, { mode: "api" })));
  assert.match(document.body.textContent, /#15/);
  await act(async () => document.querySelector('[aria-label="View Player\'s public profile"]').click()); assert.ok(document.querySelector('[role="dialog"]'));
  await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); assert.equal(document.querySelector('[role="dialog"]'), null);
  const tab = document.querySelector('[role="tab"][aria-selected="true"]'); await act(async () => tab.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  assert.equal(document.querySelector('[role="tab"][aria-selected="true"]').textContent, "Side Quests"); assert.equal(document.activeElement.textContent, "Side Quests");
});
test("board failure offers retry and old requests cannot replace a newly selected board", async t => {
  const root = await setup(t); let release, reads = 0;
  t.mock.method(globalThis, "fetch", async url => { const u = new URL(url); if (u.pathname.endsWith("catalog")) return Response.json(catalog); const id = u.searchParams.get("puzzleId");
    if (id === "Lion") return new Promise(resolve => { release = () => resolve(Response.json({ puzzle: catalog.mainLevels[0], entries: [] })); });
    if (++reads === 1) return Response.json({ message: "Unavailable" }, { status: 503 }); return Response.json({ puzzle: catalog.mainLevels[1], entries: [] });
  });
  await act(async () => root.render(createElement(LeaderboardExplorer, { mode: "api" }))); await click("Octopus"); assert.ok(document.querySelector('[role="alert"]')); await click("Retry");
  await act(async () => release()); assert.equal(document.querySelector("h2.cz-display.text-lg.font-bold").textContent, "Octopus");
});
test("owned cards and detail show approved Best/Rank and refresh on focus and player snapshot updates", async t => {
  const root = await setup(t); let rank = 1;
  const owned = () => ({ id: "Lion", name: "Lion", levelId: 1, playerPuzzleId: "owned", image: "/puzzles/placeholder.svg", status: "OWNED", personalBest: "03:15.000", leaderboardRank: rank, leaderboardEligible: rank !== undefined, latestSubmissionStatus: "APPROVED" });
  t.mock.method(globalThis, "fetch", async url => Response.json(new URL(url).pathname === "/api/me/puzzles" ? [owned()] : []));
  await act(async () => root.render(createElement(PuzzleCollectionExplorer))); assert.match(document.body.textContent, /03:15.000/); assert.match(document.body.textContent, /#1/); assert.doesNotMatch(document.body.textContent, /puzzleId|levelId/);
  rank = 15; await act(async () => window.dispatchEvent(new window.Event("focus"))); assert.match(document.body.textContent, /#15/);
  rank = 2; await act(async () => usePlayerUiState.getState().hydrate({ publicPlayerId: "current", displayName: "Player", avatar: "/brand/avatar.svg", rank: "Peasant", stats: { ownedPuzzles: 1 } })); assert.match(document.body.textContent, /#2/);
  await act(async () => root.render(createElement(PuzzleDetailExplorer, { id: "Lion" }))); assert.match(document.body.textContent, /03:15.000/); assert.match(document.body.textContent, /#2/);
  rank = undefined; await act(async () => window.dispatchEvent(new window.Event("focus"))); assert.match(document.body.textContent, /Inactive/); assert.doesNotMatch(document.body.textContent, /#15|levelId/);
});

test("admin-enabled new design appears on catalog refresh without hard reload", async t => {
  const root = await setup(t); let enabled = false;
  t.mock.method(globalThis, "fetch", async url => {
    const u = new URL(url); const data = { mainLevels: [boardItem("Lion"), ...(enabled ? [boardItem("New design")] : [])], sideQuests: [] };
    return Response.json(u.pathname.endsWith("catalog") ? data : { puzzle: data.mainLevels.find(item => item.puzzleId === u.searchParams.get("puzzleId")), entries: [] });
  });
  await act(async () => root.render(createElement(LeaderboardExplorer, { mode: "api" })));
  assert.doesNotMatch(document.body.textContent, /New design/); enabled = true; await act(async () => window.dispatchEvent(new window.Event("focus"))); await click("New design"); assert.equal(document.querySelector("h2.cz-display.text-lg.font-bold").textContent, "New design");
});
test("existing submission input retains numeric-only MM:SS and millisecond validation", async () => {
  const { normalizeCompletionInput, parseCompletionTime } = await import("../submissions/SubmissionStepper.tsx");
  assert.equal(normalizeCompletionInput("0315"), "03:15"); assert.equal(normalizeCompletionInput("0429"), "04:29"); assert.equal(normalizeCompletionInput("x03a15#!"), "03:15");
  assert.equal(parseCompletionTime(normalizeCompletionInput("0478")), null); assert.equal(/:\d{2}(?:\.\d{1,3})?$/.test(normalizeCompletionInput("031")), false); assert.equal(parseCompletionTime("03:15.123"), 195123);
});
