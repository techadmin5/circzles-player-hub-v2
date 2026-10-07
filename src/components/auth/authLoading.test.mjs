import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

process.env.NEXT_PUBLIC_API_BASE_URL = "https://hub.example.test";
const { NativeAuthFormContent } = await import("./NativeAuthForm.tsx");
const { AuthLoadingOverlay } = await import("./AuthLoadingOverlay.tsx");
const { SecurityPanel } = await import("./SecurityPanel.tsx");
const { loginLoadingSlides, AUTH_LOADING_DELAY_MS, AUTH_LOADING_ROTATION_MS } = await import("./authLoadingSlides.ts");

async function setup(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hub.example.test/login" });
  const keys = ["window", "self", "document", "HTMLElement", "FormData", "IS_REACT_ACT_ENVIRONMENT"];
  const saved = keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key] });
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  dom.window.setTimeout = (...args) => setTimeout(...args);
  dom.window.clearTimeout = (...args) => clearTimeout(...args);
  // JSDOM lacks the browser's native dialog implementation.
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const root = createRoot(document.getElementById("root"));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { root, tick: async (ms) => act(async () => t.mock.timers.tick(ms)) };
}

function pendingRequest(t) {
  let resolve, reject;
  const fetch = t.mock.method(globalThis, "fetch", (_url, init) => new Promise((yes, no) => {
    resolve = yes; reject = no;
    init.signal.addEventListener("abort", () => no(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  return { fetch, success: () => resolve(Response.json({ ok: true })), failure: (error) => reject(error) };
}

async function renderLogin(root) {
  const destinations = [];
  await act(async () => root.render(createElement(NativeAuthFormContent, { mode: "login", returnTo: "/hub?tab=rewards", refresh: async () => ({ publicPlayerId: "CZ-PLAYER" }), onAuthenticated: (path) => destinations.push(path) })));
  document.querySelector('[name="email"]').value = "player@example.test";
  document.querySelector('[name="password"]').value = "my secure password";
  return destinations;
}
const submit = () => document.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

test("slow login shows busy button first, delays overlay, rotates and clears on success", async (t) => {
  const { root, tick } = await setup(t);
  const request = pendingRequest(t);
  const destinations = await renderLogin(root);
  const button = document.querySelector("form button"); button.focus();
  await act(async () => { submit(); submit(); });
  assert.equal(button.textContent, "Please wait...");
  assert.equal(button.disabled, true);
  assert.equal(request.fetch.mock.callCount(), 1);
  assert.equal(document.querySelector("dialog"), null);
  await tick(AUTH_LOADING_DELAY_MS - 1);
  assert.equal(document.querySelector("dialog"), null);
  await tick(1);
  assert.equal(document.querySelector("dialog h2").textContent, "Logging you in");
  assert.equal(document.activeElement, document.querySelector("dialog"));
  assert.equal(document.body.style.overflow, "hidden");
  const cancel = new window.Event("cancel", { cancelable: true });
  document.querySelector("dialog").dispatchEvent(cancel);
  assert.equal(cancel.defaultPrevented, true);
  for (const slide of [...loginLoadingSlides.slice(1), loginLoadingSlides[0]]) {
    await tick(AUTH_LOADING_ROTATION_MS);
    assert.equal(document.querySelector("dialog h2").textContent, slide.title);
  }
  await act(async () => request.success());
  assert.equal(document.querySelector("dialog"), null);
  assert.equal(document.body.style.overflow, "");
  assert.equal(button.disabled, false);
  assert.equal(document.activeElement, button);
  assert.deepEqual(destinations, ["/hub?tab=rewards"]);
  await tick(60_000);
  assert.equal(document.querySelector("dialog"), null);
});

test("fast login navigates with no loading-screen flash or stale timer", async (t) => {
  const { root, tick } = await setup(t);
  const request = pendingRequest(t);
  const destinations = await renderLogin(root);
  await act(async () => submit());
  await tick(500);
  await act(async () => request.success());
  assert.equal(document.querySelector("dialog"), null);
  await tick(60_000);
  assert.equal(document.querySelector("dialog"), null);
  assert.equal(request.fetch.mock.callCount(), 1);
  assert.equal(destinations.length, 1);
});

for (const outcome of ["failure", "timeout"]) {
  test(`${outcome} dismisses the overlay, restores the form and does not replay login`, async (t) => {
    const { root, tick } = await setup(t);
    const request = pendingRequest(t);
    const destinations = await renderLogin(root);
    await act(async () => submit());
    await tick(AUTH_LOADING_DELAY_MS);
    assert.ok(document.querySelector("dialog"));
    if (outcome === "timeout") await tick(45_000 - AUTH_LOADING_DELAY_MS);
    else await act(async () => request.failure(new Error("Email or password is incorrect.")));
    assert.equal(document.querySelector("dialog"), null);
    assert.match(document.querySelector('[role="alert"]').textContent, outcome === "timeout" ? /Authentication took too long/ : /Email or password is incorrect/);
    assert.equal(document.querySelector("form button").disabled, false);
    assert.equal(document.querySelector('[name="email"]').value, "player@example.test");
    assert.equal(destinations.length, 0);
    await tick(60_000);
    assert.equal(request.fetch.mock.callCount(), 1);
  });
}

test("unmount during a pending request cleans up the delay and rotation", async (t) => {
  const { root, tick } = await setup(t);
  const request = pendingRequest(t);
  await renderLogin(root);
  await act(async () => submit());
  await tick(AUTH_LOADING_DELAY_MS);
  await act(async () => root.render(null));
  await tick(60_000);
  assert.equal(document.querySelector("dialog"), null);
  assert.equal(document.body.style.overflow, "");
  await act(async () => request.success());
});

test("media config supports images, handles failure, and keeps reduced-motion video silent", async (t) => {
  const { root } = await setup(t);
  await act(async () => root.render(createElement(AuthLoadingOverlay, { slide: { id: "image", title: "Loading", description: "Please wait", label: "Player Hub", media: { type: "image", src: "/brand/avatar.svg", alt: "CircZles avatar" } } })));
  assert.equal(document.querySelector("img").alt, "CircZles avatar");
  await act(async () => document.querySelector("img").dispatchEvent(new window.Event("error")));
  assert.equal(document.querySelector("img"), null);
  assert.ok(document.querySelector(".cz-auth-loading-orbit"));
  await act(async () => root.render(createElement(AuthLoadingOverlay, { slide: { id: "video", title: "Loading", description: "Please wait", media: { type: "video", src: "/loading.mp4" } } })));
  assert.equal(document.querySelector("video"), null);
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  await act(async () => root.render(createElement(AuthLoadingOverlay, { slide: { id: "motion-video", title: "Loading", description: "Please wait", media: { type: "video", src: "/loading.mp4" } } })));
  assert.equal(document.querySelector("video").muted, true);
  assert.equal(document.querySelector("video").loop, true);
  assert.equal(document.querySelector("video").playsInline, true);
  assert.equal(document.querySelector("video").preload, "none");
});

test("signup uses neutral loading copy and returns to its email-sent notice", async (t) => {
  const { root, tick } = await setup(t);
  const request = pendingRequest(t);
  await act(async () => root.render(createElement(NativeAuthFormContent, { mode: "signup", refresh: async () => null, onAuthenticated: () => assert.fail("Signup must still require verification") })));
  document.querySelector('[name="displayName"]').value = "Player";
  document.querySelector('[name="email"]').value = "player@example.test";
  document.querySelector('[name="password"]').value = "my secure password";
  await act(async () => submit());
  await tick(AUTH_LOADING_DELAY_MS);
  assert.equal(document.querySelector("dialog h2").textContent, "Connecting to CircZles");
  await act(async () => request.success());
  assert.equal(document.querySelector("dialog"), null);
  assert.match(document.querySelector('[role="status"]').textContent, /Check your spam or junk folder/);
});

test("first-password email requests reuse staged loading and never send duplicate mutations", async (t) => {
  const { root, tick } = await setup(t);
  let complete;
  const fetch = t.mock.method(globalThis, "fetch", (url, init) => {
    if (url.endsWith("/api/auth/security")) return Promise.resolve(Response.json({ email: "player@example.test", hasPassword: false }));
    assert.equal(init.method, "POST");
    return new Promise((resolve) => { complete = () => resolve(Response.json({ ok: true })); });
  });
  await act(async () => root.render(createElement(SecurityPanel)));
  const button = document.querySelector("button");
  await act(async () => { button.click(); button.click(); });
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "Please wait...");
  await tick(AUTH_LOADING_DELAY_MS);
  assert.equal(document.querySelector("dialog h2").textContent, "Connecting to CircZles");
  await act(async () => complete());
  assert.equal(document.querySelector("dialog"), null);
  assert.match(document.querySelector('[role="status"]').textContent, /finish adding your password/);
  assert.equal(fetch.mock.callCount(), 2);
});
