import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_API_BASE_URL = "https://hub.example.test";
const { apiClient, AUTH_REQUEST_TIMEOUT_MS } = await import("./apiClient.ts");
const actions = [
  ["login", () => apiClient.nativeLogin("player@example.test", "password")],
  ["signup", () => apiClient.nativeSignup("Player", "player@example.test", "password")],
  ["verify", () => apiClient.nativeVerify("token")],
  ["forgot", () => apiClient.forgotPassword("player@example.test")],
  ["reset", () => apiClient.resetPassword("token", "password")],
  ["request first password", () => apiClient.requestSetPassword()],
  ["set first password", () => apiClient.setPassword("token", "password")],
];

function clock(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const previous = globalThis.window;
  globalThis.window = { setTimeout: (...args) => setTimeout(...args), clearTimeout: (...args) => clearTimeout(...args) };
  t.after(() => { globalThis.window = previous; });
}

for (const [name, invoke] of actions) {
  test(`${name} waits past 20 seconds, times out at 45 seconds, and sends only one POST`, async (t) => {
    clock(t);
    let signal;
    const fetch = t.mock.method(globalThis, "fetch", async (_url, init) => {
      assert.equal(init.method, "POST");
      signal = init.signal;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    });
    const pending = invoke();
    const rejection = assert.rejects(pending, { code: "AUTH_REQUEST_TIMEOUT", status: 408 });
    t.mock.timers.tick(20_000);
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(24_999);
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(1);
    await rejection;
    assert.equal(AUTH_REQUEST_TIMEOUT_MS, 45_000);
    assert.equal(fetch.mock.callCount(), 1);
  });
}

test("cold-start login can succeed after 30 seconds without replay", async (t) => {
  clock(t);
  const fetch = t.mock.method(globalThis, "fetch", (_url, init) => new Promise((resolve) => setTimeout(() => {
    assert.equal(init.signal.aborted, false);
    resolve(Response.json({ ok: true }));
  }, 30_000)));
  const pending = apiClient.nativeLogin("player@example.test", "password");
  t.mock.timers.tick(30_000);
  assert.deepEqual(await pending, { ok: true });
  t.mock.timers.tick(60_000);
  assert.equal(fetch.mock.callCount(), 1);
});

test("session checks use a bounded 45-second deadline and respect caller cancellation", async (t) => {
  clock(t);
  let signal;
  const fetch = t.mock.method(globalThis, "fetch", (_url, init) => {
    signal = init.signal;
    return new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  });
  const timeout = assert.rejects(apiClient.getSession(), { code: "SESSION_CHECK_TIMEOUT" });
  t.mock.timers.tick(20_000); assert.equal(signal.aborted, false);
  t.mock.timers.tick(25_000); await timeout;
  const controller = new AbortController();
  const cancelled = assert.rejects(apiClient.getSession(controller.signal));
  controller.abort(); await cancelled; assert.equal(signal.aborted, true);
  await assert.rejects(apiClient.getSession(AbortSignal.abort()));
  assert.equal(fetch.mock.callCount(), 3);
});

for (const status of [401, 502, 503]) {
  test(`failed login (${status}) is never replayed`, async (t) => {
    clock(t);
    const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ message: "Request failed" }, { status }));
    await assert.rejects(apiClient.nativeLogin("player@example.test", "password"), { status });
    assert.equal(fetch.mock.callCount(), 1);
  });
}
