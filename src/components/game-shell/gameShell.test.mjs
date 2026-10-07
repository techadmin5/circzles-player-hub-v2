import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";
import { GameShell } from "./GameShell.tsx";
import { AuthProvider } from "../auth/AuthProvider.tsx";
import { HubAtmosphere } from "../hub/HubAtmosphere.tsx";

async function setup(t, reduced = true) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hub.example.test/hub" });
  const keys = ["window", "self", "document", "HTMLElement", "Element", "SVGElement", "IS_REACT_ACT_ENVIRONMENT"];
  const saved = keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key] });
  const preference = { matches: reduced, addEventListener(_event, callback) { this.callback = callback; }, removeEventListener() {} };
  window.matchMedia = () => preference;
  const root = createRoot(document.getElementById("root"));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  return { root, preference };
}

function shell(path) {
  const router = { replace() {}, push() {}, prefetch() {}, back() {}, forward() {}, refresh() {} };
  return createElement(AppRouterContext.Provider, { value: router }, createElement(PathnameContext.Provider, { value: path }, createElement(AuthProvider, {}, createElement(GameShell, {}, createElement("section", { className: "cz-surface" }, "Dashboard content")))));
}

test("only the exact /hub route gets the atmosphere and scoped glass wrapper", async (t) => {
  const { root } = await setup(t);
  await act(async () => root.render(shell("/hub")));
  assert.ok(document.querySelector(".cz-hub-dashboard"));
  assert.ok(document.querySelector('[data-testid="hub-atmosphere"]'));
  assert.equal(document.querySelector("video"), null);
  for (const path of ["/puzzles", "/submissions", "/leaderboard", "/missions", "/rewards", "/inventory", "/profile", "/settings", "/hub/other"]) {
    await act(async () => root.render(shell(path)));
    assert.equal(document.querySelector(".cz-hub-dashboard"), null);
    assert.equal(document.querySelector('[data-testid="hub-atmosphere"]'), null);
  }
});

test("shell keeps sidebar/footer separate from the independent main content scroll area", async (t) => {
  const { root } = await setup(t);
  await act(async () => root.render(shell("/hub")));
  const scroller = document.querySelector('[data-testid="game-content-scroll"]');
  const sidebar = document.querySelector('[data-testid="game-sidebar"]');
  assert.ok(!scroller.contains(sidebar));
  assert.ok(sidebar.querySelector('[data-testid="nav-settings"]'));
  assert.ok(sidebar.textContent.includes("Log out"));
  assert.ok(scroller.querySelector("main"));
  assert.equal(scroller.tabIndex, 0);
});

test("mobile navigation and More sheet still expose Settings and logout", async (t) => {
  const { root } = await setup(t);
  await act(async () => root.render(shell("/hub")));
  assert.ok(document.querySelector('[data-testid="mobilenav-hub"]'));
  await act(async () => document.querySelector('[data-testid="mobilenav-more"]').click());
  const sheet = document.querySelector('[data-testid="more-sheet"]');
  assert.ok(sheet);
  assert.ok(sheet.textContent.includes("Settings"));
  assert.ok(sheet.textContent.includes("Log out"));
});

test("hub video remains decorative, muted, and falls back after autoplay/media failure", async (t) => {
  const { root } = await setup(t, false);
  const media = { videoSrc: "/media/hub-background.mp4", posterSrc: "/media/hub-background-poster.jpg" };
  await act(async () => root.render(createElement(HubAtmosphere, { media })));
  const video = document.querySelector("video");
  assert.equal(video.muted, true); assert.equal(video.loop, true); assert.equal(video.autoplay, true);
  assert.equal(video.playsInline, true); assert.equal(video.controls, false); assert.equal(video.preload, "none");
  assert.equal(video.tabIndex, -1);
  video.play = () => Promise.reject(new Error("Autoplay denied"));
  await act(async () => video.dispatchEvent(new window.Event("loadeddata")));
  assert.equal(document.querySelector("video"), null);
  assert.ok(document.querySelector("img"));
  await act(async () => document.querySelector("img").dispatchEvent(new window.Event("error")));
  assert.equal(document.querySelector("img"), null);
  assert.ok(document.querySelector(".cz-hub-ambient"));
});

test("reduced motion uses static atmosphere/poster and responds to preference changes", async (t) => {
  const { root, preference } = await setup(t, true);
  await act(async () => root.render(createElement(HubAtmosphere, { media: { videoSrc: "/media/hub-background.mp4", posterSrc: "/media/hub-background-poster.jpg" } })));
  assert.equal(document.querySelector("video"), null);
  assert.ok(document.querySelector("img"));
  await act(async () => { preference.matches = false; preference.callback(); });
  assert.ok(document.querySelector("video"));
  await act(async () => { preference.matches = true; preference.callback(); });
  assert.equal(document.querySelector("video"), null);
});
